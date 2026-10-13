import { z } from 'zod';
import {
  relativePathSchema,
  rasterEnvironmentSchema,
} from '@scenewirejs/production-core';
import { frameEvidenceSchema } from '../frame-evidence';
import {
  benchIdSchema,
  benchTextSchema,
  benchmarkDigestSchema,
  digestBindingSchema,
  toolIdentitySchema,
  benchmarkConfigSchema,
  benchmarkArmSchema,
  timeRangeSchema,
} from './common';
export const captureIdentitySchema = z
  .object({
    tool: toolIdentitySchema,
    config: benchmarkConfigSchema,
    environment: rasterEnvironmentSchema.optional(),
  })
  .strict();
const scope = {
  version: z.literal(1),
  id: benchIdSchema,
  caseId: benchIdSchema,
  arm: benchmarkArmSchema,
  candidate: digestBindingSchema,
  sourceSha256: benchmarkDigestSchema,
  outputDigest: benchmarkDigestSchema,
  capture: captureIdentitySchema,
};
export const representativeFramesSchema = z
  .object({
    ...scope,
    kind: z.literal('representative-frames'),
    frames: z
      .array(
        z
          .object({
            frame: frameEvidenceSchema.extend({ path: relativePathSchema }),
            reason: z.enum([
              'shot-entry',
              'shot-middle',
              'shot-exit',
              'cue',
              'beat',
              'transition',
              'peak-motion',
              'manual',
            ]),
            rationale: benchTextSchema.optional(),
          })
          .strict()
          .refine(
            (v) => v.reason !== 'manual' || !!v.rationale,
            'Manual selection requires rationale',
          ),
      )
      .min(1),
  })
  .strict();
export const contactSheetArtifactSchema = z
  .object({
    ...scope,
    kind: z.literal('contact-sheet'),
    frameIds: z.array(benchIdSchema).min(1),
    layout: z
      .object({
        columns: z.number().int().positive(),
        cellWidth: z.number().int().positive(),
        cellHeight: z.number().int().positive(),
      })
      .strict(),
    labels: z.array(benchTextSchema).min(1),
    ordering: z.literal('chronological'),
    generation: z
      .object({ tool: toolIdentitySchema, config: benchmarkConfigSchema })
      .strict(),
    artifact: z
      .object({ path: relativePathSchema, sha256: benchmarkDigestSchema })
      .strict(),
  })
  .strict();
export const frameStripArtifactSchema = z
  .object({
    ...scope,
    kind: z.literal('frame-strip'),
    range: timeRangeSchema,
    cadenceMs: z.number().positive(),
    frameIds: z.array(benchIdSchema).min(2),
    purpose: z.enum([
      'transition',
      'gesture',
      'camera-motion',
      'text-reveal',
      'contact',
      'timing',
      'continuity',
    ]),
    artifact: z
      .object({ path: relativePathSchema, sha256: benchmarkDigestSchema })
      .strict(),
  })
  .strict();
/** Raw measurement and technical finding, never an inferred creative verdict. */
export const diagnosticEvidenceSchema = z
  .object({
    ...scope,
    kind: z.literal('diagnostic'),
    artifact: z
      .object({ path: relativePathSchema, sha256: benchmarkDigestSchema })
      .strict(),
    measurements: z.array(
      z
        .object({
          dimensionId: benchTextSchema,
          measurementId: benchIdSchema,
          value: z.number(),
          unit: benchTextSchema,
        })
        .strict(),
    ),
    findings: z.array(
      z
        .object({
          id: benchIdSchema,
          targetId: benchIdSchema,
          outcome: z.enum(['pass', 'fail', 'inconclusive']),
          rationale: benchTextSchema,
          evidenceIds: z.array(benchIdSchema).min(1),
        })
        .strict(),
    ),
  })
  .strict();
export const videoBenchEvidenceSchema = z.discriminatedUnion('kind', [
  representativeFramesSchema,
  contactSheetArtifactSchema,
  frameStripArtifactSchema,
  diagnosticEvidenceSchema,
]);
export type RepresentativeFrames = z.infer<typeof representativeFramesSchema>;
export type ContactSheetArtifact = z.infer<typeof contactSheetArtifactSchema>;
export type FrameStripArtifact = z.infer<typeof frameStripArtifactSchema>;
export type VideoBenchEvidence = z.infer<typeof videoBenchEvidenceSchema>;
