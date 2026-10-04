import {
  type ArtifactDigest,
  type CandidateBinding,
  type ReviewEvidence,
  type ReviewFinding,
  type SceneReviewV2,
  candidateBindingSchema,
  sceneReviewV2Schema,
} from '../contracts/review-v2';
import { error, parse, type Validation } from './diagnostics';
/** Observations must be freshly hashed bytes, never copied out of the reviewed record. */
export interface ReviewValidationContext {
  candidate: CandidateBinding;
  evidence: readonly ArtifactDigest[];
  sceneDurationFrames?: number;
}
export function sameCandidate(
  a: CandidateBinding,
  b: CandidateBinding,
): boolean {
  const left = candidateBindingSchema.safeParse(a),
    right = candidateBindingSchema.safeParse(b);
  if (!left.success || !right.success) return false;
  const x = left.data,
    y = right.data;
  if (
    x.projectSha256 !== y.projectSha256 ||
    x.sourceSha256 !== y.sourceSha256 ||
    x.assets.length !== y.assets.length
  )
    return false;
  const map = new Map(y.assets.map((v) => [v.path, v.sha256]));
  return (
    map.size === y.assets.length &&
    new Set(x.assets.map((v) => v.path)).size === x.assets.length &&
    x.assets.every((v) => map.get(v.path) === v.sha256)
  );
}
export function validateEvidenceDigests<T>(
  report: Validation<T>,
  evidence: readonly ReviewEvidence[],
  observed: readonly ArtifactDigest[],
  sceneId?: string,
): void {
  const map = new Map(observed.map((v) => [v.path, v.sha256]));
  const ids = new Set<string>(),
    paths = new Set<string>();
  if (map.size !== observed.length)
    error(report, 'evidence.duplicate', 'Duplicate observed evidence path');
  for (const item of evidence) {
    if (ids.has(item.id) || paths.has(item.path))
      error(report, 'evidence.duplicate', 'Duplicate evidence ID or path');
    ids.add(item.id);
    paths.add(item.path);
    if (sceneId && item.sceneId !== sceneId)
      error(
        report,
        'evidence.scene',
        'Evidence belongs to another scene',
        sceneId,
      );
    if (map.get(item.path) !== item.sha256)
      error(
        report,
        'evidence.stale',
        `Missing or changed evidence ${item.path}`,
        item.sceneId,
      );
  }
}
export function validateSceneReviewV2(
  input: unknown,
  context: ReviewValidationContext,
): Validation<SceneReviewV2> {
  const report = parse(sceneReviewV2Schema, input);
  if (!report.value) return report;
  const review = report.value;
  if (!sameCandidate(review.candidate, context.candidate))
    error(
      report,
      'review.candidate',
      'Candidate bytes or relevant asset set changed',
      review.sceneId,
    );
  validateEvidenceDigests(
    report,
    review.evidence,
    context.evidence,
    review.sceneId,
  );
  const evidence = new Map(review.evidence.map((v) => [v.id, v]));
  const ids = new Set<string>();
  if (
    context.sceneDurationFrames !== undefined &&
    (!Number.isSafeInteger(context.sceneDurationFrames) ||
      context.sceneDurationFrames <= 0)
  )
    error(report, 'review.duration', 'Invalid scene duration');
  for (const item of review.evidence)
    if (
      item.range &&
      context.sceneDurationFrames !== undefined &&
      item.range.endFrame > context.sceneDurationFrames
    )
      error(
        report,
        'evidence.range',
        'Evidence range outside scene',
        review.sceneId,
      );
  for (const finding of review.findings) {
    if (ids.has(finding.id))
      error(report, 'finding.duplicate', `Duplicate finding ${finding.id}`);
    ids.add(finding.id);
    if (finding.sceneId !== review.sceneId)
      error(
        report,
        'finding.scene',
        'Finding belongs to another scene',
        review.sceneId,
      );
    if (
      context.sceneDurationFrames !== undefined &&
      finding.range.endFrame > context.sceneDurationFrames
    )
      error(
        report,
        'finding.range',
        'Finding range outside scene',
        review.sceneId,
      );
    if (new Set(finding.evidenceIds).size !== finding.evidenceIds.length)
      error(report, 'finding.evidence', 'Duplicate finding evidence ID');
    for (const id of finding.evidenceIds) {
      const artifact = evidence.get(id);
      if (
        !artifact ||
        artifact.sceneId !== finding.sceneId ||
        (artifact.range &&
          (finding.range.startFrame < artifact.range.startFrame ||
            finding.range.endFrame > artifact.range.endFrame))
      )
        error(
          report,
          'finding.evidence',
          `Unbound finding evidence ${id}`,
          review.sceneId,
        );
    }
    if (
      review.disposition === 'pass' &&
      finding.status !== 'verified' &&
      finding.status !== 'accepted'
    )
      error(
        report,
        'review.unresolved',
        'Passing review has unresolved findings',
      );
  }
  if (review.disposition === 'pass' && review.reviewerSource === 'runtime')
    error(
      report,
      'review.runtime',
      'Runtime review cannot confer a visual pass',
    );
  return report;
}
/** Structurally compatible with ResolvedFrameDiagnostic without a renderer dependency. */
export interface ReviewFrameDiagnostic {
  id: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  frame: number;
  composition: string;
}
export function frameDiagnosticsToFindings(
  diagnostics: readonly ReviewFrameDiagnostic[],
  options: {
    sceneId: string;
    evidenceIds: readonly string[];
    startFrame?: number;
  },
): ReviewFinding[] {
  const offset = options.startFrame ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error('Invalid scene start frame');
  const sorted = [...diagnostics].sort(
    (a, b) =>
      a.frame - b.frame ||
      compare(a.composition, b.composition) ||
      compare(a.id, b.id) ||
      compare(a.severity, b.severity) ||
      compare(a.message, b.message),
  );
  return sorted.map((d, i) => {
    const frame = d.frame - offset;
    if (!Number.isSafeInteger(frame) || frame < 0)
      throw new Error('Diagnostic outside scene');
    return {
      id: `runtime-${i}`,
      sceneId: options.sceneId,
      category: d.id.includes('text')
        ? 'readability'
        : d.id.includes('penetration')
          ? 'geometry'
          : 'runtime',
      code: d.id,
      severity: d.severity,
      message: d.message,
      range: { startFrame: frame, endFrame: frame + 1 },
      evidenceIds: [...options.evidenceIds],
      source: 'runtime',
      status: 'observed',
    };
  });
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
