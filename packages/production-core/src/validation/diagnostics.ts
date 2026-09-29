import { z } from 'zod';
export interface ProductionDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  sceneId?: string;
}
export interface Validation<T> {
  valid: boolean;
  diagnostics: ProductionDiagnostic[];
  value?: T;
}
export function parse<T>(schema: z.ZodType<T>, input: unknown): Validation<T> {
  const result = schema.safeParse(input);
  return result.success
    ? { valid: true, diagnostics: [], value: result.data }
    : {
        valid: false,
        diagnostics: result.error.issues.map((i) => ({
          severity: 'error',
          code: 'production.schema',
          message: `${i.path.join('.')}: ${i.message}`,
        })),
      };
}
export function error(
  report: { valid: boolean; diagnostics: ProductionDiagnostic[] },
  code: string,
  message: string,
  sceneId?: string,
) {
  report.valid = false;
  report.diagnostics.push({
    severity: 'error',
    code,
    message,
    ...(sceneId ? { sceneId } : {}),
  });
}
