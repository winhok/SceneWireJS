import {
  componentPropsSchema,
  primitiveClipSchema,
  educationComponentTypeSchema,
  type Clip,
  type PrimitiveClip,
  type VideoProject,
} from '@scenewirejs/schema';
import {
  createComponentRegistry,
  resolveTheme,
  type PrimitiveInstruction,
} from '@scenewirejs/runtime';
import { sketchLine, sketchCircleApproximation } from './sketch';
export * from './sketch';
const defaults = {
  Thermometer: {
    value: 220,
    min: 0,
    max: 300,
    unit: 'C',
    label: 'Surface temperature',
  },
  Flame: { intensity: 0.7 },
  Droplet: { state: 'levitating', size: 0.8 },
  Steam: { density: 0.6 },
  Magnifier: { label: 'A closer look', magnification: 3 },
  HeatWave: { intensity: 0.7, direction: 'up', count: 4 },
  CutawayDiagram: { showVaporLayer: true },
  ScientificChart: {
    title: 'Droplet lifetime',
    xLabel: 'Surface temperature →',
    yLabel: 'Lifetime',
    points: [
      { x: 0, y: 0.4 },
      { x: 0.3, y: 0.1 },
      { x: 0.5, y: 0.05 },
      { x: 0.65, y: 0.8 },
      { x: 1, y: 0.6 },
    ],
    schematic: true,
  },
  Annotation: { text: 'A cushion of vapor', style: 'underline' },
} as const;
function compile(clip: Clip, project: VideoProject): PrimitiveInstruction[] {
  const t = resolveTheme(project.theme),
    w = clip.transform.width,
    h = clip.transform.height,
    id = clip.id;
  const nodes: PrimitiveInstruction[] = [];
  const add = (
    suffix: string,
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
    const node = {
      id: `${id}:${suffix}`,
      component: p.component,
      transform: p.transform,
      props: p.props,
    };
    nodes.push(node);
    return node;
  };
  const box = (
    suffix: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fill = t.surface,
    stroke = t.border,
    radius = 12,
  ) => add(suffix, 'Shape', x, y, width, height, { fill, stroke, radius });
  const text = (
    suffix: string,
    value: string,
    x: number,
    y: number,
    width: number,
    size = 22,
    color = t.foreground,
  ) =>
    add(
      suffix,
      'Text',
      x,
      y,
      width,
      size * 1.3 * value.split('\n').length + 4,
      {
        text: value,
        fontSize: size,
        color,
      },
    );
  const path = (
    suffix: string,
    points: { x: number; y: number }[],
    x = 0,
    y = 0,
    width = w,
    height = h,
    color = t.annotation.stroke,
    closed = false,
  ) =>
    add(suffix, 'Path', x, y, width, height, {
      points: sketchLine(`${id}:${suffix}`, points),
      color,
      lineWidth: 3,
      closed,
    });
  const arrow = (
    suffix: string,
    x: number,
    y: number,
    width: number,
    rotation = -90,
  ) => {
    const node = add(suffix, 'Arrow', x, y, width, 12, {
      color: t.warning,
      lineWidth: 3,
    });
    node.transform = { ...node.transform, rotation };
    return node;
  };
  switch (clip.component) {
    case 'Thermometer': {
      const p = clip.props,
        level = (p.value - p.min) / (p.max - p.min),
        ink = p.emphasis ? t.accent : t.danger;
      box('tube', w * 0.15, 12, 32, h - 90, t.surface, t.border, 16);
      box(
        'column',
        w * 0.15 + 9,
        18 + (h - 105) * (1 - level),
        14,
        Math.max(1, (h - 105) * level),
        ink,
        ink,
        7,
      );
      box('bulb', w * 0.15 - 7, h - 91, 46, 46, ink, t.border, 23);
      for (let i = 0; i < 5; i++)
        path(
          `tick-${i}`,
          [
            { x: 0, y: 0.5 },
            { x: 1, y: 0.5 },
          ],
          w * 0.15 + 43,
          24 + (i * (h - 100)) / 4,
          20,
          8,
          t.muted,
        );
      text(
        'value',
        `${p.value} °${p.unit}`,
        w * 0.15 + 75,
        h * 0.4,
        w * 0.65,
        32,
        ink,
      );
      if (p.label) text('label', p.label, w * 0.15, h - 26, w * 0.8, 17);
      break;
    }
    case 'Flame': {
      const p = clip.props;
      const inset = (1 - p.intensity) * 0.25;
      path(
        'outer',
        [
          { x: 0.15, y: 0.9 },
          { x: 0.05, y: 0.6 },
          { x: 0.3, y: 0.3 },
          { x: 0.4, y: 0.04 },
          { x: 0.6, y: 0.4 },
          { x: 0.7, y: 0.2 },
          { x: 0.93, y: 0.65 },
          { x: 0.8, y: 0.9 },
          { x: 0.15, y: 0.9 },
        ],
        w * inset,
        h * inset,
        w * (1 - 2 * inset),
        h * (1 - inset),
        p.emphasis ? t.accent : t.danger,
        true,
      );
      path(
        'inner',
        [
          { x: 0.3, y: 0.95 },
          { x: 0.35, y: 0.6 },
          { x: 0.5, y: 0.35 },
          { x: 0.65, y: 0.7 },
          { x: 0.7, y: 0.95 },
        ],
        w * 0.2,
        h * 0.3,
        w * 0.6,
        h * 0.6,
        t.warning,
      );
      if (p.label) text('label', p.label, 0, h - 28, w, 18);
      break;
    }
    case 'Droplet': {
      const p = clip.props,
        sw = w * p.size,
        sh = h * p.size,
        x = (w - sw) / 2,
        y = (h - sh) / 2,
        ink = p.emphasis ? t.warning : t.accent;
      if (p.state === 'evaporating') {
        for (let i = 0; i < 3; i++)
          path(
            `vapor-${i}`,
            [
              { x: 0.5, y: 1 },
              { x: 0.25, y: 0.65 },
              { x: 0.7, y: 0.3 },
              { x: 0.5, y: 0 },
            ],
            x + (i * sw) / 3,
            y,
            sw / 4,
            sh,
            ink,
          );
      } else {
        box(
          'body',
          x,
          y + (p.state === 'levitating' ? 0 : sh * 0.1),
          sw,
          sh * 0.75,
          t.surfaceAlt,
          ink,
          sh * 0.4,
        );
        path(
          'glint',
          [
            { x: 0, y: 0.8 },
            { x: 0.2, y: 0.3 },
            { x: 1, y: 0 },
          ],
          x + sw * 0.2,
          y + sh * 0.12,
          sw * 0.23,
          sh * 0.2,
          ink,
        );
        if (p.state === 'boiling')
          for (let i = 0; i < 3; i++)
            box(
              `bubble-${i}`,
              x + ((i + 0.5) * sw) / 4,
              y + sh * 0.27,
              9,
              9,
              t.surface,
              ink,
              5,
            );
        if (p.state === 'levitating')
          path(
            'cushion',
            [
              { x: 0, y: 0.5 },
              { x: 0.25, y: 0.3 },
              { x: 0.5, y: 0.7 },
              { x: 0.75, y: 0.3 },
              { x: 1, y: 0.5 },
            ],
            x,
            y + sh * 0.88,
            sw,
            12,
            t.warning,
          );
      }
      break;
    }
    case 'Steam':
    case 'HeatWave': {
      const p = clip.props,
        count = 'count' in p ? p.count : Math.max(1, Math.ceil(p.density * 6)),
        strength = 'intensity' in p ? p.intensity : p.density;
      if (strength === 0) break;
      for (let i = 0; i < count; i++) {
        let points = Array.from({ length: 17 }, (_, j) => ({
          x: 0.5 + 0.18 * Math.sin((j * Math.PI) / 4 + i),
          y: 1 - j / 16,
        }));
        const direction = p.direction;
        if (direction === 'down')
          points = points.map((q) => ({ x: q.x, y: 1 - q.y }));
        if (direction === 'left' || direction === 'right')
          points = points.map((q) => ({
            x: direction === 'left' ? q.y : 1 - q.y,
            y: q.x,
          }));
        const n = path(
          `wave-${i}`,
          points,
          (i * w) / count,
          8,
          (w / count) * 0.8,
          h - 16,
          'intensity' in p ? t.warning : t.muted,
        );
        n.transform = {
          ...n.transform,
          opacity: p.emphasis ? 1 : 0.25 + strength * 0.65,
        };
      }
      break;
    }
    case 'Magnifier': {
      const p = clip.props;
      path(
        'lens',
        sketchCircleApproximation(`${id}:lens`),
        8,
        8,
        w * 0.68,
        h * 0.68,
        p.emphasis ? t.accent : t.border,
        true,
      );
      path(
        'handle',
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        w * 0.57,
        h * 0.55,
        w * 0.3,
        h * 0.3,
        t.border,
      );
      text('zoom', `${p.magnification}×`, w * 0.25, h * 0.3, w * 0.35, 26);
      if (p.label) text('label', p.label, 4, h - 28, w, 18);
      break;
    }
    case 'CutawayDiagram': {
      const p = clip.props;
      box('surface', 12, h * 0.72, w - 24, h * 0.18, t.surface, t.danger, 4);
      path(
        'surface-hatch',
        [
          { x: 0, y: 0.9 },
          { x: 0.2, y: 0.1 },
          { x: 0.4, y: 0.9 },
          { x: 0.6, y: 0.1 },
          { x: 0.8, y: 0.9 },
          { x: 1, y: 0.1 },
        ],
        16,
        h * 0.75,
        w - 32,
        h * 0.12,
        t.danger,
      );
      box(
        'droplet',
        w * 0.23,
        h * 0.15,
        w * 0.52,
        h * 0.32,
        t.surfaceAlt,
        p.emphasis === 'droplet' ? t.warning : t.accent,
        h * 0.16,
      );
      text('droplet-label', p.dropletLabel, w * 0.3, h * 0.26, w * 0.4, 21);
      if (p.showVaporLayer) {
        box(
          'vapor-band',
          w * 0.19,
          h * 0.51,
          w * 0.6,
          h * 0.15,
          t.surface,
          p.emphasis === 'vapor' ? t.accent : t.warning,
          18,
        );
        for (let i = 0; i < 4; i++)
          path(
            `vapor-${i}`,
            [
              { x: 0, y: 0.5 },
              { x: 0.25, y: 0.2 },
              { x: 0.5, y: 0.8 },
              { x: 0.75, y: 0.2 },
              { x: 1, y: 0.5 },
            ],
            w * (0.22 + i * 0.13),
            h * 0.62,
            w * 0.12,
            h * 0.035,
            t.warning,
          );
        text(
          'vapor-label',
          p.vaporLabel,
          w * 0.25,
          h * 0.51 + 6,
          w * 0.5,
          18,
          p.emphasis === 'vapor' ? t.accent : t.muted,
        );
      }
      text(
        'surface-label',
        p.surfaceLabel,
        w * 0.3,
        h * 0.92,
        w * 0.6,
        18,
        p.emphasis === 'surface' ? t.accent : t.danger,
      );
      arrow('heat-left', w * 0.02, h * 0.62, h * 0.2);
      arrow('heat-right', w * 0.82, h * 0.62, h * 0.2);
      break;
    }
    case 'ScientificChart': {
      const p = clip.props,
        left = 75,
        top = 70,
        cw = w - 105,
        ch = h - 150;
      const xs = p.points.map((q) => q.x),
        ys = p.points.map((q) => q.y),
        xmin = Math.min(...xs),
        xspan = Math.max(...xs) - xmin || 1,
        ymin = Math.min(...ys),
        yspan = Math.max(...ys) - ymin || 1;
      const norm = (q: { x: number; y: number }) => ({
        x: (q.x - xmin) / xspan,
        y: 1 - (q.y - ymin) / yspan,
      });
      path(
        'axis',
        [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
          { x: 1, y: 1 },
        ],
        left,
        top,
        cw,
        ch,
        t.border,
      );
      path(
        'curve',
        p.points.map(norm),
        left,
        top,
        cw,
        ch,
        p.emphasis ? t.warning : t.accent,
      );
      text('title', p.title ?? 'Droplet lifetime', left, 12, w - 100, 24);
      text(
        'x-label',
        p.xLabel ?? 'Surface temperature →',
        left,
        h - 48,
        w - 100,
        18,
      );
      text('y-label', p.yLabel ?? 'Lifetime', 4, top, 65, 15);
      if (p.schematic)
        text(
          'schematic',
          'SCHEMATIC · not measured data',
          left,
          42,
          w - 100,
          14,
          t.muted,
        );
      p.annotations?.forEach((a, i) => {
        const q = norm(a);
        text(
          `note-${i}`,
          a.label,
          left + q.x * cw,
          Math.max(top, top + q.y * ch - 30),
          Math.max(80, cw * (1 - q.x)),
          16,
        );
      });
      break;
    }
    case 'Annotation': {
      const p = clip.props,
        ink = p.emphasis ? t.warning : t.annotation.stroke;
      text(
        'text',
        p.text,
        p.style === 'circle' ? w * 0.08 : 0,
        p.style === 'circle' ? h * 0.3 : 8,
        p.style === 'circle' ? w * 0.84 : w,
        22,
        p.emphasis ? t.accent : t.annotation.text,
      );
      if (p.style === 'underline')
        path(
          'underline',
          [
            { x: 0, y: 0.5 },
            { x: 0.2, y: 0.4 },
            { x: 0.6, y: 0.55 },
            { x: 1, y: 0.45 },
          ],
          0,
          8 + p.text.split('\n').length * 22 * 1.3 + 6,
          w,
          12,
          ink,
        );
      if (p.style === 'circle')
        path('circle', sketchCircleApproximation(id), 0, 0, w, h, ink, true);
      if (p.style === 'arrow')
        add('arrow', 'Arrow', 0, h - 20, w, 12, { color: ink, lineWidth: 3 });
      break;
    }
    default:
      throw new Error(`Not an Education component: ${clip.component}`);
  }
  return nodes;
}
export function createEducationRegistry() {
  return createComponentRegistry(
    educationComponentTypeSchema.options.map((type) => {
      const schema = componentPropsSchema(type);
      return {
        type,
        schema,
        defaultProps: schema.parse(defaults[type]),
        authoring: {
          label: type,
          description: `Editable sketch ${type}`,
          defaultWidth:
            type === 'CutawayDiagram' || type === 'ScientificChart' ? 740 : 300,
          defaultHeight:
            type === 'CutawayDiagram' || type === 'ScientificChart' ? 360 : 220,
          defaultDurationFrames: 180,
        },
        aiDescription: `Science explanation: ${type}`,
        category: 'education',
        semanticCapabilities: ['highlight'],
        motionCapabilities: [
          'show',
          'highlight',
          ...(type === 'ScientificChart' ? ['connect'] : []),
        ],
        compile,
        choreography: {
          apply(action, target) {
            if (target.kind !== 'clip')
              throw new Error('Education cues require clip targets');
            if (action === 'highlight')
              return {
                propsPatch:
                  type === 'CutawayDiagram'
                    ? { emphasis: 'vapor' }
                    : { emphasis: true },
              };
            if (action === 'connect' && type === 'ScientificChart')
              return {
                animation: {
                  primitiveId: `${target.clipId}:curve`,
                  property: 'progress' as const,
                  from: 0,
                  to: 1,
                },
              };
            throw new Error(`Unsupported Education choreography: ${action}`);
          },
        },
      };
    }),
  );
}
