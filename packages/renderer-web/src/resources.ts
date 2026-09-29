import { createServer, type Server } from 'node:http';
import { createReadStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
export type HostedResource =
  | { kind: 'memory'; bytes: Buffer; mime: string }
  | { kind: 'file'; path: string; size: number; mime: string };
export class ResourceStore extends Map<string, HostedResource> {
  override set(path: string, resource: HostedResource | Buffer): this {
    return super.set(
      path,
      Buffer.isBuffer(resource)
        ? { kind: 'memory', bytes: resource, mime: '' }
        : resource,
    );
  }
}
/** Only a single RFC byte range is supported. Invalid/unsatisfiable ranges produce 416. */
export function byteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (header === undefined) return size ? { start: 0, end: size - 1 } : null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (
    !match ||
    (!match[1] && !match[2]) ||
    !Number.isSafeInteger(size) ||
    size < 1
  )
    return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if (
    (first !== null && !Number.isSafeInteger(first)) ||
    (last !== null && !Number.isSafeInteger(last))
  )
    return null;
  if (first === null) {
    if (!last || last < 1) return null;
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  if (first >= size || (last !== null && last < first)) return null;
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}
export class ResourceHost {
  readonly token = randomBytes(32).toString('hex');
  origin = '';
  readonly mediaMetrics = new Map<
    string,
    {
      sourceSize: number;
      bytesServed: number;
      rangeRequests: number;
      requests: number;
    }
  >();
  private server?: Server;
  private streams = new Set<Readable>();
  private closePromise?: Promise<void>;
  constructor(
    private readonly resources: ReadonlyMap<string, HostedResource>,
    private readonly mimeFor: (path: string) => string,
  ) {}
  async prepare() {
    this.server = createServer((request, response) => {
      if (request.headers['x-scenewire-resource'] !== this.token) {
        response.writeHead(403).end();
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405).end();
        return;
      }
      const url = new URL(request.url ?? '/', 'http://localhost');
      const resource = !url.search
        ? this.resources.get(url.pathname)
        : undefined;
      if (!resource) {
        response.writeHead(404).end();
        return;
      }
      const common = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers':
          'Content-Range, Content-Length, Accept-Ranges',
        'Cache-Control': 'no-store',
        'Content-Type': resource.mime || this.mimeFor(url.pathname),
      };
      if (resource.kind === 'memory') {
        response.writeHead(200, {
          ...common,
          'Content-Length': resource.bytes.length,
        });
        response.end(request.method === 'HEAD' ? undefined : resource.bytes);
        return;
      }
      const range = byteRange(request.headers.range, resource.size);
      if (!range) {
        response
          .writeHead(416, {
            ...common,
            'Content-Range': `bytes */${resource.size}`,
            'Accept-Ranges': 'bytes',
          })
          .end();
        return;
      }
      const metric = this.mediaMetrics.get(url.pathname) ?? {
        sourceSize: resource.size,
        bytesServed: 0,
        rangeRequests: 0,
        requests: 0,
      };
      this.mediaMetrics.set(url.pathname, metric);
      metric.requests++;
      if (request.headers.range) metric.rangeRequests++;
      response.writeHead(request.headers.range ? 206 : 200, {
        ...common,
        'Accept-Ranges': 'bytes',
        'Content-Length': range.end - range.start + 1,
        ...(request.headers.range
          ? {
              'Content-Range': `bytes ${range.start}-${range.end}/${resource.size}`,
            }
          : {}),
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      // Streaming keeps Node allocations independent of source file size and worker count.
      const stream = createReadStream(resource.path, {
        ...range,
        highWaterMark: 64 * 1024,
      });
      this.streams.add(stream);
      stream.on('data', (bytes) => {
        metric.bytesServed += bytes.length;
      });
      stream.on('error', () => response.destroy());
      stream.on('close', () => this.streams.delete(stream));
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    });
    const server = this.server;
    await new Promise<void>((accept, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        accept();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw Error('Resource host unavailable');
    this.origin = `http://127.0.0.1:${address.port}`;
  }
  dispose(): Promise<void> {
    return (this.closePromise ??= (async () => {
      for (const stream of this.streams) stream.destroy();
      const server = this.server;
      if (!server?.listening) return;
      server.closeAllConnections();
      await new Promise<void>((accept, reject) =>
        server.close((error) => (error ? reject(error) : accept())),
      );
    })());
  }
}
