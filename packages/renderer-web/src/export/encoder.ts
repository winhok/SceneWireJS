import { type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import {
  spawnMediaProcess,
  terminateMediaProcess,
} from '@scenewirejs/media-inspect';
export interface EncoderDiagnostic {
  phase: string;
  exitCode: number | null;
  stderr: string;
  argvSummary: string[];
  elapsedMs: number;
  startedAt: string;
  lastProgressAt: string | null;
  lastProgressElapsedMs: number | null;
  stalled: boolean;
}
export interface EncoderProgress {
  phase: string;
  event: 'start' | 'progress' | 'completion' | 'failure';
  startedAt: string;
  elapsedMs: number;
  durationMs?: number;
  outputTimeMs?: number;
  diagnostic?: EncoderDiagnostic;
}
export interface EncoderObservation {
  phase: string;
  durationMs?: number;
  stallTimeoutMs?: number;
  onProgress?(progress: EncoderProgress): void;
}
export class EncoderError extends Error {
  constructor(
    readonly diagnostic: EncoderDiagnostic,
    message: string,
  ) {
    super(message);
  }
}
/** Never expose local source paths, URLs, filter expressions or unrelated environment. */
export function sanitizeEncoderText(text: string) {
  return text
    .replace(/(?:https?|file):\/\/[^\s'"\]]+/gi, '[resource]')
    .replace(/(?:[A-Za-z]:[\\/]|\/)[^\s'"\]]+/g, '[path]')
    .slice(-4000);
}
export async function runEncoder(
  args: string[],
  signal: AbortSignal,
  input?: (child: ChildProcess) => Promise<void>,
  observation?: EncoderObservation,
) {
  const started = Date.now();
  const phase = observation?.phase ?? 'encode';
  const stallTimeoutMs = observation?.stallTimeoutMs ?? 300000;
  if (!Number.isFinite(stallTimeoutMs) || stallTimeoutMs <= 0)
    throw Error('Invalid encoder stall timeout');
  const child = spawnMediaProcess(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      ...(observation ? ['-progress', 'pipe:1', '-stats_period', '0.5'] : []),
      ...args,
    ],
    { stdio: ['pipe', observation ? 'pipe' : 'ignore', 'pipe'] },
  );
  let stderr = '',
    buffered = '',
    lastProgress: number | null = null,
    outputTimeMs = -1,
    stalled = false;
  const notify = (
    event: EncoderProgress['event'],
    diagnostic?: EncoderDiagnostic,
  ) =>
    observation?.onProgress?.({
      phase,
      event,
      startedAt: new Date(started).toISOString(),
      elapsedMs: Date.now() - started,
      durationMs: observation.durationMs,
      ...(outputTimeMs >= 0 ? { outputTimeMs } : {}),
      ...(diagnostic ? { diagnostic } : {}),
    });
  const diagnostic = (exitCode: number | null): EncoderDiagnostic => ({
    phase,
    exitCode,
    stderr: sanitizeEncoderText(stderr),
    argvSummary: args.map((arg) => (arg.startsWith('-') ? arg : '[value]')),
    elapsedMs: Date.now() - started,
    startedAt: new Date(started).toISOString(),
    lastProgressAt:
      lastProgress === null ? null : new Date(lastProgress).toISOString(),
    lastProgressElapsedMs:
      lastProgress === null ? null : lastProgress - started,
    stalled,
  });
  child.stdin?.on('error', () => {});
  child.stderr?.on('data', (bytes: Buffer) => {
    stderr = (stderr + bytes.toString()).slice(-8000);
  });
  child.stdout?.on('data', (bytes: Buffer) => {
    buffered += bytes.toString();
    const lines = buffered.split('\n');
    buffered = lines.pop()!.slice(-1024);
    for (const line of lines)
      if (line.startsWith('out_time_us=')) {
        const time = Number(line.slice(12)) / 1000;
        if (Number.isFinite(time) && time > outputTimeMs) {
          outputTimeMs = time;
          lastProgress = Date.now();
          notify('progress');
        }
      }
  });
  const abort = () => terminateMediaProcess(child);
  signal.addEventListener('abort', abort, { once: true });
  const stallTimer = observation
    ? setInterval(
        () => {
          if (Date.now() - (lastProgress ?? started) >= stallTimeoutMs) {
            stalled = true;
            abort();
          }
        },
        Math.min(1000, stallTimeoutMs),
      )
    : undefined;
  const completion = new Promise<void>((resolve, reject) => {
    child.on('error', () =>
      reject(
        new EncoderError(
          diagnostic(null),
          'FFmpeg unavailable. Install ffmpeg on PATH before rendering.',
        ),
      ),
    );
    child.on('close', (code) =>
      code === 0 && !signal.aborted && !stalled
        ? resolve()
        : reject(
            new EncoderError(
              diagnostic(code),
              signal.aborted
                ? 'Render cancelled'
                : stalled
                  ? 'FFmpeg audio mux stalled'
                  : `FFmpeg failed (${code}): ${sanitizeEncoderText(stderr)}`,
            ),
          ),
    );
  });
  void completion.catch(() => {});
  try {
    notify('start');
    if (signal.aborted) {
      abort();
      throw new EncoderError(diagnostic(null), 'Render cancelled');
    }
    try {
      await once(child, 'spawn');
    } catch {
      throw new EncoderError(
        diagnostic(null),
        'FFmpeg unavailable. Install ffmpeg on PATH before rendering.',
      );
    }
    if (input) await input(child);
    child.stdin?.end();
    await completion;
    notify('completion');
  } catch (error) {
    abort();
    await completion.catch(() => {});
    notify(
      'failure',
      error instanceof EncoderError ? error.diagnostic : diagnostic(null),
    );
    throw error;
  } finally {
    if (stallTimer) clearInterval(stallTimer);
    signal.removeEventListener('abort', abort);
  }
}
