import { type FrameRange } from './contracts';
export function mergeAffectedRanges(
  ranges: FrameRange[],
  total: number,
): FrameRange[] {
  const ordered = ranges
    .map((r) => ({
      startFrame: Math.max(0, Math.min(total, r.startFrame)),
      endFrame: Math.max(0, Math.min(total, r.endFrame)),
    }))
    .filter((r) => r.endFrame > r.startFrame)
    .sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  const result: FrameRange[] = [];
  for (const r of ordered) {
    const last = result.at(-1);
    if (last && r.startFrame <= last.endFrame)
      last.endFrame = Math.max(last.endFrame, r.endFrame);
    else result.push({ ...r });
  }
  return result;
}
export function suggestPreviewFrames(
  ranges: FrameRange[],
  total: number,
  max = 12,
): number[] {
  const frames = [
    ...new Set(
      ranges.flatMap((r) =>
        [0, 0.25, 0.5, 0.75, 1].map((p) =>
          Math.max(
            0,
            Math.min(
              total - 1,
              p === 1
                ? r.endFrame - 1
                : Math.floor(r.startFrame + (r.endFrame - r.startFrame) * p),
            ),
          ),
        ),
      ),
    ),
  ].sort((a, b) => a - b);
  const limit = Math.max(0, Math.min(12, Math.floor(max)));
  if (!limit || total < 1) return [];
  return frames.length <= limit
    ? frames
    : limit === 1
      ? [frames[0]!]
      : Array.from(
          { length: limit },
          (_, i) =>
            frames[Math.round((i * (frames.length - 1)) / (limit - 1))]!,
        );
}
