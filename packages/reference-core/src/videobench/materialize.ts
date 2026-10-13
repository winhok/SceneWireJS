import { sep } from 'node:path';
import { z } from 'zod';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rename,
  rm,
  lstat,
  realpath,
} from 'node:fs/promises';
import {
  dirname,
  basename,
  resolve,
  relative,
  isAbsolute,
  join,
} from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  canonicalDigest,
  outputIdentity,
  relativePathSchema,
  type CandidateBinding,
} from '@scenewirejs/production-core';
import { benchmarkCandidateSchema, type BenchmarkCandidate } from './candidate';
import { benchIdSchema, benchmarkArmSchema } from './common';
import {
  videoBenchEvidenceSchema,
  representativeFramesSchema,
  frameStripArtifactSchema,
  type VideoBenchEvidence,
  type RepresentativeFrames,
  type FrameStripArtifact,
} from './evidence';
import { deterministicReviewRecordSchema } from './review';
import {
  diagnosticConfigSchema,
  diagnosePixels,
  type PixelSample,
} from './diagnostics';
import { videoBenchBinding } from './validation';

const selection = z
  .object({
    reason: representativeFramesSchema.shape.frames.element.shape.reason,
    rationale: representativeFramesSchema.shape.frames.element.shape.rationale,
    timeMs: z.number().nonnegative(),
    derivation: z.string().min(1),
  })
  .strict()
  .refine(
    (v) => v.reason !== 'manual' || !!v.rationale,
    'Manual selection requires rationale',
  );
/** Operational input only; neither request paths nor attempts become candidate identity. */
const planSchema = z
  .object({
    caseId: benchIdSchema,
    arm: benchmarkArmSchema,
    representative: z.array(selection).min(1).max(120),
    strips: z
      .array(
        z
          .object({
            startMs: z.number().nonnegative(),
            endMs: z.number().positive(),
            cadenceMs: z.number().positive(),
            purpose: frameStripArtifactSchema.shape.purpose,
          })
          .strict(),
      )
      .max(12),
    diagnosticStrip: z.number().int().nonnegative(),
    transitions: z.array(z.number().nonnegative()).max(32),
    diagnostics: diagnosticConfigSchema,
    limits: z
      .object({
        maxFrames: z.number().int().min(2).max(120),
        maxStripMs: z.number().positive().max(30000),
        timeoutMs: z.number().int().min(1).max(600000),
        maxBytes: z.number().int().min(1024).max(536870912),
      })
      .strict(),
  })
  .strict();
export type EvidenceCapturePlan = z.infer<typeof planSchema>;
type RasterEnvironment = NonNullable<BenchmarkCandidate['environment']>;
export interface EvidenceCaptureAdapter {
  /** Must resolve source/project/assets and output bytes before any frame capture. */
  resolve(signal: AbortSignal): Promise<{
    binding: CandidateBinding;
    renderDigest: string;
    durationMs: number;
    environment?: RasterEnvironment;
    tool: { id: string; version: string };
    config: Record<string, string | number | boolean>;
  }>;
  /** Decode the exact verified production output, retaining native frame size. */
  capture(
    timesMs: number[],
    signal: AbortSignal,
    maxBytes: number,
  ): Promise<Buffer[]>;
  /** New independent production evaluation for every call. */
  evaluate(
    timesMs: number[],
    signal: AbortSignal,
    maxBytes: number,
  ): Promise<{ frames: Buffer[]; environment?: RasterEnvironment }>;
  pixels(bytes: Buffer): Omit<PixelSample, 'id' | 'timeMs'>;
  grid(bytes: Buffer[], columns: number, width: number, height: number): Buffer;
}
const same = (a: unknown, b: unknown) =>
  canonicalDigest('videobench/equality-v1', a) ===
  canonicalDigest('videobench/equality-v1', b);
