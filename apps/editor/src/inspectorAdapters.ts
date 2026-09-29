import { developerComponentTypeSchema, type Clip } from '@scenewirejs/schema';
import { DeveloperInspector } from './DeveloperInspector';
// Optional authoring UI adapters live outside the serializable runtime registry.
export const inspectorAdapters: Partial<
  Record<Clip['component'], typeof DeveloperInspector>
> = Object.fromEntries(
  developerComponentTypeSchema.options.map((type) => [
    type,
    DeveloperInspector,
  ]),
);
