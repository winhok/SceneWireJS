import { z } from 'zod';
import { canonicalDigest } from '@scenewirejs/production-core';

/** All thresholds describe technical conditions, never aesthetic merit. */
export const diagnosticConfigSchema = z
  .object({
    energyDecimals: z.number().int().min(1).max(12),
    pixelTolerance: z.number().int().min(0).max(255),
    freezeEnergy: z.number().min(0).max(1),
    freezeMinMs: z.number().positive(),
    blackChannelMax: z.number().int().min(0).max(255),
    blackAreaRatio: z.number().min(0).max(1),
    blackTailMinMs: z.number().positive(),
    jumpEnergy: z.number().min(0).max(1),
    jumpNeighborRatio: z.number().min(1),
  })
  .strict();
export type DiagnosticConfig = z.infer<typeof diagnosticConfigSchema>;
export const developmentDiagnosticConfig: DiagnosticConfig = {
  energyDecimals: 12,
  pixelTolerance: 2,
  freezeEnergy: 0.001,
  freezeMinMs: 500,
  blackChannelMax: 8,
  blackAreaRatio: 0.98,
  blackTailMinMs: 250,
  jumpEnergy: 0.3,
  jumpNeighborRatio: 3,
};
export interface PixelSample {
  id: string;
  timeMs: number;
  width: number;
  height: number;
  channels: number;
  pixels: Uint8Array;
}
export interface DiagnosticCondition {
  startMs: number;
  endMs: number;
  durationMs: number;
  frameCount: number;
  frameIds: string[];
}
/** Raw energy stays on the absolute 0..1 scale; no per-video peak normalization. */
export function diagnosePixels(
  input: PixelSample[],
  configInput: DiagnosticConfig,
  cadenceMs: number,
  transitions: number[] = [],
) {
  const config = diagnosticConfigSchema.parse(configInput);
  if (
    !Number.isFinite(cadenceMs) ||
    cadenceMs <= 0 ||
    input.length < 2 ||
    input.length > 120
  )
    throw Error('Bounded regular samples required');
  const first = input[0]!;
  if (
    first.width < 1 ||
    first.height < 1 ||
    first.width * first.height > 16777216 ||
    ![3, 4].includes(first.channels)
  )
    throw Error('Invalid sample dimensions');
  for (const [i, s] of input.entries()) {
    if (
      s.width !== first.width ||
      s.height !== first.height ||
      s.channels !== first.channels ||
      s.pixels.length !== s.width * s.height * s.channels ||
      !Number.isFinite(s.timeMs) ||
      s.timeMs < 0 ||
      (i && Math.abs(s.timeMs - input[i - 1]!.timeMs - cadenceMs) > 1e-6)
    )
      throw Error('Incomparable/cadence-mismatched samples');
  }
  if (new Set(input.map((s) => s.id)).size !== input.length)
    throw Error('Duplicate diagnostic frame');
  // Keep hot pixel loops separate from boxed fractional result objects. Some
  // Maglev runtimes reuse a mutable HeapNumber when materializing such objects
  // after deoptimization. Typed storage also preserves integer totals above the
  // Smi range: the bounded maximum (16777216 * 3 * 255) is exactly representable.
  const blackTotals = new Float64Array(input.length * 2);
  for (const [i, s] of input.entries()) {
    let count = 0,
      luminanceSum = 0;
    for (let p = 0; p < s.width * s.height; p++) {
      const offset = p * s.channels;
      luminanceSum +=
        s.pixels[offset]! + s.pixels[offset + 1]! + s.pixels[offset + 2]!;
      if (
        s.pixels[offset]! <= config.blackChannelMax &&
        s.pixels[offset + 1]! <= config.blackChannelMax &&
        s.pixels[offset + 2]! <= config.blackChannelMax
      )
        count++;
    }
    blackTotals[i * 2] = count;
    blackTotals[i * 2 + 1] = luminanceSum;
  }
  const black = input.map((s, i) => {
    return {
      frameId: s.id,
      timeMs: s.timeMs,
      nearBlackAreaRatio: blackTotals[i * 2]! / (s.width * s.height),
      meanLuminance: blackTotals[i * 2 + 1]! / (s.width * s.height * 3 * 255),
    };
  });
  const pairTotals = new Float64Array((input.length - 1) * 2);
  for (let i = 0; i < input.length - 1; i++) {
    const a = input[i]!,
      b = input[i + 1]!;
    const aPixels = a.pixels,
      bPixels = b.pixels,
      aChannels = a.channels,
      bChannels = b.channels;
    let sum = 0,
      changed = 0;
    for (let p = 0; p < a.width * a.height; p++) {
      const ai = p * aChannels,
        bi = p * bChannels;
      const red = Math.abs(aPixels[ai]! - bPixels[bi]!);
      const green = Math.abs(aPixels[ai + 1]! - bPixels[bi + 1]!);
      const blue = Math.abs(aPixels[ai + 2]! - bPixels[bi + 2]!);
      sum += red + green + blue;
      if (
        red > config.pixelTolerance ||
        green > config.pixelTolerance ||
        blue > config.pixelTolerance
      )
        changed++;
    }
    pairTotals[i * 2] = sum;
    pairTotals[i * 2 + 1] = changed;
  }
  const pairs = input.slice(1).map((b, i) => {
    const a = input[i]!,
      sum = pairTotals[i * 2]!,
      changed = pairTotals[i * 2 + 1]!;
    return {
      timeMs: b.timeMs,
      frameIds: [a.id, b.id],
      // Integer fixed-point calculation makes precision explicit and reproducible
      // across cold/hot runtime evaluation. Preserve the exact integer numerator.
      energy:
        Number(
          (BigInt(sum) * BigInt(10 ** config.energyDecimals)) /
            BigInt(a.width * a.height * 3 * 255),
        ) /
        10 ** config.energyDecimals,
      absoluteChannelDelta: sum,
      changedAreaRatio: changed / (a.width * a.height),
    };
  });
  const condition = (start: number, end: number): DiagnosticCondition => ({
    startMs: input[start]!.timeMs,
    endMs: input[end]!.timeMs,
    durationMs: input[end]!.timeMs - input[start]!.timeMs,
    frameCount: end - start + 1,
    frameIds: input.slice(start, end + 1).map((s) => s.id),
  });
  const freezeRuns: DiagnosticCondition[] = [];
  let start = -1;
  for (let i = 0; i <= pairs.length; i++) {
    if (i < pairs.length && pairs[i]!.energy <= config.freezeEnergy) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      const run = condition(start, i);
      if (run.durationMs >= config.freezeMinMs) freezeRuns.push(run);
      start = -1;
    }
  }
  let tail = black.length;
  while (
    tail > 0 &&
    black[tail - 1]!.nearBlackAreaRatio >= config.blackAreaRatio
  )
    tail--;
  const tailRun =
    tail < input.length ? condition(tail, input.length - 1) : undefined;
  const blackTail =
    tailRun && tailRun.durationMs >= config.blackTailMinMs ? tailRun : null;
  const jumps = pairs.flatMap((p, i) => {
    const neighbors = [pairs[i - 1]?.energy, pairs[i + 1]?.energy].filter(
      (n): n is number => n !== undefined,
    );
    if (
      !neighbors.length ||
      p.energy < config.jumpEnergy ||
      p.energy <
        Math.max(...neighbors, config.freezeEnergy) * config.jumpNeighborRatio
    )
      return [];
    return [{ ...p, neighbors }];
  });
  const peak = pairs.reduce(
    (best, p) => (p.energy > best.energy ? p : best),
    pairs[0]!,
  );
  return {
    version: 1 as const,
    evaluatorDigest: canonicalDigest('videobench/pixel-diagnostics-v1', {
      config,
      cadenceMs,
      transitions,
    }),
    config,
    cadenceMs,
    samples: black,
    pairs,
    motionProfile: {
      meanEnergy: pairs.reduce((n, p) => n + p.energy, 0) / pairs.length,
      peakEnergy: peak.energy,
      peakTimeMs: peak.timeMs,
      staticPairRatio:
        pairs.filter((p) => p.energy <= config.freezeEnergy).length /
        pairs.length,
    },
    freezeRuns,
    blackTail,
    jumps,
    transitions: transitions.map((boundaryMs) => {
      const pair = pairs.find(
        (p) => p.timeMs >= boundaryMs && p.timeMs - cadenceMs < boundaryMs,
      );
      return {
        boundaryMs,
        pair: pair ?? null,
        condition: pair
          ? jumps.some((j) => j.timeMs === pair.timeMs)
            ? 'discontinuity'
            : 'observed'
          : 'inconclusive',
        blackFrames: black
          .filter(
            (b) =>
              Math.abs(b.timeMs - boundaryMs) <= cadenceMs &&
              b.nearBlackAreaRatio >= config.blackAreaRatio,
          )
          .map((b) => b.frameId),
      };
    }),
  };
}
