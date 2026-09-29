import type {
  AnimationTrack,
  CameraAnimation,
  EasingName,
} from '@scenewirejs/schema';
export function ease(t: number, name: EasingName): number {
  switch (name) {
    case 'linear':
      return t;
    case 'easeIn':
      return t * t;
    case 'easeOut':
      return 1 - (1 - t) ** 2;
    case 'easeInOut':
      return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    case 'easeOutCubic':
      return 1 - (1 - t) ** 3;
    case 'easeInOutCubic':
      return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
  }
}
export function interpolate(
  track: AnimationTrack | CameraAnimation,
  frame: number,
): number {
  const first = track.keyframes[0]!;
  if (frame <= first.frame) return first.value;
  for (let i = 1; i < track.keyframes.length; i++) {
    const next = track.keyframes[i]!;
    const previous = track.keyframes[i - 1]!;
    if (frame <= next.frame) {
      const progress = ease(
        (frame - previous.frame) / (next.frame - previous.frame),
        next.easing,
      );
      return previous.value + (next.value - previous.value) * progress;
    }
  }
  return track.keyframes[track.keyframes.length - 1]!.value;
}
