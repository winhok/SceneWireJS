export interface PathPoint {
  x: number;
  y: number;
}
// Reveal by geometric distance, independent of backend and prior frames.
export function revealPath(
  points: readonly PathPoint[],
  width: number,
  height: number,
  progress: number,
  closed = false,
): PathPoint[] {
  if (!Number.isFinite(progress)) throw new Error('Invalid path progress');
  const vertices = points.map((p) => ({ x: p.x * width, y: p.y * height }));
  if (closed && vertices.length) vertices.push({ ...vertices[0]! });
  if (progress <= 0 || !vertices.length) return [];
  if (progress >= 1) return vertices;
  const lengths = vertices
    .slice(1)
    .map((p, i) => Math.hypot(p.x - vertices[i]!.x, p.y - vertices[i]!.y));
  let remaining = lengths.reduce((a, b) => a + b, 0) * progress;
  const result = [vertices[0]!];
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!,
      from = vertices[i]!,
      to = vertices[i + 1]!;
    if (remaining >= length) {
      result.push(to);
      remaining -= length;
      continue;
    }
    result.push({
      x: from.x + ((to.x - from.x) * remaining) / length,
      y: from.y + ((to.y - from.y) * remaining) / length,
    });
    break;
  }
  return result;
}
