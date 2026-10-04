import {
  repairCaseSchema,
  type RepairCase,
  type RepairCheck,
} from '../contracts/repair';
import {
  type CandidateBinding,
  type ArtifactDigest,
} from '../contracts/review-v2';
import { error, parse, type Validation } from './diagnostics';
import { sameCandidate, validateEvidenceDigests } from './review-v2';
export interface RepairValidationContext {
  base: CandidateBinding;
  candidate?: CandidateBinding;
  beforeEvidence: readonly ArtifactDigest[];
  afterEvidence: readonly ArtifactDigest[];
  /** Host parses role/result/candidate from the actual check artifact and hashes its bytes. */
  checks: readonly RepairCheck[];
  findingIds: readonly string[];
  patch?: ArtifactDigest;
}
/** Validates records and freshly observed evidence identities; never executes repair commands. */
export function validateRepairCase(
  input: unknown,
  context: RepairValidationContext,
): Validation<RepairCase> {
  const report = parse(repairCaseSchema, input);
  if (!report.value) return report;
  const r = report.value;
  if (!sameCandidate(r.base, context.base))
    error(report, 'repair.base', 'Base candidate is stale');
  if (
    new Set(r.findingIds).size !== r.findingIds.length ||
    r.findingIds.some((id) => !context.findingIds.includes(id))
  )
    error(report, 'repair.findings', 'Unknown or duplicate finding IDs');
  const scenes = new Set(r.scope.sceneIds);
  if (
    scenes.size !== r.scope.sceneIds.length ||
    r.scope.ranges.some((v) => !scenes.has(v.sceneId))
  )
    error(report, 'repair.scope', 'Invalid repair scene scope');
  for (const item of [...r.beforeEvidence, ...r.afterEvidence])
    if (!scenes.has(item.sceneId))
      error(report, 'repair.scope', 'Evidence outside repair scope');
  validateEvidenceDigests(report, r.beforeEvidence, context.beforeEvidence);
  validateEvidenceDigests(report, r.afterEvidence, context.afterEvidence);
  if (r.method === 'structured-patch' && !r.patch)
    error(report, 'repair.patch', 'Structured patch reference required');
  if (
    r.patch &&
    (!context.patch ||
      r.patch.path !== context.patch.path ||
      r.patch.sha256 !== context.patch.sha256)
  )
    error(report, 'repair.patch', 'Patch bytes missing or stale');
  const observed = new Map(context.checks.map((c) => [c.path, c])),
    ids = new Set<string>(),
    paths = new Set<string>();
  if (observed.size !== context.checks.length)
    error(report, 'repair.check', 'Duplicate observed check evidence');
  for (const check of r.checks) {
    if (ids.has(check.id) || paths.has(check.path))
      error(report, 'repair.check', 'Duplicate verification check');
    ids.add(check.id);
    paths.add(check.path);
    const actual = observed.get(check.path);
    if (
      !actual ||
      actual.sha256 !== check.sha256 ||
      actual.id !== check.id ||
      actual.role !== check.role ||
      actual.result !== check.result ||
      !sameCandidate(actual.candidate, check.candidate)
    )
      error(
        report,
        'repair.check',
        'Check evidence missing, stale or inconsistent with recorded outcome',
      );
    const expected = check.role === 'reproduction' ? r.base : r.candidate;
    if (!expected || !sameCandidate(check.candidate, expected))
      error(report, 'repair.check', 'Check bound to another candidate');
  }
  if (
    r.status !== 'proposed' &&
    !r.checks.some((c) => c.role === 'reproduction' && c.result === 'fail')
  )
    error(report, 'repair.red', 'Failing base reproduction required');
  if (r.status === 'applied' || r.status === 'verified') {
    if (
      !r.candidate ||
      !context.candidate ||
      !sameCandidate(r.candidate, context.candidate) ||
      sameCandidate(r.base, r.candidate)
    )
      error(
        report,
        'repair.candidate',
        'A fresh changed repair candidate is required',
      );
    if (!r.afterEvidence.length)
      error(report, 'repair.after', 'Fresh after evidence required');
    for (const scene of scenes) {
      if (
        !r.beforeEvidence.some((e) => e.sceneId === scene) ||
        !r.afterEvidence.some((e) => e.sceneId === scene)
      )
        error(
          report,
          'repair.coverage',
          `Before and after evidence required for scene ${scene}`,
        );
    }
  } else if (
    r.candidate &&
    (!context.candidate || !sameCandidate(r.candidate, context.candidate))
  )
    error(report, 'repair.candidate', 'Candidate bytes changed');
  if (r.status === 'verified')
    for (const role of ['targeted', 'neighbor-regression'] as const) {
      const checks = r.checks.filter((c) => c.role === role);
      if (!checks.length || checks.some((c) => c.result !== 'pass'))
        error(report, 'repair.green', `Passing ${role} checks required`);
    }
  return report;
}
