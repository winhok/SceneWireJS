import { z } from 'zod';
const text = z.string().min(1);
const time = z.number().nonnegative();
const unit = z.number().min(0).max(1);
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const mediaProbeSchema = z
  .object({
    path: text,
    sha256: digestSchema,
    durationMs: time.positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    averageFrameRate: z.number().positive().optional(),
    videoCodec: text.optional(),
    audio: z
      .object({
        codec: text.optional(),
        sampleRate: z.number().positive().optional(),
        channels: z.number().int().positive().optional(),
      })
      .optional(),
    variableFrameRate: z.boolean().optional(),
  })
  .strict();
export type MediaProbe = z.infer<typeof mediaProbeSchema>;
export const shotCandidateSchema = z
  .object({
    id: text,
    startMs: time,
    endMs: time,
    confidence: unit.optional(),
    representativeTimesMs: z.array(time).min(1),
    evidence: z.enum(['hard-cut', 'fade', 'content-change', 'manual']),
  })
  .strict();
export type ShotCandidate = z.infer<typeof shotCandidateSchema>;
export const motionProfileSchema = z
  .object({
    samples: z.array(z.object({ timeMs: time, energy: unit }).strict()),
    shots: z.array(
      z
        .object({
          shotId: text,
          mean: unit,
          peak: unit,
          entry: unit,
          exit: unit,
        })
        .strict(),
    ),
    normalization: z.literal('reference-max'),
  })
  .strict();
export type MotionProfile = z.infer<typeof motionProfileSchema>;
export const audioProfileSchema = z
  .object({
    available: z.boolean(),
    samples: z.array(
      z.object({ timeMs: time, rms: unit, peak: unit }).strict(),
    ),
    silence: z.array(z.object({ startMs: time, endMs: time }).strict()),
  })
  .strict();
export type AudioProfile = z.infer<typeof audioProfileSchema>;
export const mediaTranscriptSchema = z
  .object({
    segments: z.array(z.object({ startMs: time, endMs: time, text }).strict()),
    provenance: text,
  })
  .strict();
export type MediaTranscript = z.infer<typeof mediaTranscriptSchema>;
export interface TranscriptProvider {
  transcribe(
    input: { path: string; sha256: string },
    signal?: AbortSignal,
  ): Promise<MediaTranscript>;
}
export const frameEvidenceSchema = z
  .object({
    id: text,
    timeMs: time,
    path: text,
    sha256: digestSchema,
    sourceSha256: digestSchema,
    shotId: text.optional(),
    seekMode: z.enum(['fast', 'accurate']),
  })
  .strict();
export type FrameEvidence = z.infer<typeof frameEvidenceSchema>;
export const referenceEvidenceSchema = z
  .object({
    version: z.literal(1),
    id: text,
    source: z.object({ path: text, sha256: digestSchema }).strict(),
    media: mediaProbeSchema,
    shotCandidates: z.array(shotCandidateSchema).min(1),
    frames: z.array(frameEvidenceSchema),
    motion: motionProfileSchema,
    audio: audioProfileSchema.optional(),
    transcript: mediaTranscriptSchema.optional(),
    extraction: z
      .object({
        ffmpegVersion: text,
        ffprobeVersion: text,
        config: z.record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean()]),
        ),
        timingsMs: z.record(z.string(), time),
      })
      .strict(),
  })
  .strict();