const bundleSchema = z
  .object({
    version: z.literal(1),
    candidate: benchmarkCandidateSchema,
    plan: planSchema,
    evidence: z.array(videoBenchEvidenceSchema).min(1),
    technical: deterministicReviewRecordSchema,
    semanticDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type MaterializedEvidenceBundle = z.infer<typeof bundleSchema>;
const digestBundle = (v: Omit<MaterializedEvidenceBundle, 'semanticDigest'>) =>
  canonicalDigest('videobench/materialized-evidence-v1', v);

function requestedTimes(
  plan: EvidenceCapturePlan,
  candidate: BenchmarkCandidate,
) {
  const all = plan.representative.map((s) => s.timeMs);
  if (plan.diagnosticStrip >= plan.strips.length)
    throw Error('Diagnostic strip required');
  for (const strip of plan.strips) {
    if (
      strip.endMs <= strip.startMs ||
      strip.endMs - strip.startMs > plan.limits.maxStripMs ||
      strip.endMs >= candidate.durationMs
    )
      throw Error('Strip range exceeds duration/bounds');
    const count =
      Math.floor((strip.endMs - strip.startMs) / strip.cadenceMs) + 1;
    if (count < 2 || count > plan.limits.maxFrames)
      throw Error('Strip cadence/frame limit');
    for (let i = 0; i < count; i++)
      all.push(strip.startMs + i * strip.cadenceMs);
  }
  const times = [...new Set(all)].sort((a, b) => a - b);
  if (
    times.length > plan.limits.maxFrames ||
    times.some(
      (t) => !Number.isFinite(t) || t < 0 || t >= candidate.durationMs,
    ) ||
    plan.transitions.some((t) => t >= candidate.durationMs)
  )
    throw Error('Timestamp/frame limit');
  const diagnostic = plan.strips[plan.diagnosticStrip]!;
  if (
    plan.transitions.some(
      (t) => t <= diagnostic.startMs || t > diagnostic.endMs,
    )
  )
    throw Error('Transition boundary lacks diagnostic strip coverage');
  return times;
}

/** Filesystem paths are independently confined; schema validity never implies byte validity. */
async function confined(root: string, path: string) {
  relativePathSchema.parse(path);
  const base = await realpath(root);
  let cursor = base;
  for (const segment of path.split('/')) {
    cursor = join(cursor, segment);
    if ((await lstat(cursor)).isSymbolicLink())
      throw Error('Evidence symlink rejected');
  }
  const target = await realpath(cursor),
    rel = relative(base, target);
  if (
    rel === '..' ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel) ||
    !(await lstat(target)).isFile()
  )
    throw Error('Evidence path escape/non-file');
  return target;
}

/** Revalidates immutable semantic content plus every referenced artifact byte. */
export async function validateMaterializedEvidence(
  root: string,
  expected: {
    candidate: BenchmarkCandidate;
    plan: EvidenceCapturePlan;
    semanticDigest?: string;
    caseId: string;
    arm: 'baseline' | 'candidate';
  },
  codec: Pick<EvidenceCaptureAdapter, 'pixels' | 'grid'>,
) {
  const errors: string[] = [];
  try {
    const manifestPath = await confined(root, 'manifest.json');
    if ((await lstat(manifestPath)).size > 4 * 1024 * 1024)
      throw Error('Manifest byte limit');
    const bundle = bundleSchema.parse(
      JSON.parse(await readFile(manifestPath, 'utf8')),
    );
    const { semanticDigest, ...content } = bundle;
    if (digestBundle(content) !== semanticDigest)
      throw Error('Bundle semantic digest mismatch');
    if (
      expected.semanticDigest !== undefined &&
      semanticDigest !== expected.semanticDigest
    )
      throw Error('Trusted frozen evidence digest mismatch');
    if (
      !same(
        bundle.candidate,
        benchmarkCandidateSchema.parse(expected.candidate),
      ) ||
      bundle.plan.caseId !== expected.caseId ||
      bundle.plan.arm !== expected.arm ||
      !same(bundle.plan, planSchema.parse(expected.plan))
    )
      throw Error('Expected candidate/case/arm mismatch');
    const times = requestedTimes(bundle.plan, bundle.candidate);
    const reps = bundle.evidence.filter(
      (e): e is RepresentativeFrames => e.kind === 'representative-frames',
    );
    if (reps.length !== 1) throw Error('One frame store required');
    if (
      bundle.evidence.filter((e) => e.kind === 'contact-sheet').length !== 1 ||
      bundle.evidence.filter((e) => e.kind === 'diagnostic').length !== 1 ||
      bundle.evidence.filter((e) => e.kind === 'frame-strip').length !==
        bundle.plan.strips.length
    )
      throw Error('Incomplete artifact inventory');
    const frames = reps[0]!.frames.map((f) => f.frame);
    const fm = new Map(frames.map((f) => [f.id, f]));
    if (
      fm.size !== frames.length ||
      !same(
        frames.map((f) => f.timeMs),
        times,
      )
    )
      throw Error('Frame inventory mismatch');
    const ids = bundle.evidence.map((e) => e.id);
    if (new Set([...ids, ...fm.keys()]).size !== ids.length + fm.size)
      throw Error('Duplicate evidence ID');
    const capture = reps[0]!.capture;
    const bytes = new Map<string, Buffer>();
    for (const f of frames)
      bytes.set(f.id, await readFile(await confined(root, f.path)));
    for (const e of bundle.evidence) {
      if (
        e.caseId !== expected.caseId ||
        e.arm !== expected.arm ||
        !same(e.candidate, videoBenchBinding('candidate', bundle.candidate)) ||
        e.sourceSha256 !== bundle.candidate.binding.sourceSha256 ||
        e.outputDigest !== bundle.candidate.renderDigest ||
        !same(e.capture, capture) ||
        !same(
          e.capture.environment ?? null,
          bundle.candidate.environment ?? null,
        )
      )
        throw Error('Evidence source/output/candidate/environment mismatch');
      if (e.kind === 'representative-frames') {
        for (const f of frames) {
          if (
            f.sourceSha256 !== bundle.candidate.renderDigest ||
            outputIdentity(bytes.get(f.id)!) !== f.sha256
          )
            throw Error('Frame bytes/output mismatch');
          codec.pixels(Buffer.from(bytes.get(f.id)!));
        }
      } else {
        if (
          outputIdentity(
            await readFile(await confined(root, e.artifact.path)),
          ) !== e.artifact.sha256
        )
          throw Error('Artifact bytes mismatch');
        if (e.kind === 'contact-sheet' || e.kind === 'frame-strip') {
          const selected = e.frameIds.map((id) => fm.get(id));
          if (
            new Set(e.frameIds).size !== e.frameIds.length ||
            selected.some(
              (f, i) => !f || (i > 0 && f.timeMs <= selected[i - 1]!.timeMs),
            )
          )
            throw Error('Unknown/nonchronological artifact frame');
          if (
            e.kind === 'contact-sheet' &&
            e.labels.length !== e.frameIds.length
          )
            throw Error('Missing labels');
          if (e.kind === 'contact-sheet') {
            const selectedTimes = [
              ...new Set(bundle.plan.representative.map((r) => r.timeMs)),
            ].sort((a, b) => a - b);
            if (
              !same(
                selected.map((f) => f!.timeMs),
                selectedTimes,
              ) ||
              !same(
                e.labels,
                selectedTimes.map((t) => `${t}ms`),
              )
            )
              throw Error('Sheet selection differs from presealed plan');
          } else {
            const index = bundle.evidence
                .filter((x) => x.kind === 'frame-strip')
                .findIndex((x) => x.id === e.id),
              planned = bundle.plan.strips[index]!;
            if (
              !same(e.range, {
                startMs: planned.startMs,
                endMs: planned.endMs,
              }) ||
              e.cadenceMs !== planned.cadenceMs ||
              e.purpose !== planned.purpose
            )
              throw Error('Strip differs from presealed plan');
          }
          const dimensions =
            e.kind === 'contact-sheet'
              ? e.layout
              : {
                  columns: Math.min(6, e.frameIds.length),
                  cellWidth: 160,
                  cellHeight: 90,
                };
          if (
            outputIdentity(
              codec.grid(
                e.frameIds.map((id) => Buffer.from(bytes.get(id)!)),
                dimensions.columns,
                dimensions.cellWidth,
                dimensions.cellHeight,
              ),
            ) !== e.artifact.sha256
          )
            throw Error('Artifact not derived from bound frame bytes');
          if (e.kind === 'frame-strip') {
            const count =
              Math.floor((e.range.endMs - e.range.startMs) / e.cadenceMs) + 1;
            if (
              e.range.endMs >= bundle.candidate.durationMs ||
              count !== selected.length ||
              selected.some(
                (f, i) =>
                  Math.abs(f!.timeMs - e.range.startMs - i * e.cadenceMs) >
                  1e-6,
              )
            )
              throw Error('Strip range/cadence mismatch');
          }
        } else {
          if (
            e.findings.some((f) =>
              f.evidenceIds.some((id) => !ids.includes(id) && !fm.has(id)),
            )
          )
            throw Error('Foreign diagnostic reference');
          const raw = JSON.parse(
            await readFile(await confined(root, e.artifact.path), 'utf8'),
          );
          const strip = bundle.evidence.filter(
            (x): x is FrameStripArtifact => x.kind === 'frame-strip',
          )[bundle.plan.diagnosticStrip];
          if (!strip) throw Error('Missing diagnostic strip');
          const measured = diagnosePixels(
            strip.frameIds.map((id) => {
              const decoded = codec.pixels(Buffer.from(bytes.get(id)!));
              return {
                id,
                timeMs: fm.get(id)!.timeMs,
                ...decoded,
                pixels: Buffer.from(decoded.pixels),
              };
            }),
            bundle.plan.diagnostics,
            strip.cadenceMs,
            bundle.plan.transitions,
          );
          if (
            !same(
              Object.keys(raw).sort(),
              [
                ...Object.keys(measured),
                'determinism',
                'safeArea',
                'duration',
                'frameCount',
                'runtimeErrors',
              ].sort(),
            )
          )
            throw Error('Unexpected diagnostic fields');
          for (const key of Object.keys(measured))
            if (!same(raw[key], measured[key as keyof typeof measured]))
              throw Error(`Diagnostic measurement/config mismatch: ${key}`);
          if (
            !Array.isArray(raw.determinism?.comparisons) ||
            raw.determinism.comparisons.length !== times.length
          )
            throw Error('Missing independent evaluation evidence');
          for (const [i, c] of raw.determinism.comparisons.entries()) {
            if (c.timeMs !== times[i] || c.frameId !== frames[i]!.id)
              throw Error('Foreign determinism frame');
            for (const pass of [1, 2]) {
              const digest = pass === 1 ? c.first : c.second;
              if (
                digest !== null &&
                outputIdentity(
                  await readFile(
                    await confined(
                      root,
                      `diagnostics/evaluation-${pass}-${i}.png`,
                    ),
                  ),
                ) !== digest
              )
                throw Error('Independent evaluation bytes mismatch');
            }
          }
          const evaluated = raw.determinism.comparisons;
          const environments = raw.determinism.evaluationEnvironments;
          if (!Array.isArray(environments) || environments.length !== 2)
            throw Error('Missing evaluation environment');
          const outcome =
            environments.some(
              (env) => !same(env, bundle.candidate.environment ?? null),
            ) ||
            evaluated.some(
              (c: { first: string | null; second: string | null }) =>
                !c.first || !c.second,
            )
              ? 'inconclusive'
              : evaluated.every(
                    (c: { first: string; second: string }) =>
                      c.first === c.second,
                  )
                ? 'pass'
                : 'fail';
          if (
            raw.determinism.outcome !== outcome ||
            bundle.technical.findings.find((f) => f.targetId === 'determinism')
              ?.outcome !== outcome
          )
            throw Error('Determinism outcome mismatch');
          if (
            bundle.technical.toolDigest !==
            canonicalDigest('videobench/evaluator-v1', {
              tool: capture.tool,
              config: measured.evaluatorDigest,
            })
          )
            throw Error('Evaluator implementation/config mismatch');
          if (
            !same(
              raw.determinism.environment ?? null,
              bundle.candidate.environment ?? null,
            ) ||
            !same(raw.determinism.config, capture.config)
          )
            throw Error('Determinism capture identity mismatch');
          const expectations: Record<string, string> = {
            'freeze-run': measured.freezeRuns.length ? 'fail' : 'pass',
            'black-tail': measured.blackTail ? 'fail' : 'pass',
            'motion-jump': measured.jumps.length ? 'fail' : 'pass',
            'transition-diagnostic': measured.transitions.some(
              (t) => t.condition === 'discontinuity',
            )
              ? 'fail'
              : measured.transitions.some(
                    (t) => t.condition === 'inconclusive',
                  ) || !bundle.plan.transitions.length
                ? 'inconclusive'
                : 'pass',
          };
          if (
            e.findings.length !== 4 ||
            !same(
              e.findings.map((f) => f.targetId).sort(),
              Object.keys(expectations).sort(),
            ) ||
            e.findings.some(
              (f) =>
                f.outcome !== expectations[f.targetId] ||
                !same(f.evidenceIds, [strip.id]),
            )
          )
            throw Error('Diagnostic condition verdict mismatch');
        }
      }
    }
    if (
      bundle.technical.caseId !== expected.caseId ||
      bundle.technical.arm !== expected.arm ||
      bundle.technical.evidenceIds.some((id) => !ids.includes(id))
    )
      throw Error('Foreign technical evidence');
    if (
      !same(bundle.technical.findings.map((f) => f.targetId).sort(), [
        'determinism',
        'safe-area',
      ]) ||
      bundle.technical.findings.find((f) => f.targetId === 'safe-area')
        ?.outcome !== 'inconclusive'
    )
      throw Error('Unavailable geometry cannot pass');
    return { valid: true as const, errors, bundle };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return { valid: false as const, errors };
  }
}

/** Atomic single-host materialization. Existing finalized directories are never mutated. */
export async function materializeVideoBenchEvidence(
  candidateInput: BenchmarkCandidate,
  planInput: EvidenceCapturePlan,
  adapter: EvidenceCaptureAdapter,
  destination: string,
) {
  const candidate = benchmarkCandidateSchema.parse(candidateInput),
    plan = planSchema.parse(planInput);
  const times = requestedTimes(plan, candidate),
    started = performance.now();
  destination = resolve(destination);
  const parent = await realpath(dirname(destination));
  // Canonicalize the explicitly chosen root (macOS /var and /tmp are system aliases).
  // References inside that root still reject every symlink component.
  destination = join(parent, basename(destination));
  const lock = destination + '.capture-lock';
  await mkdir(lock);
  let temporary: string | undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), plan.limits.timeoutMs);
  const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (controller.signal.aborted) throw Error('Capture timeout');
    let cancel: () => void = () => {};
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          cancel = () => reject(Error('Capture timeout'));
          controller.signal.addEventListener('abort', cancel, { once: true });
        }),
      ]);
    } finally {
      controller.signal.removeEventListener('abort', cancel);
    }
  };
  try {
    try {
      await lstat(destination);
      throw Error('Final evidence destination already exists');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const resolved = await bounded(() => adapter.resolve(controller.signal));
    if (
      !same(resolved.binding, candidate.binding) ||
      resolved.renderDigest !== candidate.renderDigest ||
      Math.abs(resolved.durationMs - candidate.durationMs) > 1e-6 ||
      !same(resolved.environment ?? null, candidate.environment ?? null)
    )
      throw Error(
        `Unresolved candidate/output/environment identity: ${[!same(resolved.binding, candidate.binding) ? 'binding' : '', resolved.renderDigest !== candidate.renderDigest ? 'output' : '', Math.abs(resolved.durationMs - candidate.durationMs) > 1e-6 ? 'duration' : '', !same(resolved.environment ?? null, candidate.environment ?? null) ? 'environment' : ''].filter(Boolean).join(', ')}`,
      );
    const capture = {
      tool: resolved.tool,
      config: {
        ...resolved.config,
        'plan-digest': canonicalDigest('videobench/capture-plan-v1', plan),
        'decoded-pixel-limit-bytes': 128 * 1024 * 1024,
      },
      ...(resolved.environment ? { environment: resolved.environment } : {}),
    };
    const prefix = plan.caseId + '-' + plan.arm;
    if (prefix.length > 70) throw Error('Case ID too long for evidence IDs');
    const scope = {
      version: 1 as const,
      caseId: plan.caseId,
      arm: plan.arm,
      candidate: videoBenchBinding('candidate', candidate),
      sourceSha256: candidate.binding.sourceSha256!,
      outputDigest: candidate.renderDigest,
      capture,
    };
    temporary = await mkdtemp(join(parent, '.videobench-attempt-'));
    for (const folder of ['frames', 'sheets', 'strips', 'diagnostics'])
      await mkdir(join(temporary, folder));
    let totalBytes = 0;
    const write = async (path: string, bytes: Buffer) => {
      if (controller.signal.aborted) throw Error('Capture timeout');
      totalBytes += bytes.length;
      if (totalBytes > plan.limits.maxBytes)
        throw Error('Evidence output size limit');
      await writeFile(join(temporary!, path), bytes, { flag: 'wx' });
      return { path, sha256: outputIdentity(bytes) };
    };
    const captured = (
      await bounded(() =>
        adapter.capture(times, controller.signal, plan.limits.maxBytes),
      )
    ).map((bytes) => Buffer.from(bytes));
    if (captured.length !== times.length) throw Error('Incomplete capture');
    const frames: RepresentativeFrames['frames'] = [];
    for (const [i, timeMs] of times.entries()) {
      const bytes = captured[i]!;
      adapter.pixels(Buffer.from(bytes));
      const artifact = await write(
        `frames/frame-${String(i).padStart(3, '0')}.png`,
        bytes,
      );
      const requested = plan.representative.find((r) => r.timeMs === timeMs);
      frames.push({
        frame: {
          id: `${prefix}-frame-${i}`,
          timeMs,
          ...artifact,
          sourceSha256: candidate.renderDigest,
          seekMode: 'accurate',
        },
        reason: requested?.reason ?? 'manual',
        ...(requested?.rationale
          ? { rationale: requested.rationale }
          : !requested
            ? { rationale: 'Presealed regular temporal diagnostic sample' }
            : {}),
      });
    }
    const evidence: VideoBenchEvidence[] = [
      {
        ...scope,
        id: prefix + '-frames',
        kind: 'representative-frames',
        frames,
      },
    ];
    const artifactsStarted = performance.now();
    const repIndices = plan.representative
      .map((r) => times.indexOf(r.timeMs))
      .sort((a, b) => a - b)
      .filter((v, i, a) => i === 0 || v !== a[i - 1]);
    const representative = repIndices.map((i) => frames[i]!.frame);
    const columns = Math.min(3, representative.length),
      cellWidth = 320,
      cellHeight = 180;
    const sheet = await write(
      'sheets/contact.png',
      adapter.grid(
        repIndices.map((i) => Buffer.from(captured[i]!)),
        columns,
        cellWidth,
        cellHeight,
      ),
    );
    evidence.push({
      ...scope,
      id: prefix + '-sheet',
      kind: 'contact-sheet',
      frameIds: representative.map((f) => f.id),
      labels: representative.map((f) => `${f.timeMs}ms`),
      ordering: 'chronological',
      layout: { columns, cellWidth, cellHeight },
      generation: {
        tool: resolved.tool,
        config: { resampling: 'nearest', labels: 'manifest' },
      },
      artifact: sheet,
    });
    const strips: FrameStripArtifact[] = [];
    for (const [i, s] of plan.strips.entries()) {
      const selected = frames.filter(
        (f) =>
          f.frame.timeMs >= s.startMs &&
          f.frame.timeMs <= s.endMs &&
          Math.abs(
            (f.frame.timeMs - s.startMs) / s.cadenceMs -
              Math.round((f.frame.timeMs - s.startMs) / s.cadenceMs),
          ) < 1e-6,
      );
      const strip: FrameStripArtifact = {
        ...scope,
        id: `${prefix}-strip-${i}`,
        kind: 'frame-strip',
        range: { startMs: s.startMs, endMs: s.endMs },
        cadenceMs: s.cadenceMs,
        purpose: s.purpose,
        frameIds: selected.map((f) => f.frame.id),
        artifact: await write(
          `strips/strip-${i}.png`,
          adapter.grid(
            selected.map((f) =>
              Buffer.from(captured[times.indexOf(f.frame.timeMs)]!),
            ),
            Math.min(6, selected.length),
            160,
            90,
          ),
        ),
      };
      strips.push(strip);
      evidence.push(strip);
    }
    const artifactMs = performance.now() - artifactsStarted,
      diagnosticStarted = performance.now();
    const diagnosticStrip = strips[plan.diagnosticStrip]!;
    let decodedBytes = 0;
    // Adapter helpers receive disposable copies; identities and measurements use
    // the same retained capture snapshots that were written to the sealed files.
    const captureById = new Map(
      frames.map((entry, index) => [
        entry.frame.id,
        { frame: entry.frame, bytes: captured[index]! },
      ]),
    );
    const pixelSamples = [];
    for (const id of diagnosticStrip.frameIds) {
      const sample = captureById.get(id)!;
      const pixels = adapter.pixels(Buffer.from(sample.bytes));
      decodedBytes += pixels.pixels.length;
      if (decodedBytes > 128 * 1024 * 1024)
        throw Error('Decoded diagnostic pixel budget exceeded');
      pixelSamples.push({
        id,
        timeMs: sample.frame.timeMs,
        ...pixels,
        pixels: Buffer.from(pixels.pixels),
      });
    }
    const diagnostics = diagnosePixels(
      pixelSamples,
      plan.diagnostics,
      diagnosticStrip.cadenceMs,
      plan.transitions,
    );
    if (
      plan.representative.some(
        (r) =>
          r.reason === 'peak-motion' &&
          r.timeMs !== diagnostics.motionProfile.peakTimeMs,
      )
    )
      throw Error('Peak-motion selection differs from frozen diagnostic');
    const evaluate = async () => {
      try {
        return await bounded(() =>
          adapter.evaluate(times, controller.signal, plan.limits.maxBytes),
        );
      } catch (error) {
        if (
          controller.signal.aborted ||
          /identity|source|output|environment|changed|budget|limit|timeout|cancel/i.test(
            error instanceof Error ? error.message : String(error),
          )
        )
          throw error;
        return {
          frames: [] as Buffer[],
          environment: candidate.environment,
          error: 'Independent evaluation unavailable',
        };
      }
    };
    const first = await evaluate();
    // Each evaluation must instantiate a new production session, never reuse captured output buffers.
    const second = await evaluate();
    let outcome: 'pass' | 'fail' | 'inconclusive' = 'inconclusive';
    const comparable =
      first.frames.length === times.length &&
      second.frames.length === times.length &&
      same(first.environment ?? null, candidate.environment ?? null) &&
      same(second.environment ?? null, first.environment ?? null);
    const comparisons = times.map((timeMs, i) => ({
      timeMs,
      frameId: frames[i]!.frame.id,
      first: first.frames[i] ? outputIdentity(first.frames[i]!) : null,
      second: second.frames[i] ? outputIdentity(second.frames[i]!) : null,
    }));
    if (comparable)
      outcome = comparisons.every((c) => c.first === c.second)
        ? 'pass'
        : 'fail';
    // Independent bytes remain inspectable; references reuse the primary frame store elsewhere.
    for (const [pass, result] of [first, second].entries())
      for (const [i, bytes] of result.frames.entries())
        await write(`diagnostics/evaluation-${pass + 1}-${i}.png`, bytes);
    const raw = {
      ...diagnostics,
      determinism: {
        outcome,
        comparisons,
        environment: candidate.environment ?? null,
        evaluationEnvironments: [
          first.environment ?? null,
          second.environment ?? null,
        ],
        config: capture.config,
      },
      safeArea: {
        outcome: 'inconclusive',
        reason: 'No trustworthy structured safe-region geometry supplied',
      },
      duration: {
        durationMs: resolved.durationMs,
        authority: 'resolved-production-candidate',
      },
      frameCount: { captured: times.length, authority: 'capture-plan' },
      runtimeErrors: [
        ...('error' in first ? [first.error] : []),
        ...('error' in second ? [second.error] : []),
      ],
    };
    const diagnosticArtifact = await write(
      'diagnostics/raw.json',
      Buffer.from(JSON.stringify(raw, null, 2) + '\n'),
    );
    evidence.push({
      ...scope,
      id: prefix + '-diagnostic',
      kind: 'diagnostic',
      artifact: diagnosticArtifact,
      measurements: [],
      findings: [
        {
          id: prefix + '-freeze',
          targetId: 'freeze-run',
          outcome: diagnostics.freezeRuns.length ? 'fail' : 'pass',
          rationale: 'Configured similarity-run condition; no creative verdict',
          evidenceIds: [diagnosticStrip.id],
        },
        {
          id: prefix + '-tail',
          targetId: 'black-tail',
          outcome: diagnostics.blackTail ? 'fail' : 'pass',
          rationale:
            'Configured near-black tail condition; intent not inferred',
          evidenceIds: [diagnosticStrip.id],
        },
        {
          id: prefix + '-jump',
          targetId: 'motion-jump',
          outcome: diagnostics.jumps.length ? 'fail' : 'pass',
          rationale: 'Configured local difference spike; no taste gate',
          evidenceIds: [diagnosticStrip.id],
        },
        {
          id: prefix + '-transition',
          targetId: 'transition-diagnostic',
          outcome: diagnostics.transitions.some(
            (t) => t.condition === 'discontinuity',
          )
            ? 'fail'
            : diagnostics.transitions.some(
                  (t) => t.condition === 'inconclusive',
                ) || !plan.transitions.length
              ? 'inconclusive'
              : 'pass',
          rationale: 'Known seam samples; no transition quality judgment',
          evidenceIds: [diagnosticStrip.id],
        },
      ],
    });
    const technical = deterministicReviewRecordSchema.parse({
      version: 1,
      id: prefix + '-technical',
      reviewerType: 'deterministic',
      reviewerId: 'scenewire-capture',
      caseId: plan.caseId,
      arm: plan.arm,
      toolDigest: canonicalDigest('videobench/evaluator-v1', {
        tool: capture.tool,
        config: diagnostics.evaluatorDigest,
      }),
      evidenceIds: [prefix + '-diagnostic'],
      findings: [
        {
          targetId: 'determinism',
          outcome,
          rationale:
            'Exact PNG bytes from two independent evaluations in the declared environment',
        },
        {
          targetId: 'safe-area',
          outcome: 'inconclusive',
          rationale: 'Structured safe-region geometry unavailable',
        },
      ],
    });
    const content = {
      version: 1 as const,
      candidate,
      plan,
      evidence,
      technical,
    };
    const bundle = { ...content, semanticDigest: digestBundle(content) };
    await write(
      'manifest.json',
      Buffer.from(JSON.stringify(bundle, null, 2) + '\n'),
    );
    const validation = await validateMaterializedEvidence(
      temporary,
      { candidate, plan, caseId: plan.caseId, arm: plan.arm },
      adapter,
    );
    if (!validation.valid) throw Error(validation.errors.join('; '));
    if (controller.signal.aborted) throw Error('Capture timeout');
    await rename(temporary, destination);
    temporary = undefined;
    return {
      valid: true,
      bundle,
      performance: {
        wallClockMs: performance.now() - started,
        framesRendered: times.length * 2,
        framesReused:
          representative.length +
          strips.reduce((n, s) => n + s.frameIds.length, 0),
        artifactMs,
        diagnosticMs: performance.now() - diagnosticStarted,
        totalBytes,
      },
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (temporary) await rm(temporary, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}
