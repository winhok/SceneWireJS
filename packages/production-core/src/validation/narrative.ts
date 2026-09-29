import { parse } from './diagnostics';
import { narrativePlanSchema } from './../contracts/narrative';
import { validateProductionBrief } from './brief';
import { validateSourcePack } from './source';
import { error } from './diagnostics';
export function validateNarrativePlan(
  input: unknown,
  briefInput: unknown,
  sourcesInput: unknown,
) {
  const report = parse(narrativePlanSchema, input),
    brief = validateProductionBrief(briefInput),
    sources = validateSourcePack(sourcesInput);
  report.diagnostics.push(...brief.diagnostics, ...sources.diagnostics);
  report.valid = report.valid && brief.valid && sources.valid;
  if (!report.value || !brief.value || !sources.value) return report;
  const plan = report.value,
    b = brief.value,
    ids = new Set<string>(),
    claims = new Set(sources.value.claims.map((c) => c.id));
  if (plan.briefId !== b.id)
    error(report, 'narrative.brief', 'Narrative briefId mismatch');
  for (const [index, scene] of plan.scenes.entries()) {
    if (ids.has(scene.id))
      error(report, 'scene.duplicate', 'Duplicate scene ID', scene.id);
    ids.add(scene.id);
    if (scene.order !== index)
      error(
        report,
        'scene.order',
        'Scene orders must match contiguous array indices',
        scene.id,
      );
    for (const id of scene.claimIds)
      if (!claims.has(id))
        error(report, 'scene.claim', `Unknown claim ${id}`, scene.id);
    if (b.narration === 'voiceover' && !scene.voiceover)
      error(report, 'scene.voiceover', 'Voiceover required', scene.id);
    if (
      scene.voiceover &&
      scene.voiceover.split(/\s+/u).length /
        (scene.durationFrames / b.canvas.fps) >
        4
    )
      report.diagnostics.push({
        severity: 'warning',
        code: 'speech.density',
        message:
          'Speech exceeds four whitespace-delimited words per second; review language-specific pacing',
        sceneId: scene.id,
      });
  }
  if (
    plan.scenes.reduce((sum, s) => sum + s.durationFrames, 0) !==
    b.targetDurationSeconds * b.canvas.fps
  )
    error(
      report,
      'duration.partition',
      'Scene durations must exactly partition target frames',
    );
  return report;
}
