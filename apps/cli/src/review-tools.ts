export interface FrameCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}
export const MAX_STRIP_FRAMES = 120;
export function stripFrames(
  start: number,
  end: number,
  duration: number,
): number[] {
  if (
    ![start, end, duration].every(Number.isSafeInteger) ||
    start < 0 ||
    end <= start ||
    end > duration ||
    end - start > MAX_STRIP_FRAMES
  )
    throw Error(
      `Frame strip requires a half-open range within the project, at most ${MAX_STRIP_FRAMES} frames`,
    );
  return Array.from({ length: end - start }, (_, i) => start + i);
}
export function parseCrop(
  text: string,
  canvas: { width: number; height: number },
): FrameCrop {
  if (!/^\d+,\d+,\d+,\d+$/.test(text))
    throw Error('--crop requires x,y,width,height frame-space integers');
  const [x, y, width, height] = text.split(',').map(Number) as [
    number,
    number,
    number,
    number,
  ];
  if (
    ![x, y, width, height].every(Number.isSafeInteger) ||
    width <= 0 ||
    height <= 0 ||
    x + width > canvas.width ||
    y + height > canvas.height
  )
    throw Error('Crop must fit within the frame');
  return { x, y, width, height };
}
/** Visual crop only: full-frame PNG bytes remain embedded; this is not redaction. */
export function reviewSvg(
  frames: number[],
  images: Buffer[],
  canvas: { width: number; height: number },
  crop?: FrameCrop,
): string {
  if (!frames.length || frames.length !== images.length)
    throw Error('Each selected frame requires one image');
  const columns = Math.min(3, frames.length),
    width = 480;
  const region = crop ?? { x: 0, y: 0, ...canvas };
  const height = (width * region.height) / region.width;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${columns * width}" height="${Math.ceil(frames.length / columns) * (height + 28)}">${images
    .map((bytes, index) => {
      const x = (index % columns) * width,
        y = Math.floor(index / columns) * (height + 28);
      return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${region.x} ${region.y} ${region.width} ${region.height}" overflow="hidden"><image width="${canvas.width}" height="${canvas.height}" href="data:image/png;base64,${bytes.toString('base64')}"/></svg><text x="${x + 8}" y="${y + height + 20}" font-size="16">Frame ${frames[index]}</text>`;
    })
    .join('')}</svg>`;
}
/** Quality-review candidates only; never substitutes for determinism gate frames. */
export function selectReviewFrames(
  duration: number,
  ranges: { startFrame: number; endFrame: number }[],
): number[] {
  if (!Number.isSafeInteger(duration) || duration <= 0)
    throw Error('Positive frame duration required');
  const frames = new Set([0, duration - 1]);
  for (const range of ranges) {
    if (
      !Number.isSafeInteger(range.startFrame) ||
      !Number.isSafeInteger(range.endFrame) ||
      range.startFrame < 0 ||
      range.endFrame <= range.startFrame ||
      range.endFrame > duration
    )
      throw Error('Review range outside project');
    frames.add(range.startFrame);
    frames.add(range.endFrame - 1);
  }
  return [...frames].sort((a, b) => a - b);
}
