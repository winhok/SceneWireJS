import { z } from 'zod';
import { digest, identity, relativePathSchema, text } from './common';
export const reviewRangeSchema = z
  .object({
    startFrame: z.number().int().nonnegative(),
    endFrame: z.number().int().positive(),
  })
  .strict()
  .refine(
    (r) => r.endFrame > r.startFrame,
    'Nonempty half-open frame range required',
  );
export const artifactDigestSchema = z
  .object({ path: relativePathSchema, sha256: digest })
  .strict();
/** The complete relevant asset set, including imported composition resources, is supplied by the host. */
export const candidateBindingSchema = z
  .object({
    projectSha256: digest,
    sourceSha256: digest.optional(),
    assets: z.array(artifactDigestSchema),
  })
  .strict();
export const reviewEvidenceSchema = z
  .object({
    id: identity,
    kind: text,
    sceneId: identity,
    path: relativePathSchema,
    sha256: digest,
    range: reviewRangeSchema.optional(),
  })
  .strict();
export const reviewFindingSchema = z
  .object({
    id: identity,
    sceneId: identity,
    category: text,
    code: text.optional(),
    severity: z.enum(['info', 'warning', 'error']),
    message: text,
    range: reviewRangeSchema,
    evidenceIds: z.array(identity).min(1),
    source: z.enum(['runtime', 'external', 'human']),
    status: z.enum([
      'observed',
      'repair-requested',
      'repaired',
      'verified',
      'accepted',
    ]),
  })
  .strict();
export const sceneReviewV2Schema = z
  .object({
    version: z.literal(2),
    sceneId: identity,
    candidate: candidateBindingSchema,
    evidence: z.array(reviewEvidenceSchema).min(1),
    findings: z.array(reviewFindingSchema),
    reviewer: text,
    reviewerSource: z.enum(['runtime', 'external', 'human']),
    reviewedAt: z.iso.datetime(),
    disposition: z.enum(['pass', 'revise']),
  })
  .strict();
export type CandidateBinding = z.infer<typeof candidateBindingSchema>;
export type ArtifactDigest = z.infer<typeof artifactDigestSchema>;
export type ReviewEvidence = z.infer<typeof reviewEvidenceSchema>;
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export type SceneReviewV2 = z.infer<typeof sceneReviewV2Schema>;
