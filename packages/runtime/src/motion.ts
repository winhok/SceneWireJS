import {
  animationSchema,
  type AnimationProperty,
  type AnimationTrack,
  type Clip,
  type MotionIntent,
} from '@scenewirejs/schema';
export function compileMotion(clip: Clip, fps: number): AnimationTrack[] {
  const generated = (clip.motion ?? []).flatMap((m) =>
    compilePreset(clip, m, fps),
  );
  // Explicit authoring is authoritative. Presets use the same existing evaluator.
  return [
    ...generated.filter(
      (a) => !clip.animations.some((manual) => manual.property === a.property),
    ),
    ...clip.animations,
  ];
}
function compilePreset(
  clip: Clip,
  m: MotionIntent,
  fps: number,
): AnimationTrack[] {
  const t = clip.transform;
  const start =
    m.startFrame +
    (m.preset === 'stagger' ? m.staggerIndex * m.staggerFrames : 0);
  const last = m.durationFrames - 1;
  const sign = m.direction === 'left' || m.direction === 'up' ? -1 : 1;
  const axis = m.direction === 'left' || m.direction === 'right' ? 'x' : 'y';
  const track = (
    property: AnimationProperty,
    value: (p: number, f: number) => number,
    periodic = false,
  ): AnimationTrack => {
    const steps = periodic ? Math.min(last, 600) : 1;
    const keyframes = Array.from({ length: steps + 1 }, (_, i) => {
      const frame = Math.round((last * i) / steps);
      return {
        frame: start + frame,
        value: value(frame / last, frame),
        easing:
          periodic ||
          m.preset === 'draw' ||
          m.preset === 'reveal' ||
          m.preset === 'drift'
            ? 'linear'
            : 'easeOutCubic',
      };
    });
    return animationSchema.parse({ property, keyframes });
  };
  const wave = (frame: number) =>
    Math.sin((2 * Math.PI * m.frequency * frame) / fps);
  switch (m.preset) {
    case 'fade':
    case 'stagger':
      return [track('opacity', (p) => t.opacity * p)];
    case 'draw':
    case 'reveal':
      return [track('progress', (p) => p)];
    case 'scale':
      return [
        track('scaleX', (p) => t.scaleX * (0.8 + 0.2 * p)),
        track('scaleY', (p) => t.scaleY * (0.8 + 0.2 * p)),
      ];
    case 'slide':
      return [track(axis, (p) => t[axis] + sign * m.amplitude * (1 - p))];
    case 'rise':
      return [track('y', (p) => t.y + m.amplitude * (1 - p))];
    case 'drift':
      return [track(axis, (p) => t[axis] + sign * m.amplitude * p)];
    case 'bounce':
      return [
        track('y', (_p, f) => t.y - m.amplitude * Math.abs(wave(f)), true),
      ];
    case 'float':
      return [track('y', (_p, f) => t.y + m.amplitude * wave(f), true)];
    case 'wiggle':
      return [
        track('rotation', (_p, f) => t.rotation + m.amplitude * wave(f), true),
      ];
    case 'shake':
      return [
        track('x', (p, f) => t.x + m.amplitude * wave(f) * (1 - p), true),
      ];
    case 'pulse': {
      const amount = Math.min(m.amplitude / 100, 0.9);
      return [
        track('scaleX', (_p, f) => t.scaleX * (1 + amount * wave(f)), true),
        track('scaleY', (_p, f) => t.scaleY * (1 + amount * wave(f)), true),
      ];
    }
    case 'evaporate':
      return [
        track('y', (p) => t.y - m.amplitude * p),
        track('opacity', (p) => t.opacity * (1 - p)),
        track('scaleX', (p) => t.scaleX * (1 + 0.2 * p)),
        track('scaleY', (p) => t.scaleY * (1 + 0.2 * p)),
      ];
  }
}
