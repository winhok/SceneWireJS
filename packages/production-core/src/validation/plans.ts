import { type EngineRegistry } from '@scenewirejs/director-core';
import { validateNarrativePlan } from './narrative';
import { validateVisualPlan } from '@scenewirejs/director-core';
import { error } from './diagnostics';
export function validateProductionPlans(
  brief: unknown,
  sources: unknown,
  narrative: unknown,
  visual: unknown,
  registry: EngineRegistry,
) {
  const report = validateNarrativePlan(narrative, brief, sources);
  const v = validateVisualPlan(
    visual,
    registry,
    report.value?.scenes.map((s) => s.id),
  );
  report.diagnostics.push(...v.diagnostics);
  report.valid = report.valid && v.valid;
  if (report.value && v.plan) {
    const ids = report.value.scenes.map((s) => s.id);
    if (v.plan.scenes.length !== ids.length)
      error(
        report,
        'visual.coverage',
        'VisualPlan must cover exactly all narrative scenes',
      );
    const visualCountBySceneId = new Map<string, number>();
    for (const scene of v.plan.scenes)
      if (!scene.sceneId || scene.sceneId === scene.id)
        visualCountBySceneId.set(
          scene.id,
          (visualCountBySceneId.get(scene.id) ?? 0) + 1,
        );
    for (const id of ids)
      if ((visualCountBySceneId.get(id) ?? 0) !== 1)
        error(
          report,
          'visual.identity',
          `Visual scene ID must match ${id}`,
          id,
        );
  }
  return report;
}
