import { type PatchIssue } from './inspect';
import { PatchError } from './inspect';
import { z } from 'zod';
import { type VideoProject } from '@scenewirejs/schema';
import { type ComponentRegistry } from '@scenewirejs/runtime';
import { type PatchDryRunReport } from './contracts';
import { patchPlanSchema } from './schema';
import { validateProjectForEditing } from './inspect';
import { projectSchema } from '@scenewirejs/schema';
import { type PatchChange } from './contracts';
import { type FrameRange } from './contracts';
import { operation } from './operations/dispatch';
import { duration } from './inspect';
import { mergeAffectedRanges } from './ranges';
import { suggestPreviewFrames } from './ranges';
import { type PatchResult } from './contracts';
export function issues(cause: unknown): PatchIssue[] {
  if (cause instanceof PatchError) return cause.issues;
  if (cause instanceof z.ZodError)
    return cause.issues.map((i) => ({
      severity: 'error',
      code: 'patch.schema',
      message: `${i.path.join('.')}: ${i.message}`,
    }));
  return [
    {
      severity: 'error',
      code: 'patch.invalid',
      message: cause instanceof Error ? cause.message : String(cause),
    },
  ];
}
export function dryRunPatchPlan(
  input: VideoProject,
  raw: unknown,
  registry: ComponentRegistry,
): PatchDryRunReport {
  const empty: PatchDryRunReport = {
    valid: false,
    resolvedTargets: [],
    changes: [],
    warnings: [],
    issues: [],
    affectedScenes: [],
    affectedFrameRanges: [],
    suggestedPreviewFrames: [],
  };
  let operationIndex: number | undefined;
  try {
    // Enforce JSON at API boundary, including nested cue payloads. No functions/prototypes.
    const plan = patchPlanSchema.parse(raw);
    const baseIssues = validateProjectForEditing(input, registry);
    if (baseIssues.some((i) => i.severity === 'error'))
      throw new PatchError(baseIssues);
    let project = projectSchema.parse(structuredClone(input));
    const resolvedTargets: PatchDryRunReport['resolvedTargets'] = [],
      changes: PatchChange[] = [],
      ranges: FrameRange[] = [],
      warnings: PatchIssue[] = [];
    for (const [index, op] of plan.operations.entries()) {
      operationIndex = index;
      const r = operation(project, op, registry, plan.id, index);
      const validation = validateProjectForEditing(project, registry);
      if (validation.some((i) => i.severity === 'error'))
        throw new PatchError(validation.filter((i) => i.severity === 'error'));
      project = projectSchema.parse(project);
      resolvedTargets.push({ operationIndex: index, targetIds: r.ids });
      changes.push(...r.changes);
      ranges.push(...r.ranges);
      warnings.push(...r.warnings);
    }
    warnings.push(
      ...validateProjectForEditing(project, registry).filter(
        (i) => i.severity === 'warning',
      ),
    );
    const total = Math.max(duration(input), duration(project)),
      affectedFrameRanges = mergeAffectedRanges(ranges, total);
    const affectedScenes = [
      ...new Set(
        [...input.scenes, ...project.scenes]
          .filter((s) =>
            affectedFrameRanges.some(
              (r) =>
                s.startFrame < r.endFrame &&
                s.startFrame + s.durationFrames > r.startFrame,
            ),
          )
          .map((s) => s.id),
      ),
    ];
    return {
      valid: true,
      resolvedTargets,
      changes,
      warnings,
      issues: [],
      affectedScenes,
      affectedFrameRanges,
      suggestedPreviewFrames: suggestPreviewFrames(
        affectedFrameRanges,
        duration(project),
      ),
      resultingProject: project,
    };
  } catch (cause) {
    return {
      ...empty,
      issues: issues(cause).map((i) => ({
        ...i,
        ...(operationIndex !== undefined ? { operationIndex } : {}),
      })),
    };
  }
}
export function applyPatchPlan(
  project: VideoProject,
  plan: unknown,
  registry: ComponentRegistry,
): PatchResult {
  const report = dryRunPatchPlan(project, plan, registry);
  if (!report.valid || !report.resultingProject)
    throw new PatchError(report.issues);
  return {
    project: report.resultingProject,
    report,
    patchId: patchPlanSchema.parse(plan).id,
  };
}
