import { flags } from './options';
import { required } from './options';
import { referenceEvidenceSchema } from '@scenewirejs/reference-core';
import { json } from './options';
import { validateReferenceSpec } from '@scenewirejs/reference-core';
import { verifyEvidence } from '@scenewirejs/media-inspect';
import { limits } from './options';
import { absent } from './options';
import { initReference } from '@scenewirejs/media-inspect';
import { options } from './options';
export async function referenceCheck(
  file: string,
  rest: string[],
  signal: AbortSignal,
) {
  const f = flags(rest, ['--evidence', '--source']);
  const evidenceFile = required(f, '--evidence'),
    e = referenceEvidenceSchema.parse(await json(evidenceFile));
  const report = validateReferenceSpec(await json(file), e);
  if (report.valid)
    await verifyEvidence(e, evidenceFile, f.get('--source'), signal);
  return { valid: report.valid, errors: report.errors, evidenceId: e.id };
}
export async function initCommand(
  file: string,
  rest: string[],
  signal: AbortSignal,
) {
  const f = flags(rest, ['--output', ...limits]),
    output = required(f, '--output');
  await absent(output);
  const evidence = await initReference(file, output, options(f, signal));
  return {
    valid: true,
    output,
    evidenceId: evidence.id,
    sourceSha256: evidence.source.sha256,
    timingsMs: evidence.extraction.timingsMs,
  };
}
