import { parse } from './diagnostics';
import { productionBriefSchema } from './../contracts/brief';
import { error } from './diagnostics';
export function validateProductionBrief(input: unknown) {
  const report = parse(productionBriefSchema, input);
  if (
    report.value &&
    !Number.isSafeInteger(
      report.value.targetDurationSeconds * report.value.canvas.fps,
    )
  )
    error(
      report,
      'duration.frames',
      'Target duration must resolve to exact integer frames',
    );
  return report;
}
