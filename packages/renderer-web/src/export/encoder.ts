import { spawn } from 'node:child_process';
import { once } from 'node:events';
export async function runEncoder(
  args: string[],
  signal: AbortSignal,
  input?: (child: ReturnType<typeof spawn>) => Promise<void>,
) {
  const child = spawn(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stdin?.on('error', () => {});
  child.stderr?.on('data', (bytes: Buffer) => {
    stderr = (stderr + bytes.toString()).slice(-4000);
  });
  const abort = () => child.kill('SIGKILL');
  signal.addEventListener('abort', abort, { once: true });
  const completion = new Promise<void>((resolve, reject) => {
    child.on('error', (error) =>
      reject(
        new Error(
          `FFmpeg unavailable: ${error.message}. Install ffmpeg on PATH before rendering.`,
        ),
      ),
    );
    child.on('close', (code) =>
      code === 0 && !signal.aborted
        ? resolve()
        : reject(
            new Error(
              signal.aborted
                ? 'Render cancelled'
                : `FFmpeg failed (${code}): ${stderr}`,
            ),
          ),
    );
  });
  // Attach a rejection handler immediately while frames are being generated.
  void completion.catch(() => {});
  try {
    if (signal.aborted) {
      abort();
      throw new Error('Render cancelled');
    }
    try {
      await once(child, 'spawn');
    } catch (error) {
      throw new Error(
        `FFmpeg unavailable: ${error instanceof Error ? error.message : String(error)}. Install ffmpeg on PATH before rendering.`,
      );
    }
    if (input) await input(child);
    child.stdin?.end();
    await completion;
  } catch (error) {
    abort();
    await completion.catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
