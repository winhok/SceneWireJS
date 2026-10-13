import { z } from 'zod';
import {
  benchIdSchema,
  benchTextSchema,
  benchmarkDigestSchema,
  benchmarkArmSchema,
} from './common';
import { dimensionIdSchema } from './profile';
export const reviewVerdictSchema = z.enum([
  'A',
  'B',
  'equivalent',
  'inconclusive',
  'not-applicable',
]);
export const blindEvidenceAliasIdSchema = z
  .string()
  .regex(/^[AB]\/(?:frame|sheet|strip)-[0-9]{2,}$/);
/** Source mapping stays private; judges and imported creative verdicts use aliasId only. */
export const blindEvidenceAliasSchema = z
  .object({
    aliasId: blindEvidenceAliasIdSchema,
    sourceEvidenceId: benchIdSchema,
  })
  .strict();
const dimensionVerdictSchema = z
  .object({
    dimensionId: dimensionIdSchema,
    verdict: reviewVerdictSchema,
    evidenceIds: z.array(blindEvidenceAliasIdSchema).min(1),
    rationale: benchTextSchema,
  })
  .strict();
/** Private sidecar. Never passed to judges or embedded in their ReviewRecord. */
export const blindIdentityMappingSchema = z
  .object({
    version: z.literal(1),
    packId: benchIdSchema,
    caseId: benchIdSchema,
    reviewReplicateId: benchIdSchema,
    aliases: z.array(blindEvidenceAliasSchema).min(2),
    A: benchmarkArmSchema,
    B: benchmarkArmSchema,
    randomizationReceiptDigest: benchmarkDigestSchema,
  })
  .strict()
  .refine((v) => v.A !== v.B, 'A/B must bijectively map two arms');
/** Opaque evidence aliases have no source path, digest or candidate/version labels. */
export const blindReviewPackSchema = z
  .object({
    version: z.literal(1),
    id: benchIdSchema,
    caseId: benchIdSchema,
    reviewReplicateId: benchIdSchema,
    context: benchTextSchema,
    reviewTemplateDigest: benchmarkDigestSchema,
    evidenceA: z
      .array(blindEvidenceAliasIdSchema.refine((id) => id.startsWith('A/')))
      .min(1),
    evidenceB: z
      .array(blindEvidenceAliasIdSchema.refine((id) => id.startsWith('B/')))
      .min(1),
    rubric: z
      .array(
        z
          .object({
            dimensionId: dimensionIdSchema,
            instructions: benchTextSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
const receiptSchema = z
  .object({
    workspacePolicy: z.enum(['empty', 'sanitized']),
    inputBundleDigest: benchmarkDigestSchema,
    reviewTemplateDigest: benchmarkDigestSchema,
    provenance: benchTextSchema,
    receiptDigest: benchmarkDigestSchema,
  })
  .strict();
const creativeBase = {
  version: z.literal(1),
  id: benchIdSchema,
  caseId: benchIdSchema,
  reviewReplicateId: benchIdSchema,
  reviewerId: benchIdSchema,
  identityClass: benchIdSchema,
  packId: benchIdSchema,
  packDigest: benchmarkDigestSchema,
  receipt: receiptSchema,
  dimensions: z.array(dimensionVerdictSchema).min(1),
};
export const creativeReviewRecordSchema = z.discriminatedUnion('reviewerType', [
  z.object({ ...creativeBase, reviewerType: z.literal('human') }).strict(),
  z
    .object({
      ...creativeBase,
      reviewerType: z.literal('external-agent'),
      agent: z
        .object({
          provider: benchTextSchema,
          model: benchTextSchema,
          configDigest: benchmarkDigestSchema,
        })
        .strict(),
    })
    .strict(),
]);
export const deterministicReviewRecordSchema = z
  .object({
    version: z.literal(1),
    id: benchIdSchema,
    reviewerType: z.literal('deterministic'),
    reviewerId: benchIdSchema,
    caseId: benchIdSchema,
    arm: benchmarkArmSchema,
    toolDigest: benchmarkDigestSchema,
    evidenceIds: z.array(benchIdSchema).min(1),
    findings: z
      .array(
        z
          .object({
            targetId: benchIdSchema,
            gateId: benchIdSchema.optional(),
            outcome: z.enum(['pass', 'fail', 'inconclusive']),
            rationale: benchTextSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export const reviewRecordSchema = z.union([
  creativeReviewRecordSchema,
  deterministicReviewRecordSchema,
]);
export type ReviewRecord = z.infer<typeof reviewRecordSchema>;
export type CreativeReviewRecord = z.infer<typeof creativeReviewRecordSchema>;
export type BlindReviewPack = z.infer<typeof blindReviewPackSchema>;
export type BlindIdentityMapping = z.infer<typeof blindIdentityMappingSchema>;

export type BlindEvidenceAlias = z.infer<typeof blindEvidenceAliasSchema>;
