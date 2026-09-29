import { projectSchema } from '../project/schema';
export function projectDiagnostics(input: unknown) {
  const result = projectSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    code:
      issue.code === 'custom'
        ? String(issue.params?.code ?? issue.message)
        : issue.code,
    path: issue.path,
    message: issue.message,
    ...(issue.code === 'custom' && issue.params?.details
      ? { details: issue.params.details as Record<string, unknown> }
      : {}),
  }));
}
