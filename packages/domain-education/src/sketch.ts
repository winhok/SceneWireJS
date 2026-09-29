export interface SketchPoint {
  x: number;
  y: number;
}
/** Stable integer hash, bounded normalized jitter; endpoints remain unchanged. */
export function sketchLine(
  id: string,
  points: readonly SketchPoint[],
): SketchPoint[] {
  let hash = 2166136261;
  for (const c of id) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return { ...p };
    const offset =
      ((Math.imul(hash ^ i, 1597334677) >>> 0) / 4294967295 - 0.5) * 0.008;
    return {
      x: Math.max(0, Math.min(1, p.x + offset)),
      y: Math.max(0, Math.min(1, p.y - offset)),
    };
  });
}
export function sketchCircleApproximation(id: string): SketchPoint[] {
  return sketchLine(
    id,
    Array.from({ length: 33 }, (_, i) => ({
      x: 0.5 + 0.47 * Math.cos((i * Math.PI) / 16),
      y: 0.5 + 0.47 * Math.sin((i * Math.PI) / 16),
    })),
  );
}
