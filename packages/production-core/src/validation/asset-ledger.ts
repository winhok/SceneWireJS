import { type Validation } from './diagnostics';
import { type AssetLedger } from './../contracts/asset-ledger';
import { parse } from './diagnostics';
import { assetLedgerSchema } from './../contracts/asset-ledger';
import { validateSourcePack } from './source';
import { error } from './diagnostics';
export function validateAssetLedger(
  input: unknown,
  sourcesInput: unknown,
): Validation<AssetLedger> {
  const report = parse(assetLedgerSchema, input),
    sources = validateSourcePack(sourcesInput);
  report.diagnostics.push(...sources.diagnostics);
  report.valid = report.valid && sources.valid;
  if (!report.value || !sources.value) return report;
  const ids = new Set<string>(),
    paths = new Set<string>(),
    sourceIds = new Set(sources.value.sources.map((s) => s.id));
  for (const asset of report.value.assets) {
    if (ids.has(asset.id))
      error(report, 'asset.duplicate', `Duplicate asset ID ${asset.id}`);
    ids.add(asset.id);
    if (paths.has(asset.path))
      error(report, 'asset.path', `Duplicate asset path ${asset.path}`);
    paths.add(asset.path);
    if (asset.originSourceId && !sourceIds.has(asset.originSourceId))
      error(report, 'asset.source', `Unknown source ${asset.originSourceId}`);
  }
  for (const asset of report.value.assets)
    for (const id of asset.derivedFromAssetIds ?? [])
      if (!ids.has(id) || id === asset.id)
        error(
          report,
          'asset.lineage',
          `Invalid asset lineage ${asset.id} → ${id}`,
        );
  return report;
}
