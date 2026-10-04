import { realpath } from 'node:fs/promises';
import { hashFile } from './probe';
import { run, MediaError, type RunOptions } from './process';

/** Measurements of final encoded bytes; completion is not aesthetic or delivery approval. */
export interface FinalMediaQc {
  version: 1;
  artifactSha256: string;
  audioPresent: boolean;
  audioCodec: string | null;
  integratedLoudnessLufs: number | null;
  truePeakDbtp: number | null;
  samplePeakDbfs: number | null;
  /** Full-scale decoded peaks suggest clipping; not a clipped-sample count. */
  possibleClipping: boolean | null;
  silenceRanges: { startMs: number; endMs: number }[];
  silenceThresholdDbfs: number;
  silenceMinimumMs: number;
  avEndpointDriftMs: number | null;
  measurementStatus: 'complete' | 'pending';
  unavailable: string[];
  method: 'ffmpeg-loudnorm-input-astats-silencedetect-ffprobe';
}
const finite = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
interface StreamTiming {
  codec_type: string;
  codec_name?: string;
  duration?: string;
  start_time?: string;
}
const endpoint = (stream: StreamTiming | undefined): number | null => {
  const duration = finite(stream?.duration),
    start = finite(stream?.start_time);
  return duration !== null && start !== null ? (start + duration) * 1000 : null;
};
/** Local, bounded, provider-neutral final-artifact QC. Never modifies the input. */
export async function inspectFinalMedia(
  path: string,
  options: RunOptions = {},
): Promise<FinalMediaQc> {
  const file = await realpath(path),
    artifactSha256 = await hashFile(file, options.signal);
  const { stdout } = await run(
    'ffprobe',
    [
      '-v',
      'error',
      '-protocol_whitelist',
      'file,pipe',
      '-show_streams',
      '-of',
      'json',
      file,
    ],
    options,
  );
  const streams = (JSON.parse(stdout.toString()) as { streams: StreamTiming[] })
    .streams;
  const video = streams.find((s) => s.codec_type === 'video'),
    audio = streams.find((s) => s.codec_type === 'audio');
  if (!video)
    throw new MediaError(
      'media.video',
      'Final video artifact requires a video stream',
    );
  const videoEnd = endpoint(video),
    audioEnd = endpoint(audio);
  const result: FinalMediaQc = {
    version: 1,
    artifactSha256,
    audioPresent: !!audio,
    audioCodec: audio?.codec_name ?? null,
    integratedLoudnessLufs: null,
    truePeakDbtp: null,
    samplePeakDbfs: null,
    possibleClipping: null,
    silenceRanges: [],
    silenceThresholdDbfs: -50,
    silenceMinimumMs: 100,
    avEndpointDriftMs:
      audioEnd !== null && videoEnd !== null ? audioEnd - videoEnd : null,
    measurementStatus: 'pending',
    unavailable: [],
    method: 'ffmpeg-loudnorm-input-astats-silencedetect-ffprobe',
  };
  if (audio) {
    const { stderr } = await run(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostdin',
        '-nostats',
        '-protocol_whitelist',
        'file,pipe',
        '-i',
        file,
        '-map',
        '0:a:0',
        '-vn',
        '-sn',
        '-dn',
        '-af',
        'silencedetect=noise=-50dB:d=0.1,astats=metadata=0:reset=0,loudnorm=print_format=json',
        '-f',
        'null',
        '-',
      ],
      options,
    );
    const json = stderr.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0];
    if (json) {
      const metrics = JSON.parse(json);
      result.integratedLoudnessLufs = finite(metrics.input_i);
      result.truePeakDbtp = finite(metrics.input_tp);
    }
    const peak = [...stderr.matchAll(/Peak level dB:\s*([^\s]+)/g)].at(-1)?.[1];
    result.samplePeakDbfs = finite(peak);
    result.possibleClipping =
      result.samplePeakDbfs === null ? null : result.samplePeakDbfs >= 0;
    let start: number | undefined;
    for (const match of stderr.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
      const ms = Math.max(0, Number(match[2]) * 1000);
      if (match[1] === 'start') start = ms;
      else if (start !== undefined) {
        result.silenceRanges.push({ startMs: start, endMs: ms });
        start = undefined;
      }
    }
    if (start !== undefined && audioEnd !== null)
      result.silenceRanges.push({ startMs: start, endMs: audioEnd });
  } else result.unavailable.push('audioAbsent');
  for (const metric of [
    'integratedLoudnessLufs',
    'truePeakDbtp',
    'samplePeakDbfs',
    'possibleClipping',
    'avEndpointDriftMs',
  ] as const)
    if (result[metric] === null) result.unavailable.push(metric);
  result.measurementStatus = result.unavailable.length ? 'pending' : 'complete';
  if ((await hashFile(file, options.signal)) !== artifactSha256)
    throw new MediaError(
      'media.changed',
      'Final artifact changed during QC; repeat inspection',
    );
  return result;
}
