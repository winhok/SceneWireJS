import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';
import { join } from 'node:path';

/** Isolate owned media descendants on POSIX so cancellation can stop the group. */
export function spawnMediaProcess(
  command: string,
  args: string[],
  options: SpawnOptions,
): ChildProcess {
  return spawn(command, args, {
    ...options,
    shell: false,
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
}

const terminating = new WeakSet<ChildProcess>();

/** Stop the owned process tree, including children of a Windows launcher shim. */
export function terminateMediaProcess(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid || terminating.has(child)) return;
  terminating.add(child);
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
    return;
  }
  const systemRoot =
    process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';
  const killer = spawn(
    join(systemRoot, 'System32', 'taskkill.exe'),
    ['/PID', String(pid), '/T', '/F'],
    { shell: false, windowsHide: true, stdio: 'ignore' },
  );
  killer.on('error', () => child.kill('SIGKILL'));
  killer.on('close', (code) => {
    if (code !== 0 && child.exitCode === null) child.kill('SIGKILL');
  });
}
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
  const key =
    tool === 'ffmpeg' ? 'SCENEWIRE_FFMPEG_PATH' : 'SCENEWIRE_FFPROBE_PATH';
  const configured = process.env[key];
  if (configured !== undefined && !configured.trim())
    throw new MediaError(
      'media.executable',
      `${key} must name an executable; unset it to use PATH`,
    );
  return configured ?? tool;
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
    const child = spawnMediaProcess(executable(tool), args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let fault: Error | undefined,
      bytes = 0;
    const out: Buffer[] = [],
      err: Buffer[] = [];
    const stop = (e: Error) => {
      fault ??= e;
      terminateMediaProcess(child);
    };
    const cancel = () =>
      stop(new MediaError('media.cancelled', 'Media operation cancelled'));
    const timer = setTimeout(
      () =>
        stop(new MediaError('media.timeout', `${tool} exceeded ${timeout}ms`)),
      timeout,
    );
    options.signal?.addEventListener('abort', cancel, { once: true });
    child.stdout!.on('data', (b: Buffer) => {
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
    child.stderr!.on('data', (b: Buffer) => {
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
