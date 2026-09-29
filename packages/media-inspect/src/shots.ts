import { type LocalMedia } from './contracts';
import { type InspectOptions } from './contracts';
import { type ShotCandidate } from '@scenewirejs/reference-core';
import { bounded } from './limits';
import { MediaError } from './process';
import { run } from './process';
import { ff } from './limits';
import { input } from './limits';
export interface ShotDetector {
  detect(input: LocalMedia, options?: InspectOptions): Promise<ShotCandidate[]>;
}
export class FFmpegSceneDetector implements ShotDetector {
  async detect(media: LocalMedia, options: InspectOptions = {}) {
    bounded(media.probe, options);
    const threshold = options.threshold ?? 0.3;
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1)
      throw new MediaError('media.threshold', 'Threshold must be >0 and <=1');
    const { stdout } = await run(
      'ffmpeg',
      [
        ...ff,
        ...input(media.path),
        '-an',
        '-vf',
        `scale=160:90,select='gt(scene,${threshold})',metadata=print:file=-`,
        '-fps_mode',
        'vfr',
        '-f',
        'null',
        '-',
      ],
      options,
    );
    const cuts = [
      ...stdout
        .toString()
        .matchAll(/pts_time:([\d.e+-]+)[\s\S]*?lavfi.scene_score=([\d.e+-]+)/g),
    ]
      .map((m) => ({ time: Number(m[1]) * 1000, score: Number(m[2]) }))
      .filter((c) => c.time > 0 && c.time < media.probe.durationMs);
    if (cuts.length + 1 > (options.maxShots ?? 100))
      throw new MediaError(
        'media.shots',
        'Shot candidate limit exceeded; adjust threshold or max-shots',
      );
    const boundaries = [
      0,
      ...new Set(cuts.map((c) => c.time)),
      media.probe.durationMs,
    ];
    return boundaries.slice(0, -1).map((startMs, i) => {
      const endMs = boundaries[i + 1]!;
      return {
        id: `shot-${i + 1}`,
        startMs,
        endMs,
        confidence: i ? cuts.find((c) => c.time === startMs)?.score : undefined,
        representativeTimesMs: [
          startMs,
          (startMs + endMs) / 2,
          Math.max(startMs, endMs - Math.min(50, (endMs - startMs) / 4)),
        ],
        evidence: 'content-change' as const,
      };
    });
  }
}
