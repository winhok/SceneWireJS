import { spawn } from 'node:child_process';
export class MediaError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export interface RunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
}
export function executable(tool: 'ffmpeg' | 'ffprobe') {
  return (
    process.env[
      tool === 'ffmpeg' ? 'SCENEWIRE_FFMPEG_PATH' : 'SCENEWIRE_FFPROBE_PATH'
    ] || tool
  );
}
export function run(
  tool: 'ffmpeg' | 'ffprobe',
  args: string[],
  options: RunOptions = {},
): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted)
      return reject(
        new MediaError('media.cancelled', 'Media operation cancelled'),
      );
    const timeout = options.timeoutMs ?? 60000,
      limit = options.maxBytes ?? 32 * 1024 * 1024;
    if (
      !Number.isFinite(timeout) ||
      timeout <= 0 ||
      !Number.isFinite(limit) ||
      limit <= 0
    )
      return reject(new MediaError('media.config', 'Invalid process bounds'));
    const child = spawn(executable(tool), args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let fault: Error | undefined,
      bytes = 0;
    const out: Buffer[] = [],
      err: Buffer[] = [];
    const stop = (e: Error) => {
      fault ??= e;
      child.kill('SIGKILL');
    };
    const cancel = () =>
      stop(new MediaError('media.cancelled', 'Media operation cancelled'));
    const timer = setTimeout(
      () =>
        stop(new MediaError('media.timeout', `${tool} exceeded ${timeout}ms`)),
      timeout,
    );
    options.signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', (b: Buffer) => {
      bytes += b.length;
      if (bytes > limit)
        stop(
          new MediaError(
            'media.limit',
            'Media output limit exceeded; reduce duration or sampling',
          ),
        );
      else out.push(b);
    });
    child.stderr.on('data', (b: Buffer) => {
      bytes += b.length;
      if (bytes > limit)
        stop(new MediaError('media.limit', 'Media diagnostic limit exceeded'));
      else err.push(b);
    });
    child.on('error', (e) => {
      fault = new MediaError(
        'media.executable',
        `${tool} unavailable: ${e.message}. Install ${tool} or set SCENEWIRE_${tool.toUpperCase()}_PATH.`,
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
      if (fault) return reject(fault);
      if (code !== 0)
        return reject(
          new MediaError(
            'media.decode',
            `${tool} failed (${code}): ${Buffer.concat(err).toString().slice(-1500)}`,
          ),
        );
      resolve({
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString(),
      });
    });
  });
}
