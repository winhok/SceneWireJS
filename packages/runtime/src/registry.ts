import { visualClips } from '@scenewirejs/schema';
import {
  clipSchema,
  componentPropsSchema,
  primitiveClipSchema,
  type Clip,
  type VideoProject,
} from '@scenewirejs/schema';
import type { ChoreographyAdapter } from './choreography';
import type { ComponentCompiler, ComponentRegistry } from './index';
export interface ComponentAuthoringMetadata {
  readonly label: string;
  readonly description?: string;
  readonly defaultWidth: number;
  readonly defaultHeight: number;
  readonly defaultDurationFrames?: number;
  readonly icon?: string;
}
export interface ComponentDefinition extends ComponentCompiler {
  readonly authoring: ComponentAuthoringMetadata;
  readonly choreography?: ChoreographyAdapter;
  readonly schema: { parse(value: unknown): unknown };
  readonly defaultProps: Clip['props'];
  readonly aiDescription: string;
  readonly category: string;
  readonly semanticCapabilities: readonly string[];
  readonly motionCapabilities: readonly string[];
}
function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) immutable(child);
  }
  return value;
}
export function defineComponent(
  definition: ComponentDefinition,
): ComponentDefinition {
  if (!definition.aiDescription.trim() || !definition.category.trim())
    throw new Error('Component metadata is required');
  const a = definition.authoring;
  if (
    !a.label.trim() ||
    !Number.isFinite(a.defaultWidth) ||
    a.defaultWidth <= 0 ||
    !Number.isFinite(a.defaultHeight) ||
    a.defaultHeight <= 0 ||
    (a.defaultDurationFrames !== undefined &&
      (!Number.isInteger(a.defaultDurationFrames) ||
        a.defaultDurationFrames < 1))
  )
    throw new Error('Invalid authoring metadata');
  const props = definition.schema.parse(definition.defaultProps);
  // Bind metadata and schema to the persisted component contract.
  clipSchema.parse({
    id: 'registry-default',
    component: definition.type,
    props,
    startFrame: 0,
    durationFrames: 1,
    transform: {},
  });
  return Object.freeze({
    ...definition,
    authoring: Object.freeze({ ...definition.authoring }),
    defaultProps: immutable(props) as Clip['props'],
    semanticCapabilities: Object.freeze([...definition.semanticCapabilities]),
    motionCapabilities: Object.freeze([...definition.motionCapabilities]),
  });
}
export function createComponentRegistry(
  definitions: readonly ComponentDefinition[],
): readonly ComponentDefinition[] {
  const ids = new Set<string>();
  return Object.freeze(
    definitions.map((d) => {
      if (ids.has(d.type)) throw new Error(`Duplicate component: ${d.type}`);
      ids.add(d.type);
      return defineComponent(d);
    }),
  );
}
export function discoverComponents(registry: ComponentRegistry) {
  return registry.map((definition) => {
    if (!('aiDescription' in definition))
      throw new Error(`Missing discovery metadata: ${definition.type}`);
    const d = definition as ComponentDefinition;
    // Serializable discovery only: no compiler functions or mutable defaults.
    return JSON.parse(
      JSON.stringify({
        type: d.type,
        authoring: d.authoring,
        defaultProps: d.defaultProps,
        aiDescription: d.aiDescription,
        category: d.category,
        semanticCapabilities: d.semanticCapabilities,
        motionCapabilities: d.motionCapabilities,
      }),
    ) as Omit<ComponentDefinition, 'schema' | 'compile'>;
  });
}
export function findSemanticTargets(
  project: VideoProject,
  query: { role?: string; entity?: string; concept?: string; tag?: string },
): string[] {
  if (!Object.values(query).some(Boolean)) return [];
  return visualClips(project)
    .filter((c) => {
      const s = c.semantic;
      return (
        s &&
        (!query.role || s.role === query.role) &&
        (!query.entity || s.entity === query.entity) &&
        (!query.concept || s.concept === query.concept) &&
        (!query.tag || s.tags?.includes(query.tag))
      );
    })
    .map((c) => c.id);
}
export function createPrimitiveRegistry(): readonly ComponentDefinition[] {
  const definitions = [
    {
      type: 'Text',
      defaultProps: { text: 'Your idea, structured.' },
      aiDescription: 'Editable text with explicit typography.',
      semanticCapabilities: ['text', 'caption'],
    },
    {
      type: 'Shape',
      defaultProps: {},
      aiDescription: 'A styled container or diagram block.',
      semanticCapabilities: ['container'],
    },
    {
      type: 'Arrow',
      defaultProps: {},
      aiDescription:
        'A directional connection revealed by normalized progress.',
      semanticCapabilities: ['connection'],
    },
    {
      type: 'Path',
      defaultProps: {
        points: [
          { x: 0, y: 0.5 },
          { x: 0.5, y: 0.1 },
          { x: 1, y: 0.5 },
        ],
      },
      aiDescription:
        'A normalized polyline annotation revealed by geometric length.',
      semanticCapabilities: ['annotation', 'connector', 'line-chart'],
    },
  ] as const;
  return createComponentRegistry(
    definitions.map((d) => {
      const schema = componentPropsSchema(d.type);
      return {
        type: d.type,
        authoring: {
          label: d.type,
          description: d.aiDescription,
          defaultWidth: 300,
          defaultHeight: d.type === 'Arrow' ? 40 : 100,
          defaultDurationFrames: 90,
        },
        schema,
        defaultProps: schema.parse(d.defaultProps),
        aiDescription: d.aiDescription,
        category: 'primitive',
        semanticCapabilities: d.semanticCapabilities,
        motionCapabilities: [
          'show',
          ...(d.type === 'Arrow' || d.type === 'Path' ? ['draw'] : []),
        ],
        compile(clip: Clip) {
          if (clip.component !== d.type)
            throw new Error('Mismatched primitive compiler');
          const p = primitiveClipSchema.parse(clip);
          return [
            {
              id: p.id,
              component: p.component,
              props: p.props,
              transform: p.transform,
            },
          ];
        },
      };
    }),
  );
}

export function createClipFromDefinition({
  definition,
  id,
  startFrame,
  durationFrames,
}: {
  definition: ComponentDefinition;
  id: string;
  startFrame: number;
  durationFrames?: number;
}): Clip {
  return clipSchema.parse({
    id,
    component: definition.type,
    startFrame,
    durationFrames:
      durationFrames ?? definition.authoring.defaultDurationFrames ?? 90,
    transform: {
      x: 160,
      y: 280,
      width: definition.authoring.defaultWidth,
      height: definition.authoring.defaultHeight,
      zIndex: 5,
    },
    props: structuredClone(definition.defaultProps),
  });
}
