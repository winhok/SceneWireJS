import { inflateSync, deflateSync } from 'node:zlib';
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
    // None-filter rows already contain the complete decoded bytes. Copying the
    // row avoids per-channel predictor work without skipping PNG validation.
    if (filter === 0) {
      raw.copy(
        pixels,
        y * stride,
        y * (stride + 1) + 1,
        (y + 1) * (stride + 1),
      );
      continue;
    }
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

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Bounded, deterministic PNG generation with no timestamps or host metadata. */
export function encodeRgbPng(
  width: number,
  height: number,
  pixels: Uint8Array,
): Buffer {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 16777216 ||
    pixels.length !== width * height * 3
  )
    throw Error('Invalid/bounded RGB image required');
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name);
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length);
    type.copy(result, 4);
    data.copy(result, 8);
    result.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    raw.set(
      pixels.subarray(y * width * 3, (y + 1) * width * 3),
      y * (width * 3 + 1) + 1,
    );
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
/** Only the supplied frozen PNGs are consumed. Labels live in the bound artifact record. */
export function pngGrid(
  images: Buffer[],
  columns: number,
  cellWidth: number,
  cellHeight: number,
): Buffer {
  if (
    !images.length ||
    images.length > 120 ||
    !Number.isInteger(columns) ||
    columns < 1 ||
    columns > images.length ||
    !Number.isInteger(cellWidth) ||
    !Number.isInteger(cellHeight) ||
    cellWidth < 1 ||
    cellHeight < 1
  )
    throw Error('Invalid grid');
  const width = columns * cellWidth,
    height = Math.ceil(images.length / columns) * cellHeight;
  if (width * height > 16777216) throw Error('Grid output too large');
  const pixels = Buffer.alloc(width * height * 3);
  images.forEach((image, index) => {
    const source = pngPixels(image);
    for (let y = 0; y < cellHeight; y++)
      for (let x = 0; x < cellWidth; x++) {
        const from =
          (Math.floor((y * source.height) / cellHeight) * source.width +
            Math.floor((x * source.width) / cellWidth)) *
          source.channels;
        const to =
          ((Math.floor(index / columns) * cellHeight + y) * width +
            (index % columns) * cellWidth +
            x) *
          3;
        for (let c = 0; c < 3; c++) {
          const alpha =
            source.channels === 4 ? source.pixels[from + 3]! / 255 : 1;
          pixels[to + c] = Math.round(source.pixels[from + c]! * alpha);
        }
      }
  });
  return encodeRgbPng(width, height, pixels);
}
