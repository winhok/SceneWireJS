export const frameTimeoutFlags = [
  '--prepare-timeout-ms',
  '--seek-timeout-ms',
  '--capture-timeout-ms',
] as const;
export function timeoutOptions(flags: ReadonlyMap<string, string>) {
  const options: {
    prepareTimeoutMs?: number;
    seekTimeoutMs?: number;
    captureTimeoutMs?: number;
    renderTimeoutMs?: number;
    audioStallTimeoutMs?: number;
  } = {};
  for (const [flag, key] of [
    ['--prepare-timeout-ms', 'prepareTimeoutMs'],
    ['--seek-timeout-ms', 'seekTimeoutMs'],
    ['--capture-timeout-ms', 'captureTimeoutMs'],
    ['--render-timeout-ms', 'renderTimeoutMs'],
    ['--audio-stall-timeout-ms', 'audioStallTimeoutMs'],
  ] as const) {
    const text = flags.get(flag);
    if (text === undefined) continue;
    const value = Number(text);
    if (
      !/^\d+$/.test(text) ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > 3_600_000
    )
      throw Error(`${flag} must be an integer from 1 to 3600000`);
    options[key] = value;
  }
  return options;
}
export function selectedFrames(text: string): number[] {
  if (!/^[0-9]+(?:,[0-9]+)*$/.test(text))
    throw Error('Valid comma-separated frame integers required');
  const frames = text.split(',').map(Number);
  if (frames.some((frame) => !Number.isSafeInteger(frame)))
    throw Error('Frame must be a safe integer');
  return frames;
}
