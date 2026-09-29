import { parse } from './diagnostics';
import { sourcePackSchema } from './../contracts/source';
import { error } from './diagnostics';
export function validateSourcePack(input: unknown) {
  const report = parse(sourcePackSchema, input);
  if (!report.value) return report;
  const { sources, claims } = report.value;
  const ids = new Set<string>();
  for (const source of sources) {
    if (ids.has(source.id))
      error(report, 'source.duplicate', `Duplicate source: ${source.id}`);
    ids.add(source.id);
    if (source.kind === 'repo' && !source.commitSha)
      error(
        report,
        'source.revision',
        `Repository source ${source.id} needs exact commitSha`,
      );
    if (source.kind === 'file' && !source.sha256)
      error(report, 'source.digest', `File source ${source.id} needs sha256`);
    if (!source.snapshotPath)
      report.diagnostics.push({
        severity: 'warning',
        code: 'source.snapshot',
        message: `Source ${source.id} has no retained snapshot`,
      });
  }
  const claimIds = new Set<string>();
  for (const claim of claims) {
    if (claimIds.has(claim.id))
      error(report, 'claim.duplicate', `Duplicate claim: ${claim.id}`);
    claimIds.add(claim.id);
    if (claim.type === 'factual' && !claim.sourceIds.length)
      error(
        report,
        'claim.unsourced',
        `Factual claim ${claim.id} requires a source`,
      );
    for (const id of claim.sourceIds)
      if (!ids.has(id))
        error(
          report,
          'claim.source',
          `Claim ${claim.id} references unknown source ${id}`,
        );
  }
  return report;
}
