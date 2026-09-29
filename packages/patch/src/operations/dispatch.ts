import { type VideoProject } from '@scenewirejs/schema';
import { type ParsedPatchOperation } from './../schema';
import { type ComponentRegistry } from '@scenewirejs/runtime';
import { type PatchChange } from './../contracts';
import { type FrameRange } from './../contracts';
import { type PatchIssue } from './../inspect';
import { differences } from './../diff';
import { compositionParameters } from './composition';
import { clipTiming } from './clip';
import { scene } from './project';
import { theme } from './project';
import { camera } from './project';
import { narration } from './narration';
import { addComponent } from './components';
import { deleteComponent } from './components';
import { replaceComponent } from './components';
export function operation(
  project: VideoProject,
  o: ParsedPatchOperation,
  registry: ComponentRegistry,
  planId: string,
  index: number,
) {
  const changes: PatchChange[] = [],
    ranges: FrameRange[] = [],
    warnings: PatchIssue[] = [];
  let ids: string[] = [];
  const record = (id: string, label: string, before: unknown, after: unknown) =>
    changes.push(
      ...differences(before, after).map((d) => ({
        ...d,
        targetId: id,
        label,
        operationIndex: index,
      })),
    );
  const context = {
    project,
    registry,
    planId,
    index,
    record,
    ranges,
    warnings,
  };
  switch (o.op) {
    case 'update-composition-params':
      ids = compositionParameters(context, o);
      break;
    case 'update-clip':
    case 'retime-clip':
      ids = clipTiming(context, o);
      break;
    case 'update-scene':
      ids = scene(context, o);
      break;
    case 'set-theme':
      ids = theme(context, o);
      break;
    case 'update-camera':
      ids = camera(context, o);
      break;
    case 'update-narration':
      ids = narration(context, o);
      break;
    case 'add-component':
      ids = addComponent(context, o);
      break;
    case 'delete-component':
      ids = deleteComponent(context, o);
      break;
    case 'replace-component':
      ids = replaceComponent(context, o);
      break;
  }
  return { ids, changes, ranges, warnings };
}
