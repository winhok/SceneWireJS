import {
  componentPropsSchema,
  primitiveClipSchema,
  editorialComponentTypeSchema,
  type Clip,
  type PrimitiveClip,
  type VideoProject,
} from '@scenewirejs/schema';
import {
  createComponentRegistry,
  resolveTheme,
  type PrimitiveInstruction,
} from '@scenewirejs/runtime';
const defaults = {
  HeroText: {
    eyebrow: 'A new way to make video',
    title: 'Generate structure,\nnot pixels.',
    body: 'Build a story you can change.',
    align: 'left',
  },
  EditorialParagraph: {
    lead: 'One idea. Many possibilities.',
    text: 'Keep your story editable.',
    align: 'left',
  },
  FloatingCard: {
    title: 'Change one thing',
    body: 'Keep everything else.',
    badge: 'EDITABLE',
  },
  ChatCard: {
    title: 'A familiar starting point',
    messages: [
      { role: 'user', text: 'Can I change just the timing?' },
      { role: 'assistant', text: 'Yes. The rest stays yours.' },
    ],
  },
  ChartCard: {
    title: 'A story from data',
    points: [
      { x: 0, y: 0.1 },
      { x: 1, y: 0.4 },
      { x: 2, y: 0.3 },
      { x: 3, y: 0.8 },
    ],
    xLabel: 'Time',
    yLabel: 'Value',
  },
  DiagramCard: {
    title: 'From intent to video',
    nodes: [
      { id: 'script', label: 'Script' },
      { id: 'video', label: 'Video' },
    ],
    edges: [{ from: 'script', to: 'video' }],
  },
  BrandOutro: {
    brand: 'SceneWire',
    tagline: 'Generate structure,\nnot pixels.',
    mark: 'S',
  },
} as const;
function compile(clip: Clip, project: VideoProject): PrimitiveInstruction[] {
  const t = resolveTheme(project.theme),
    w = clip.transform.width,
    h = clip.transform.height;
  const nodes: PrimitiveInstruction[] = [];
  const add = (
    key: string,
    component: PrimitiveClip['component'],
    x: number,
    y: number,
    width: number,
    height: number,
    props: Record<string, unknown>,
  ) => {
    const p = primitiveClipSchema.parse({
      id: 'internal',
      component,
      startFrame: 0,
      durationFrames: 1,
      transform: {
        x,
        y,
        width: Math.max(1, width),
        height: Math.max(1, height),
      },
      props,
    });
    nodes.push({
      id: `${clip.id}:${key}`,
      component: p.component,
      props: p.props,
      transform: p.transform,
    });
  };
  const box = (
    key: string,
    x = 2,
    y = 2,
    width = w - 4,
    height = h - 4,
    fill = t.surface,
    stroke = t.border,
    radius = 24,
  ) => add(key, 'Shape', x, y, width, height, { fill, stroke, radius });
  // Explicit newlines are respected; deterministic word wrapping prevents crowded card text.
  const wrap = (value: string, width: number, size: number) =>
    value
      .split('\n')
      .flatMap((line) => {
        const max = Math.max(8, Math.floor(width / (size * 0.56))),
          lines: string[] = [];
        let current = '';
        for (const word of line.split(' ')) {
          if (current && current.length + word.length + 1 > max) {
            lines.push(current);
            current = '';
          }
          current += (current ? ' ' : '') + word;
        }
        lines.push(current);
        return lines;
      })
      .join('\n');
  const text = (
    key: string,
    value: string,
    x: number,
    y: number,
    width: number,
    size = 24,
    color = t.foreground,
    align: 'left' | 'center' | 'right' = 'left',
  ) => {
    const content = wrap(value, width, size);
    add(
      key,
      'Text',
      x,
      y,
      width,
      Math.min(h - y, size * 1.3 * content.split('\n').length + 4),
      { text: content, fontSize: size, color, align },
    );
  };
  switch (clip.component) {
    case 'HeroText': {
      const p = clip.props;
      const titleY = p.eyebrow ? 54 : 4,
        titleSize = Math.min(76, Math.max(40, w / 13));
      if (p.eyebrow)
        text(
          'eyebrow',
          p.eyebrow.toUpperCase(),
          4,
          4,
          w - 8,
          17,
          t.accent,
          p.align,
        );
      text(
        'title',
        p.title,
        4,
        titleY,
        w - 8,
        titleSize,
        p.emphasis ? t.accent : t.foreground,
        p.align,
      );
      if (p.body)
        text(
          'body',
          p.body,
          4,
          titleY +
            wrap(p.title, w - 8, titleSize).split('\n').length *
              titleSize *
              1.3 +
            28,
          w - 8,
          25,
          t.muted,
          p.align,
        );
      break;
    }
    case 'EditorialParagraph': {
      const p = clip.props;
      if (p.lead)
        text(
          'lead',
          p.lead,
          4,
          4,
          w - 8,
          32,
          p.emphasis ? t.accent : t.foreground,
          p.align,
        );
      text('text', p.text, 4, p.lead ? 60 : 4, w - 8, 24, t.muted, p.align);
      break;
    }
    case 'FloatingCard': {
      const p = clip.props;
      box(
        'surface',
        2,
        2,
        w - 4,
        h - 4,
        p.emphasis ? t.surfaceAlt : t.surface,
        p.emphasis ? t.accent : t.border,
      );
      if (p.badge)
        text('badge', p.badge.toUpperCase(), 28, 24, w - 56, 14, t.accent);
      const titleY = p.badge ? 60 : 28;
      const titleSize = Math.min(30, Math.max(22, (w - 56) / 8));
      text('title', p.title, 28, titleY, w - 56, titleSize);
      const bodyY =
        titleY +
        wrap(p.title, w - 56, titleSize).split('\n').length * titleSize * 1.3 +
        16;
      text('body', p.body, 28, bodyY, w - 56, 20, t.muted);
      break;
    }
    case 'ChatCard': {
      const p = clip.props;
      box(
        'surface',
        2,
        2,
        w - 4,
        h - 4,
        t.surface,
        p.emphasis ? t.accent : t.border,
      );
      if (p.title) text('title', p.title, 28, 24, w - 56, 22);
      const row = (h - 90) / p.messages.length;
      p.messages.forEach((m, i) => {
        const x = m.role === 'user' ? 58 : 24,
          y = 72 + i * row;
        box(
          `bubble-${i}`,
          x,
          y,
          w - 82,
          row - 14,
          m.role === 'user' ? t.surfaceAlt : t.background,
          t.border,
          16,
        );
        text(
          `role-${i}`,
          m.role.toUpperCase(),
          x + 16,
          y + 10,
          w - 114,
          12,
          t.accent,
        );
        text(
          `message-${i}`,
          m.text,
          x + 16,
          y + 30,
          w - 114,
          Math.min(23, Math.max(15, row / 5)),
          t.foreground,
        );
      });
      break;
    }
    case 'ChartCard': {
      const p = clip.props;
      box('surface');
      text('title', p.title, 28, 22, w - 56, 25);
      const xs = p.points.map((q) => q.x),
        ys = p.points.map((q) => q.y),
        xmin = Math.min(...xs),
        ymin = Math.min(...ys),
        sx = Math.max(...xs) - xmin || 1,
        sy = Math.max(...ys) - ymin || 1;
      const area = { x: 72, y: 88, width: w - 112, height: h - 154 };
      add('axes', 'Path', area.x, area.y, area.width, area.height, {
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
          { x: 1, y: 1 },
        ],
        color: t.border,
        lineWidth: 2,
      });
      add('curve', 'Path', area.x, area.y, area.width, area.height, {
        points: p.points.map((q) => ({
          x: (q.x - xmin) / sx,
          y: 1 - (q.y - ymin) / sy,
        })),
        color: p.emphasis ? t.success : t.accent,
        lineWidth: 5,
      });
      if (p.xLabel)
        text('x-label', p.xLabel, area.x, h - 40, area.width, 15, t.muted);
      if (p.yLabel) text('y-label', p.yLabel, 14, area.y, 54, 13, t.muted);
      break;
    }
    case 'DiagramCard': {
      const p = clip.props;
      box('surface');
      if (p.title) text('title', p.title, 28, 24, w - 56, 25);
      const gap = 22,
        nw = (w - 56 - gap * (p.nodes.length - 1)) / p.nodes.length,
        cy = h * 0.52;
      p.edges.forEach((e, i) => {
        const from = p.nodes.findIndex((n) => n.id === e.from),
          to = p.nodes.findIndex((n) => n.id === e.to);
        const start = 28 + from * (nw + gap) + nw / 2,
          end = 28 + to * (nw + gap) + nw / 2;
        add(
          `edge-${i}`,
          'Path',
          Math.min(start, end),
          cy + 20,
          Math.abs(end - start) || 1,
          12,
          {
            points: [
              { x: start <= end ? 0 : 1, y: 0.5 },
              { x: start <= end ? 1 : 0, y: 0.5 },
            ],
            color: t.accent,
            lineWidth: 3,
          },
        );
      });
      p.nodes.forEach((n, i) => {
        const x = 28 + i * (nw + gap),
          active = n.id === p.activeNodeId;
        box(
          `node-${n.id}`,
          x,
          cy - 24,
          nw,
          92,
          active ? t.surfaceAlt : t.background,
          active ? t.accent : t.border,
          16,
        );
        text(
          `label-${n.id}`,
          n.label,
          x + 10,
          cy,
          nw - 20,
          Math.min(22, nw / 5),
          active ? t.accent : t.foreground,
          'center',
        );
      });
      break;
    }
    case 'BrandOutro': {
      const p = clip.props;
      if (p.mark) {
        box('mark', w / 2 - 36, 2, 72, 72, t.accent, t.accent, 20);
        text('mark-text', p.mark, w / 2 - 32, 14, 64, 40, t.surface, 'center');
      }
      text(
        'brand',
        p.brand,
        4,
        p.mark ? 108 : 20,
        w - 8,
        68,
        t.foreground,
        'center',
      );
      text(
        'tagline',
        p.tagline,
        4,
        p.mark ? 222 : 130,
        w - 8,
        38,
        t.accent,
        'center',
      );
      break;
    }
    default:
      throw new Error(`Not an Editorial component: ${clip.component}`);
  }
  if (clip.component === 'FloatingCard' && clip.props.focused) {
    return nodes.map((node) => ({ ...node, effects: { blurPx: 0 } }));
  }
  return nodes;
}
export function createEditorialRegistry() {
  return createComponentRegistry(
    editorialComponentTypeSchema.options.map((type) => {
      const schema = componentPropsSchema(type);
      return {
        type,
        schema,
        defaultProps: schema.parse(defaults[type]),
        category: 'editorial',
        authoring: {
          label: type,
          description: `Editable editorial ${type}`,
          defaultWidth:
            type === 'HeroText' ||
            type === 'BrandOutro' ||
            type === 'DiagramCard'
              ? 1000
              : 480,
          defaultHeight:
            type === 'HeroText' || type === 'BrandOutro' ? 400 : 340,
          defaultDurationFrames: 180,
        },
        aiDescription: `Editorial motion explanation: ${type}`,
        semanticCapabilities:
          type === 'BrandOutro'
            ? []
            : type === 'DiagramCard'
              ? ['highlight-node']
              : type === 'FloatingCard'
                ? ['highlight', 'focus']
                : ['highlight'],
        motionCapabilities: [
          'show',
          'highlight',
          ...(type === 'ChartCard' ? ['connect', 'animate'] : []),
          ...(type === 'FloatingCard' ? ['focus'] : []),
        ],
        compile,
        choreography: {
          apply(action, target) {
            if (
              action === 'focus' &&
              type === 'FloatingCard' &&
              target.kind === 'clip'
            )
              return { propsPatch: { focused: true, emphasis: true } };
            if (
              (action === 'connect' || action === 'animate') &&
              type === 'ChartCard' &&
              target.kind === 'clip'
            )
              return {
                animation: {
                  primitiveId: `${target.clipId}:curve`,
                  property: 'progress' as const,
                  from: 0,
                  to: 1,
                },
              };
            if (action === 'highlight') {
              if (type === 'DiagramCard' && target.kind === 'node')
                return { propsPatch: { activeNodeId: target.nodeId } };
              if (
                target.kind === 'clip' &&
                type !== 'DiagramCard' &&
                type !== 'BrandOutro'
              )
                return { propsPatch: { emphasis: true } };
            }
            throw new Error(
              `Unsupported Editorial choreography: ${action}/${target.kind}`,
            );
          },
        },
      };
    }),
  );
}
