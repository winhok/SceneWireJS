import type { Clip, DiagramProps } from '@scenewirejs/schema';
import type { PrimitiveInstruction } from '@scenewirejs/runtime';
import { arrow, box, text, withReveal } from './primitives';
export function compileDiagram(
  clip: Clip,
  props: DiagramProps,
): PrimitiveInstruction[] {
  const { width: w, height: h } = clip.transform;
  const vertical = props.direction === 'vertical';
  const columns = vertical
    ? Math.ceil(props.nodes.length / 6)
    : Math.min(6, props.nodes.length);
  const rows = vertical
    ? Math.min(6, props.nodes.length)
    : Math.ceil(props.nodes.length / columns);
  const gapX = vertical ? 30 : 44,
    gapY = vertical ? 44 : 56;
  const nw = Math.max(
    1,
    Math.min(210, (w - 48 - (columns - 1) * gapX) / columns),
  );
  const nh = Math.max(1, Math.min(100, (h - 64 - (rows - 1) * gapY) / rows));
  const totalW = columns * nw + (columns - 1) * gapX,
    totalH = rows * nh + (rows - 1) * gapY;
  const positions = new Map(
    props.nodes.map((n, i) => {
      const col = vertical ? Math.floor(i / 6) : i % columns,
        row = vertical ? i % 6 : Math.floor(i / columns);
      return [
        n.id,
        {
          x: (w - totalW) / 2 + col * (nw + gapX),
          y: (h - totalH) / 2 + row * (nh + gapY),
          index: i,
        },
      ];
    }),
  );
  const result: PrimitiveInstruction[] = [];
  for (const group of props.groups) {
    const members = group.nodeIds.map((id) => positions.get(id)!);
    const x = Math.min(...members.map((p) => p.x)) - 12,
      y = Math.min(...members.map((p) => p.y)) - 28;
    const right = Math.max(...members.map((p) => p.x + nw)) + 12,
      bottom = Math.max(...members.map((p) => p.y + nh)) + 12;
    result.push(
      box(
        `${clip.id}:${group.id}:box`,
        x,
        y,
        right - x,
        bottom - y,
        '#101d2e',
        '#2c465f',
        18,
      ),
      text(
        `${clip.id}:${group.id}:label`,
        group.label,
        x + 12,
        y + 4,
        right - x - 24,
        13,
        '#7899b8',
      ),
    );
  }
  for (const edge of props.edges) {
    const from = positions.get(edge.from)!,
      to = positions.get(edge.to)!;
    let x1 = from.x + nw / 2,
      y1 = from.y + nh / 2,
      x2 = to.x + nw / 2,
      y2 = to.y + nh / 2;
    if (Math.abs(x2 - x1) >= Math.abs(y2 - y1)) {
      const direction = Math.sign(x2 - x1) || 1;
      x1 += (direction * nw) / 2;
      x2 -= (direction * nw) / 2;
    } else {
      const direction = Math.sign(y2 - y1) || 1;
      y1 += (direction * nh) / 2;
      y2 -= (direction * nh) / 2;
    }
    const active = props.activeEdgeId === edge.id;
    let node = arrow(
      `${clip.id}:${edge.id}`,
      x1,
      y1,
      x2,
      y2,
      active ? '#f4c674' : '#53d5b0',
    );
    const start =
        (Math.max(from.index, to.index) + 0.2) / (props.nodes.length + 1),
      end = Math.min(1, start + 0.7 / (props.nodes.length + 1));
    if (props.stepReveal) node = withReveal(node, start, end, 'draw');
    result.push(node);
    if (edge.label) {
      let label = text(
        `${clip.id}:${edge.id}:label`,
        edge.label,
        (x1 + x2) / 2 - 65,
        (y1 + y2) / 2 - 26,
        130,
        12,
        '#8aa3bf',
      );
      if (props.stepReveal) label = withReveal(label, start, end, 'show');
      result.push(label);
    }
  }
  props.nodes.forEach((node, index) => {
    const p = positions.get(node.id)!;
    const active = props.activeNodeId === node.id;
    const kindColor =
      node.kind === 'database'
        ? '#314561'
        : node.kind === 'tool' || node.kind === 'mcp'
          ? '#17413e'
          : '#192e46';
    const values = [
      box(
        `${clip.id}:${node.id}:box`,
        p.x,
        p.y,
        nw,
        nh,
        active ? '#245346' : kindColor,
        active ? '#53d5b0' : '#426481',
      ),
      text(
        `${clip.id}:${node.id}:label`,
        node.label,
        p.x + 10,
        p.y + nh / 2 - 17,
        nw - 20,
        Math.min(23, Math.max(12, nw / 9)),
      ),
      text(
        `${clip.id}:${node.id}:kind`,
        node.kind.toUpperCase(),
        p.x + 10,
        p.y + nh - 21,
        nw - 20,
        10,
        active ? '#78e3bc' : '#7694b5',
      ),
    ];
    for (let item of values) {
      if (props.stepReveal)
        item = withReveal(
          item,
          index / (props.nodes.length + 1),
          (index + 0.6) / (props.nodes.length + 1),
          'show',
        );
      result.push(item);
    }
  });
  return result;
}
