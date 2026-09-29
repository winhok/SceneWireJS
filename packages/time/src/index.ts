export interface FrameTime {
  frame: number;
  fps: number;
}
function validateFps(fps: number): void {
  if (!Number.isFinite(fps) || fps <= 0)
    throw new RangeError('FPS must be finite and positive');
}
function finite(value: number): void {
  if (!Number.isFinite(value)) throw new RangeError('Time must be finite');
}
export function secondsToFrame(seconds: number, fps: number): number {
  finite(seconds);
  validateFps(fps);
  return Math.round(seconds * fps);
}
export function frameToSeconds(frame: number, fps: number): number {
  finite(frame);
  validateFps(fps);
  return frame / fps;
}
export function frameToMilliseconds(frame: number, fps: number): number {
  return frameToSeconds(frame, fps) * 1000;
}
export function clampFrame(frame: number, min: number, max: number): number {
  finite(frame);
  finite(min);
  finite(max);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max)
    throw new RangeError('Invalid frame bounds');
  return Math.max(min, Math.min(max, Math.round(frame)));
}
