import { primitiveClipSchema, type PrimitiveClip } from '@scenewirejs/schema';
import type { PrimitiveInstruction } from '@scenewirejs/runtime';
export function primitive(
  id: string,
  component: PrimitiveClip['component'],
  x: number,
  y: number,
  width: number,
  height: number,
  props: PrimitiveClip['props'] | Record<string, unknown>,
  extra: Partial<PrimitiveInstruction> = {},
): PrimitiveInstruction {
  const clip = primitiveClipSchema.parse({
    id: 'internal',
    component,
    startFrame: 0,
    durationFrames: 1,
    transform: { x, y, width: Math.max(1, width), height: Math.max(1, height) },
    props,
  });
  return {
    id,
    component: clip.component,
    props: clip.props,
    transform: clip.transform,
    ...extra,
  };
}
export function box(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fill = '#152238',
  stroke = '#33516b',
  radius = 14,
): PrimitiveInstruction {
  return primitive(id, 'Shape', x, y, w, h, { fill, stroke, radius });
}
export function text(
  id: string,
  value: string,
  x: number,
  y: number,
  w: number,
  size = 22,
  color = '#e7edf7',
  height = size * 1.4,
  monospace = false,
): PrimitiveInstruction {
  return primitive(id, 'Text', x, y, w, height, {
    text: value,
    fontSize: size,
    color,
    fontFamily: monospace ? 'monospace' : 'theme',
  });
}
export function arrow(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color = '#53d5b0',
): PrimitiveInstruction {
  const width = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
  const node = primitive(
    id,
    'Arrow',
    (x1 + x2) / 2 - width / 2,
    (y1 + y2) / 2 - 8,
    width,
    16,
    { color, lineWidth: 3 },
  );
  return {
    ...node,
    transform: {
      ...node.transform,
      rotation: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI,
    },
  };
}
export function withReveal(
  node: PrimitiveInstruction,
  start: number,
  end: number,
  mode: 'show' | 'draw' | 'type',
): PrimitiveInstruction {
  return { ...node, reveal: { start, end, mode } };
}
