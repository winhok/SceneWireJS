import { copyFile, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { probe, hashFile } from './index';
import { run, MediaError, type RunOptions } from './process';

/** Exclusive output ownership. Neither project JSON nor source bytes are mutated. */
export async function ingestMedia(
  source: string,
  output: string,
  options: RunOptions = {},
) {
  const input = await realpath(source);
  const metadata = await probe(input, options);
  const details = JSON.parse(
    (
      await run(
        'ffprobe',
        [
          '-v',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-show_streams',
          '-of',
          'json',
          input,
        ],
        options,
      )
    ).stdout.toString(),
  );
  const videoTrack = details.streams.find(
    (s: { codec_type: string }) => s.codec_type === 'video',
  );
  const [numerator, denominator] = String(videoTrack.time_base)
    .split('/')
    .map(Number);
  const tickSeconds = numerator! / denominator!;
  if (!Number.isFinite(tickSeconds) || tickSeconds <= 0)
    throw new MediaError('media.timing', 'Finite track time base is required');
  let first = Number.isFinite(videoTrack.start_pts)
    ? videoTrack.start_pts * tickSeconds
    : Number(videoTrack.start_time ?? 0);
  let durationMs: number;
  if (Number.isFinite(videoTrack.duration_ts)) {
    // Preserve timestamp precision: decimal duration strings can truncate a 31/30-second source.
    durationMs = videoTrack.duration_ts * tickSeconds * 1000;
  } else {
    const packets = JSON.parse(
      (
        await run(
          'ffprobe',
          [
            '-v',
            'error',
            '-protocol_whitelist',
            'file,pipe',
            '-select_streams',
            'v:0',
            '-show_packets',
            '-show_entries',
            'packet=pts,duration',
            '-of',
            'json',
            input,
          ],
          options,
        )
      ).stdout.toString(),
    ).packets as { pts?: number; duration?: number }[];
    const valid = packets.filter(
      (p) => Number.isFinite(p.pts) && Number.isFinite(p.duration),
    );
    if (!valid.length)
      throw new MediaError(
        'media.timing',
        'Presentation timestamps unavailable',
      );
    const startTicks = valid.reduce(
      (min, p) => Math.min(min, p.pts!),
      Infinity,
    );
    const endTicks = valid.reduce(
      (max, p) => Math.max(max, p.pts! + p.duration!),
      -Infinity,
    );
    first = startTicks * tickSeconds;
    durationMs = (endTicks - startTicks) * tickSeconds * 1000;
  }
  if (
    !Number.isFinite(first) ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  )
    throw new MediaError('media.timing', 'Finite media timing is required');
  const root = resolve(output);
  try {
    await mkdir(root);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST')
      throw new MediaError('media.output', 'Output must be a new directory');
    throw e;
  }
  try {
    await mkdir(resolve(root, 'assets'));
    const videoPath = 'assets/source' + extname(input).toLowerCase();
    await copyFile(input, resolve(root, videoPath));
    if (
      (await hashFile(resolve(root, videoPath), options.signal)) !==
      metadata.sha256
    )
      throw new MediaError('media.hash', 'Copied source hash differs');
    const audioPath = 'assets/audio.wav';
    if (metadata.audio) {
      await run(
        'ffmpeg',
        [
          '-v',
          'error',
          '-nostdin',
          '-n',
          '-copyts',
          '-protocol_whitelist',
          'file,pipe',
          '-i',
          input,
          '-map',
          '0:a:0',
          '-vn',
          '-af',
          `atrim=start=${first},asetpts=PTS-(${first})/TB,aresample=async=1:first_pts=0`,
          '-t',
          String(durationMs / 1000),
          '-ar',
          '48000',
          '-c:a',
          'pcm_s16le',
          resolve(root, audioPath),
        ],
        options,
      );
    }
    const audioDuration = metadata.audio
      ? Number(
          JSON.parse(
            (
              await run(
                'ffprobe',
                [
                  '-v',
                  'error',
                  '-show_format',
                  '-of',
                  'json',
                  resolve(root, audioPath),
                ],
                options,
              )
            ).stdout.toString(),
          ).format.duration,
        ) * 1000
      : undefined;
    const result = {
      schemaVersion: 1,
      sourcePath: basename(input),
      sourceSha256: metadata.sha256,
      video: {
        path: videoPath,
        durationMs,
        width: metadata.width,
        height: metadata.height,
      },
      audio: metadata.audio
        ? {
            available: true,
            path: audioPath,
            durationMs: audioDuration,
            sha256: await hashFile(resolve(root, audioPath), options.signal),
            sourceOffsetMs: 0,
          }
        : { available: false },
      metadata: {
        ...metadata,
        path: basename(input),
        firstVideoTimestampMs: first * 1000,
        rotation:
          videoTrack.side_data_list?.find(
            (s: { rotation?: number }) => s.rotation !== undefined,
          )?.rotation ?? 0,
        displayMatrix: videoTrack.side_data_list?.find(
          (s: { displaymatrix?: string }) => s.displaymatrix !== undefined,
        )?.displaymatrix,
        sampleAspectRatio: videoTrack.sample_aspect_ratio,
        displayAspectRatio: videoTrack.display_aspect_ratio,
      },
    };
    await writeFile(
      resolve(root, 'ingest.json'),
      JSON.stringify(result, null, 2) + '\n',
    );
    return result;
  } catch (e) {
    await rm(root, { recursive: true, force: true });
    throw e;
  }
}
