import { type VideoProject } from './schema';
import { projectSchema } from './schema';
import { CURRENT_PROJECT_VERSION } from './../version';
export function migrateProject(input: unknown): VideoProject {
  const validated = projectSchema.parse(input);
  return validated.version < CURRENT_PROJECT_VERSION
    ? projectSchema.parse({ ...validated, version: CURRENT_PROJECT_VERSION })
    : validated;
}
export function parseProject(json: string): VideoProject {
  return migrateProject(JSON.parse(json) as unknown);
}
export function serializeProject(project: VideoProject): string {
  return JSON.stringify(migrateProject(project), null, 2);
}
