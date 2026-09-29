import { spawn } from 'node:child_process';
import type { VideoProject } from '@scenewirejs/schema';
export async function validateSilentPicture(
  file: string,
  project: VideoProject,
  frames: number,
  signal: AbortSignal,
) {
  const child = spawn(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_packets',
      '-show_streams',
      '-of',
      'json',
      file,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const abort = () => child.kill('SIGKILL');
  signal.addEventListener('abort', abort, { once: true });
  let text = '',
    stderr = '';
  child.stdout.on('data', (b) => {
    text += b;
    if (text.length > 32_000_000) abort();
  });
  child.stderr.on('data', (b) => {
    stderr = (stderr + b).slice(-4000);
  });
  try {
    const completion = new Promise<void>((accept, reject) => {
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 && !signal.aborted
          ? accept()
          : reject(
              Error(
                signal.aborted
                  ? 'Render cancelled'
                  : `Picture validation failed: ${stderr}`,
              ),
            ),
      );
    });
    if (signal.aborted) abort();
    await completion;
    const probe = JSON.parse(text) as {
      streams: {
        width: number;
        height: number;
        avg_frame_rate: string;
        duration: string;
      }[];
      packets: { pts_time: string; duration_time: string }[];
    };
    const times = probe.packets
      .map((p) => Number(p.pts_time))
      .sort((a, b) => a - b);
    const maximumTimestampError = times.reduce(
      (maximum, time, index) =>
        Math.max(maximum, Math.abs(time - index / project.fps)),
      0,
    );
    const stream = probe.streams[0]!;
    const [num, den] = stream.avg_frame_rate.split('/').map(Number);
    if (
      times.length !== frames ||
      stream.width !== project.canvas.width ||
      stream.height !== project.canvas.height ||
      num! / den! !== project.fps ||
      maximumTimestampError > 0.00001 ||
      Math.abs(Number(stream.duration) - frames / project.fps) > 0.00001
    )
      throw Error(
        'Silent picture frame/dimension/rate/timestamp discontinuity',
      );
    return {
      frames: times.length,
      maximumTimestampError,
      durationSeconds: Number(stream.duration),
      fps: num! / den!,
    };
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