export type ReferenceEvidence = z.infer<typeof referenceEvidenceSchema>;
export const referenceSpecSchema = z
  .object({
    version: z.literal(1),
    id: text,
    evidenceId: text,
    sourceSha256: digestSchema,
    global: z
      .object({
        visualLanguage: text,
        palette: text,
        typographyHierarchy: text,
        density: text,
        lighting: text,
        motionCharacter: text,
        transitionLanguage: text,
      })
      .strict(),
    shots: z
      .array(
        z
          .object({
            id: text,
            evidenceShotIds: z.array(text).min(1),
            timeRange: z
              .object({ startMs: time, endMs: time })
              .strict()
              .optional(),
            role: text,
            framing: text,
            composition: text,
            focalHierarchy: text,
            textTreatment: text.optional(),
            motion: text,
            camera: text.optional(),
            temporalRhythm: text,
            transitionIn: text.optional(),
            transitionOut: text.optional(),
            visualRequirements: z.array(text),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type ReferenceSpec = z.infer<typeof referenceSpecSchema>;
export const referenceAlignmentSchema = z
  .object({
    version: z.literal(1),
    evidenceId: text,
    sourceSha256: digestSchema,
    mappings: z
      .array(
        z
          .object({
            sceneId: text,
            referenceShotIds: z.array(text).min(1),
            adaptationIntent: text,
            anchors: z
              .array(
                z
                  .object({ projectProgress: unit, referenceProgress: unit })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type ReferenceAlignment = z.infer<typeof referenceAlignmentSchema>;
export const referenceComparisonReportSchema = z
  .object({
    version: z.literal(1),
    referenceId: text,
    sourceSha256: digestSchema,
    projectId: text,
    projectSha256: digestSchema.optional(),
    renderSources: z
      .array(z.object({ path: text, sha256: digestSchema }).strict())
      .optional(),
    alignmentCoverage: unit,
    mappings: z.array(
      z
        .object({
          sceneId: text,
          motionCorrelation: z.number().min(-1).max(1).optional(),
          meanEnergyDifference: time.optional(),
          peakTimingDifference: unit.optional(),
          durationRatio: time,
          pairedFrames: z.array(text),
          anchorCoverage: unit,
        })
        .strict(),
    ),
    interpretation: z.literal(
      'Evidence only; human/vision style review required',
    ),
  })
  .strict();
export type ReferenceComparisonReport = z.infer<
  typeof referenceComparisonReportSchema
>;
export interface SceneRange {
  id: string;
  startFrame: number;
  durationFrames: number;
}
const duplicates = (ids: string[]) => new Set(ids).size !== ids.length;
function report<T>(
  schema: z.ZodType<T>,
  input: unknown,
  check: (v: T, errors: string[]) => void,
) {
  const p = schema.safeParse(input);
  if (!p.success)
    return {
      valid: false,
      errors: p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  const errors: string[] = [];
  check(p.data, errors);
  return { valid: !errors.length, errors, value: p.data };
}
export function validateReferenceEvidence(input: unknown) {
  return report(referenceEvidenceSchema, input, (e, errors) => {
    const end = e.media.durationMs,
      shots = new Map(e.shotCandidates.map((s) => [s.id, s]));
    if (e.source.sha256 !== e.media.sha256)
      errors.push('Source/media digest mismatch');
    if (
      duplicates(e.shotCandidates.map((s) => s.id)) ||
      duplicates(e.frames.map((f) => f.id))
    )
      errors.push('Duplicate evidence IDs');
    let previous = 0;
    for (const s of e.shotCandidates) {
      if (
        s.startMs !== previous ||
        s.endMs <= s.startMs ||
        s.endMs > end ||
        s.representativeTimesMs.some((t) => t < s.startMs || t >= s.endMs)
      )
        errors.push(`Invalid shot range: ${s.id}`);
      previous = s.endMs;
    }
    if (previous !== end)
      errors.push('Shot partition must cover source duration');
    for (const f of e.frames) {
      const s = f.shotId ? shots.get(f.shotId) : undefined;
      if (
        f.timeMs >= end ||
        f.sourceSha256 !== e.source.sha256 ||
        (f.shotId && (!s || f.timeMs < s.startMs || f.timeMs >= s.endMs))
      )
        errors.push(`Invalid frame: ${f.id}`);
    }
    for (const samples of [e.motion.samples, e.audio?.samples ?? []]) {
      let prev = -1;
      for (const s of samples) {
        if (s.timeMs <= prev || s.timeMs >= end)
          errors.push('Invalid sample time');
        prev = s.timeMs;
      }
    }
    if (
      duplicates(e.motion.shots.map((s) => s.shotId)) ||
      e.motion.shots.some((s) => !shots.has(s.shotId))
    )
      errors.push('Invalid motion shot IDs');
    if (e.motion.shots.length !== shots.size)
      errors.push('Missing per-shot motion');
    for (const s of [
      ...(e.audio?.silence ?? []),
      ...(e.transcript?.segments ?? []),
    ])
      if (s.endMs <= s.startMs || s.endMs > end)
        errors.push('Invalid audio/transcript range');
    if (
      e.audio &&
      !e.audio.available &&
      (e.audio.samples.length || e.audio.silence.length)
    )
      errors.push('Unavailable audio contains samples');
  });
}
export function validateReferenceSpec(input: unknown, evidence: unknown) {
  const e = validateReferenceEvidence(evidence);
  if (!e.valid || !e.value) return { valid: false, errors: e.errors };
  return report(referenceSpecSchema, input, (s, errors) => {
    if (
      s.evidenceId !== e.value!.id ||
      s.sourceSha256 !== e.value!.source.sha256
    )
      errors.push('Evidence identity mismatch');
    if (duplicates(s.shots.map((s) => s.id)))
      errors.push('Duplicate semantic shot IDs');
    const ids = new Set(e.value!.shotCandidates.map((s) => s.id));
    for (const shot of s.shots) {
      if (
        duplicates(shot.evidenceShotIds) ||
        shot.evidenceShotIds.some((id) => !ids.has(id))
      )
        errors.push(`Unknown/duplicate shot: ${shot.id}`);
      if (shot.timeRange) {
        const ranges = e.value!.shotCandidates.filter((x) =>
          shot.evidenceShotIds.includes(x.id),
        );
        const { startMs, endMs } = shot.timeRange;
        let covered = startMs;
        for (const range of ranges.sort((a, b) => a.startMs - b.startMs))
          if (range.startMs <= covered && range.endMs > covered)
            covered = range.endMs;
        if (
          covered < endMs ||
          endMs <= startMs ||
          endMs > e.value!.media.durationMs ||
          !ranges.some((x) => startMs >= x.startMs && startMs < x.endMs) ||
          !ranges.some((x) => endMs > x.startMs && endMs <= x.endMs)
        )
          errors.push(`Invalid semantic time range: ${shot.id}`);
      }
    }
  });
}
export function validateReferenceAlignment(
  input: unknown,
  evidence: unknown,
  scenes: SceneRange[],
) {
  const e = validateReferenceEvidence(evidence);
  if (!e.valid || !e.value) return { valid: false, errors: e.errors };
  return report(referenceAlignmentSchema, input, (a, errors) => {
    if (
      a.evidenceId !== e.value!.id ||
      a.sourceSha256 !== e.value!.source.sha256
    )
      errors.push('Evidence identity mismatch');
    const ids = new Map(e.value!.shotCandidates.map((s) => [s.id, s]));
    if (duplicates(a.mappings.map((m) => m.sceneId)))
      errors.push('Duplicate scene mapping');
    for (const m of a.mappings) {
      if (
        !scenes.some((s) => s.id === m.sceneId) ||
        duplicates(m.referenceShotIds) ||
        m.referenceShotIds.some((id) => !ids.has(id))
      )
        errors.push(`Invalid mapping: ${m.sceneId}`);
      let end = -1;
      for (const id of m.referenceShotIds) {
        const s = ids.get(id);
        if (s) {
          if (s.startMs < end)
            errors.push('Reference shots must be chronological');
          end = s.endMs;
        }
      }
      let p = -1,
        r = -1;
      for (const x of m.anchors) {
        if (x.projectProgress <= p || x.referenceProgress < r)
          errors.push('Anchors must be monotonic');
        p = x.projectProgress;
        r = x.referenceProgress;
      }
    }
  });
}
/** Reference progress spans concatenated shot durations; gaps are excluded. */
export function referenceTimeAt(shots: ShotCandidate[], progress: number) {
  if (
    !shots.length ||
    progress < 0 ||
    progress > 1 ||
    !Number.isFinite(progress)
  )
    throw new Error('Invalid reference progress');
  const total = shots.reduce((sum, s) => sum + s.endMs - s.startMs, 0);
  let offset = total * progress;
  for (const s of shots) {
    const duration = s.endMs - s.startMs;
    if (offset < duration) return s.startMs + offset;
    offset -= duration;
  }
  const last = shots[shots.length - 1]!;
  return last.endMs;
}
export function compareMotion(a: number[], b: number[]) {
  if (
    a.length !== b.length ||
    a.length < 2 ||
    [...a, ...b].some((x) => !Number.isFinite(x))
  )
    throw new Error('Comparable finite motion samples required');
  const avg = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length,
    am = avg(a),
    bm = avg(b);
  let cov = 0,
    av = 0,
    bv = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]! - am,
      y = b[i]! - bm;
    cov += x * y;
    av += x * x;
    bv += y * y;
  }
  return {
    motionCorrelation:
      av && bv
        ? Math.max(-1, Math.min(1, cov / Math.sqrt(av * bv)))
        : undefined,
    meanEnergyDifference: avg(a.map((x, i) => Math.abs(x - b[i]!))),
    peakTimingDifference:
      Math.abs(a.indexOf(Math.max(...a)) - b.indexOf(Math.max(...b))) /
      (a.length - 1),
  };
}
export function sampleMotion(profile: MotionProfile, timeMs: number) {
  const v = profile.samples;
  if (!v.length) return 0;
  const hi = v.findIndex((s) => s.timeMs >= timeMs);
  if (hi === -1) return v[v.length - 1]!.energy;
  if (hi === 0) return v[0]!.energy;
  const l = v[hi - 1]!,
    r = v[hi]!;
  return (
    l.energy +
    ((r.energy - l.energy) * (timeMs - l.timeMs)) / (r.timeMs - l.timeMs)
  );
}

/** Motion comparison follows supplied anchors; unmapped ends hold the nearest reference progress. */
export function alignedReferenceProgress(
  anchors: ReferenceAlignment['mappings'][number]['anchors'],
  progress: number,
) {
  if (
    !anchors.length ||
    !Number.isFinite(progress) ||
    progress < 0 ||
    progress > 1
  )
    throw new Error('Invalid alignment progress');
  if (progress <= anchors[0]!.projectProgress)
    return anchors[0]!.referenceProgress;
  const hi = anchors.findIndex((a) => a.projectProgress >= progress);
  if (hi === -1) return anchors[anchors.length - 1]!.referenceProgress;
  const l = anchors[hi - 1]!,
    r = anchors[hi]!;
  return (
    l.referenceProgress +
    ((r.referenceProgress - l.referenceProgress) *
      (progress - l.projectProgress)) /
      (r.projectProgress - l.projectProgress)
  );
}
