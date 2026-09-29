import { z } from 'zod';
import { identity } from './common';
import { relativePathSchema } from './common';
import { digest } from './common';
import { text } from './common';
export const assetLedgerSchema = z
  .object({
    version: z.literal(1),
    assets: z.array(
      z
        .object({
          id: identity,
          path: relativePathSchema,
          kind: z.enum(['image', 'audio', 'font', 'other']),
          sha256: digest,
          originSourceId: identity.optional(),
          derivedFromAssetIds: z.array(identity).optional(),
          generatedBy: text.optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type AssetLedger = z.infer<typeof assetLedgerSchema>;
