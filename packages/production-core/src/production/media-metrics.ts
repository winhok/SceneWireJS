export interface RasterWork {
  startFrame: number;
  endFrame: number;
}
/** Unique final timeline frames; rebuilt work takes precedence over overlapping reuse. */
export function rasterMetrics(
  artifacts: readonly { action: 'reused' | 'rebuilt'; raster?: RasterWork }[],
) {
  const work = artifacts.filter((a) => a.raster);
  const length = (ranges: RasterWork[]) => {
    let end = 0,
      total = 0;
    for (const r of ranges.sort((a, b) => a.startFrame - b.startFrame)) {
      total += Math.max(0, r.endFrame - Math.max(end, r.startFrame));
      end = Math.max(end, r.endFrame);
    }
    return total;
  };
  const rendered = work.filter((a) => a.action === 'rebuilt');
  const framesRendered = length(rendered.map((a) => a.raster!));
  return {
    rangesReused: work.length - rendered.length,
    rangesRendered: rendered.length,
    framesRendered,
    framesReused: length(work.map((a) => a.raster!)) - framesRendered,
  };
}
