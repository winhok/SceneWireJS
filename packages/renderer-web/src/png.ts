import { inflateSync } from 'node:zlib';
// Chromium screenshots are non-interlaced 8-bit RGB/RGBA PNGs. No private Playwright codec APIs.
export function pngPixels(png: Buffer) {
  if (
    !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw Error('Invalid PNG');
  let width = 0,
    height = 0,
    channels = 0;
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset),
      type = png.toString('ascii', offset + 4, offset + 8),
      data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      channels = data[9] === 2 ? 3 : data[9] === 6 ? 4 : 0;
      if (
        data[8] !== 8 ||
        data[12] !== 0 ||
        !channels ||
        width > 8192 ||
        height > 8192
      )
        throw Error('Unsupported screenshot PNG');
    }
    if (type === 'IDAT') chunks.push(data);
    offset += length + 12;
  }
  const stride = width * channels,
    raw = inflateSync(Buffer.concat(chunks), {
      maxOutputLength: (stride + 1) * height,
    }),
    pixels = Buffer.alloc(stride * height);
  if (raw.length !== (stride + 1) * height) throw Error('Incomplete PNG');
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    if (filter > 4) throw Error('Invalid PNG filter');
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x,
        a = x >= channels ? pixels[index - channels]! : 0,
        b = y ? pixels[index - stride]! : 0,
        c = y && x >= channels ? pixels[index - stride - channels]! : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? a
            : filter === 2
              ? b
              : filter === 3
                ? Math.floor((a + b) / 2)
                : paeth(a, b, c);
      pixels[index] = (raw[y * (stride + 1) + x + 1]! + predictor) & 255;
    }
  }
  return { width, height, channels, pixels };
}
export const sameEnvironmentTolerance = {
  maxChannelDelta: 1,
  maxChangedPixelFraction: 0.0001,
} as const;
export function comparePixels(first: Buffer, second: Buffer) {
  const a = pngPixels(first),
    b = pngPixels(second);
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels)
    throw Error('Frame dimensions differ');
  let changedPixels = 0,
    maxChannelDelta = 0;
  for (let pixel = 0; pixel < a.width * a.height; pixel++) {
    let changed = false;
    for (let channel = 0; channel < a.channels; channel++) {
      const index = pixel * a.channels + channel,
        delta = Math.abs(a.pixels[index]! - b.pixels[index]!);
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      changed ||= delta > 0;
    }
    if (changed) changedPixels++;
  }
  const changedPixelFraction = changedPixels / (a.width * a.height);
  return {
    matched:
      maxChannelDelta <= sameEnvironmentTolerance.maxChannelDelta &&
      changedPixelFraction <= sameEnvironmentTolerance.maxChangedPixelFraction,
    changedPixels,
    changedPixelFraction,
    maxChannelDelta,
  };
}
