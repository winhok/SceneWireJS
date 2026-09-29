import { resolveCamera, type ResolvedCameraState } from './camera';
import type { VisualEffects } from '@scenewirejs/schema';
export * from './camera';
import { clipSchema, animationSchema } from '@scenewirejs/schema';
import type { ResolvedChoreography } from './choreography';
import { evaluationIndexes } from './evaluation-index';
import {
  projectSchema,
  videoSourceTimeMs,
  type VideoProps,
  isVisualTrack,
  primitiveClipSchema,
  type Clip,
  type PrimitiveClip,
  type Transform,
  type VideoProject,
} from '@scenewirejs/schema';
import { clampFrame } from '@scenewirejs/time';
import { interpolate } from './interpolation';
import { resolveProjectLayouts } from './layout';
import { compileMotion } from './motion';
export * from './layout';
export * from './motion';
export * from './path';
export * from './registry';
export * from './choreography';
export { ease, interpolate } from './interpolation';
export interface PrimitiveInstruction {
  readonly effects?: VisualEffects;
  readonly id: string;
  readonly component: PrimitiveClip['component'];
  readonly props: PrimitiveClip['props'];
  readonly transform: Readonly<Transform>;
  readonly reveal?: {
    readonly start: number;
    readonly end: number;
    readonly mode: 'show' | 'draw' | 'type';
  };
}
export interface RenderNode extends PrimitiveInstruction {
  readonly ownerId?: string;
  readonly parent?: Readonly<Transform>;
  readonly progress: number;
}
export interface RenderElement {
  readonly id: string;
  readonly transform: Readonly<Transform>;
}
export interface VideoRenderElement extends RenderElement {
  readonly kind: 'video';
  readonly assetId: string;
  readonly sourceTimeMs: number;
  readonly fit: VideoProps['fit'];
  readonly crop?: VideoProps['crop'];
  readonly placement: VideoProps['placement'];
  readonly effects?: VisualEffects;
}
export interface RenderGraph {
  readonly media?: readonly VideoRenderElement[];
  readonly camera: ResolvedCameraState;
  readonly frame: number;
  readonly canvas: VideoProject['canvas'];
  readonly theme: VideoProject['theme'];
  readonly nodes: readonly RenderNode[];
  readonly elements?: readonly RenderElement[];
}
export interface ComponentCompiler {
  readonly type: Clip['component'];
  compile(clip: Clip, project: VideoProject): readonly PrimitiveInstruction[];
}
export type ComponentRegistry = readonly ComponentCompiler[];
export interface CompiledState {
  sourceClipId: string;
  startFrame: number;
  endFrame: number;
  key: string;
}
export interface CompiledProject {
  readonly project: VideoProject;
  readonly clips: readonly Clip[];
  readonly instructions: Readonly<
    Record<string, readonly PrimitiveInstruction[]>
  >;
  readonly durationFrames: number;
  readonly states: readonly CompiledState[];
  readonly variants: Readonly<Record<string, Clip>>;
  readonly choreography: ResolvedChoreography;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
export function compileProject(
  input: VideoProject,
  registry: ComponentRegistry = [],
  choreography: ResolvedChoreography = {
    clipStates: [],
    generatedAnimations: [],
    generatedSubtitles: [],
  },
): CompiledProject {
  const project = freeze(projectSchema.parse(input));
  choreography = structuredClone(choreography);
  const durationFrames = Math.max(
    ...project.scenes.map((s) => s.startFrame + s.durationFrames),
  );
  const sourceClips = resolveProjectLayouts(project);
  const sourceById = new Map(sourceClips.map((c) => [c.id, c]));
  const subtitleIds = new Set(choreography.generatedSubtitles.map((c) => c.id));
  const animationsByClip = new Map<
    string,
    ResolvedChoreography['generatedAnimations']
  >();
  for (const animation of choreography.generatedAnimations) {
    const list = animationsByClip.get(animation.sourceClipId) ?? [];
    list.push(animation);
    animationsByClip.set(animation.sourceClipId, list);
  }
  const allIds = new Set([
    project.id,
    ...project.assets.map((a) => a.id),
    ...project.scenes.map((s) => s.id),
    ...project.tracks.flatMap((t) => [t.id, ...t.clips.map((c) => c.id)]),
    ...project.markers.map((m) => m.id),
    ...(project.narration?.segments.flatMap((s) => [
      s.id,
      ...(s.cues?.map((c) => c.id) ?? []),
    ]) ?? []),
  ]);
  for (const subtitle of choreography.generatedSubtitles) {
    if (allIds.has(subtitle.id))
      throw new Error('Generated subtitle ID collision');
    allIds.add(subtitle.id);
    if (subtitle.startFrame + subtitle.durationFrames > durationFrames)
      throw new Error('Generated subtitle outside project');
  }
  for (const animation of choreography.generatedAnimations) {
    const clip = sourceById.get(animation.sourceClipId);
    if (!clip) throw new Error('Unknown generated animation source');
    if (clip.component === 'ForeignComposition')
      throw new Error(
        'Foreign composition choreography is unsupported; edit implementation source',
      );
    animation.track = animationSchema.parse(animation.track);
    if (animation.track.keyframes.some((k) => k.frame >= clip.durationFrames))
      throw new Error('Generated animation outside clip');
  }
  const compilers = new Map<string, ComponentCompiler>();
  for (const compiler of registry) {
    if (compilers.has(compiler.type))
      throw new Error(`Duplicate compiler: ${compiler.type}`);
    compilers.set(compiler.type, compiler);
  }
  const enabled = new Set(
    project.tracks
      .filter(isVisualTrack)
      .filter((t) => !t.muted)
      .flatMap((t) => t.clips.map((c) => c.id)),
  );
  const clips = [
    ...sourceClips,
    ...choreography.generatedSubtitles.map((c) => clipSchema.parse(c)),
  ]
    .filter((c) => enabled.has(c.id) || subtitleIds.has(c.id))
    .map((c) => {
      const authored = compileMotion(c, project.fps);
      return {
        ...c,
        animations: [
          ...authored,
          ...(animationsByClip.get(c.id) ?? [])
            .filter(
              (a) =>
                !a.primitiveId &&
                !authored.some((m) => m.property === a.track.property),
            )
            .map((a) => a.track),
        ],
      };
    });
  const clipById = new Map(clips.map((c) => [c.id, c]));
  const instructions: Record<string, readonly PrimitiveInstruction[]> =
    Object.create(null) as Record<string, readonly PrimitiveInstruction[]>;
  const compileOne = (clip: Clip, key: string) => {
    if (clip.component === 'ForeignComposition' || clip.component === 'Video') {
      instructions[key] = [];
      return;
    }
    if (['Text', 'Shape', 'Arrow', 'Path'].includes(clip.component)) return;
    const compiler = compilers.get(clip.component);
    if (!compiler) throw new Error(`Register a compiler for ${clip.component}`);
    const seen = new Set<string>();
    instructions[key] = compiler.compile(clip, project).map((node) => {
      if (typeof node.id !== 'string' || !node.id || node.id.length > 512)
        throw new Error('Invalid internal primitive ID');
      if (seen.has(node.id))
        throw new Error(`Duplicate compiled primitive: ${node.id}`);
      seen.add(node.id);
      const parsed = primitiveClipSchema.parse({
        id: 'internal',
        component: node.component,
        props: node.props,
        effects: node.effects,
        transform: node.transform,
        startFrame: 0,
        durationFrames: 1,
      });
      if (
        node.reveal &&
        (!Number.isFinite(node.reveal.start) ||
          !Number.isFinite(node.reveal.end) ||
          node.reveal.start < 0 ||
          node.reveal.end > 1 ||
          node.reveal.start >= node.reveal.end)
      )
        throw new Error('Invalid primitive reveal interval');
      return {
        id: node.id,
        component: parsed.component,
        props: parsed.props,
        ...(parsed.effects ? { effects: parsed.effects } : {}),
        transform: parsed.transform,
        ...(node.reveal ? { reveal: node.reveal } : {}),
      };
    });
  };
  for (const clip of clips) compileOne(clip, clip.id);
  const variants: Record<string, Clip> = Object.create(null) as Record<
    string,
    Clip
  >;
  const states: CompiledState[] = [];
  const statesByClipId = new Map<string, CompiledState[]>();
  const signatures = new Map<string, string>();
  for (const state of choreography.clipStates) {
    const clip = clipById.get(state.sourceClipId);
    if (!sourceById.has(state.sourceClipId))
      throw new Error('Unknown resolved state source');
    if (!clip) continue; // Muted visual tracks have no runtime states.
    if (clip.component === 'ForeignComposition')
      throw new Error(
        'Foreign composition choreography is unsupported; edit implementation source',
      );
    if (
      !Number.isInteger(state.startFrame) ||
      !Number.isInteger(state.endFrame) ||
      state.startFrame < clip.startFrame ||
      state.endFrame > clip.startFrame + clip.durationFrames ||
      state.endFrame <= state.startFrame
    )
      throw new Error('Invalid resolved state interval');
    if (
      (statesByClipId.get(clip.id) ?? []).some(
        (s) => s.startFrame < state.endFrame && state.startFrame < s.endFrame,
      )
    )
      throw new Error('Overlapping resolved states');
    const props = Object.fromEntries(
      Object.entries(state.propsPatch).sort(([a], [b]) =>
        a.localeCompare(b, 'en'),
      ),
    );
    const signature = JSON.stringify([clip.id, props]);
    let key = signatures.get(signature);
    if (!key) {
      key = `state:${signatures.size}:${clip.id}`;
      while (allIds.has(key)) key += ':';
      allIds.add(key);
      signatures.set(signature, key);
      variants[key] = clipSchema.parse({
        ...clip,
        props: { ...clip.props, ...props },
      });
      compileOne(variants[key]!, key);
    }
    const compiledState = {
      sourceClipId: clip.id,
      startFrame: state.startFrame,
      endFrame: state.endFrame,
      key,
    };
    states.push(compiledState);
    const clipStates = statesByClipId.get(clip.id) ?? [];
    clipStates.push(compiledState);
    statesByClipId.set(clip.id, clipStates);
  }
  for (const animation of choreography.generatedAnimations) {
    if (
      animation.primitiveId &&
      enabled.has(animation.sourceClipId) &&
      !instructions[animation.sourceClipId]?.some(
        (n) => n.id === animation.primitiveId,
      )
    )
      throw new Error('Unknown generated primitive target');
  }
  const compiled = freeze({
    project,
    clips,
    instructions,
    states,
    variants,
    choreography: structuredClone(choreography),
    durationFrames,
  });
  evaluationIndexes(compiled);
  return compiled;
}
function revealNode(
  node: PrimitiveInstruction,
  progress: number,
): RenderNode | undefined {
  const reveal = node.reveal;
  if (!reveal) return { ...node, progress: 1 };
  if (progress < reveal.start) return;
  const amount = Math.min(
    1,
    Math.max(0, (progress - reveal.start) / (reveal.end - reveal.start)),
  );
  if (reveal.mode === 'type' && 'text' in node.props)
    return {
      ...node,
      props: {
        ...node.props,
        text: node.props.text.slice(
          0,
          Math.floor(node.props.text.length * amount),
        ),
      },
      progress: 1,
    };
  return { ...node, progress: reveal.mode === 'draw' ? amount : 1 };
}
export function evaluateAtFrame(
  compiled: CompiledProject,
  requestedFrame: number,
): RenderGraph {
  const frame = clampFrame(requestedFrame, 0, compiled.durationFrames - 1);
  const indexes = evaluationIndexes(compiled);
  const active = compiled.clips
    .filter(
      (c) => frame >= c.startFrame && frame < c.startFrame + c.durationFrames,
    )
    .map((source) => {
      const state = indexes.statesByClipId[source.id]?.find(
        (s) => frame >= s.startFrame && frame < s.endFrame,
      );
      const key = state?.key ?? source.id;
      const clip = state ? compiled.variants[key]! : source;
      const transform = { ...clip.transform };
      let progress = 1;
      for (const animation of clip.animations) {
        const value = interpolate(animation, frame - clip.startFrame);
        if (animation.property === 'progress') progress = value;
        else transform[animation.property] = value;
      }
      return { clip, transform, progress, key };
    })
    .sort((a, b) => a.transform.zIndex - b.transform.zIndex);
  const nodes: RenderNode[] = [];
  const elements: RenderElement[] = [];
  const media: VideoRenderElement[] = [];
  for (const { clip, transform, progress, key } of active) {
    if (clip.component === 'ForeignComposition') continue;
    if (clip.component === 'Video') {
      media.push({
        id: clip.id,
        kind: 'video',
        assetId: clip.props.assetId,
        sourceTimeMs: videoSourceTimeMs(clip, frame, compiled.project.fps),
        transform,
        fit: clip.props.fit,
        crop: clip.props.crop,
        placement: clip.props.placement,
        effects: clip.effects,
      });
      elements.push({ id: clip.id, transform });
      continue;
    }
    elements.push({ id: clip.id, transform });
    const instructions = compiled.instructions[key];
    if (!instructions) {
      const primitive = clip as PrimitiveClip;
      nodes.push({
        id: primitive.id,
        component: primitive.component,
        props: primitive.props,
        effects: clip.effects,
        transform,
        progress,
      });
      continue;
    }
    // Layout is compiled in base dimensions; animate parent dimensions as a group scale.
    const parent = {
      ...transform,
      width: clip.transform.width,
      height: clip.transform.height,
      x: transform.x + (transform.width - clip.transform.width) / 2,
      y: transform.y + (transform.height - clip.transform.height) / 2,
      scaleX: (transform.scaleX * transform.width) / clip.transform.width,
      scaleY: (transform.scaleY * transform.height) / clip.transform.height,
    };
    for (const instruction of instructions) {
      const node = revealNode(instruction, progress);
      if (node) {
        let evaluated = node;
        for (const animation of indexes.primitiveAnimationsByClipId[clip.id]?.[
          instruction.id
        ] ?? []) {
          const value = interpolate(animation.track, frame - clip.startFrame);
          evaluated =
            animation.track.property === 'progress'
              ? { ...evaluated, progress: value }
              : {
                  ...evaluated,
                  transform: {
                    ...evaluated.transform,
                    [animation.track.property]: value,
                  },
                };
        }
        nodes.push({
          ...evaluated,
          effects: evaluated.effects ?? clip.effects,
          ownerId: clip.id,
          parent,
        });
      }
    }
  }
  return {
    frame,
    camera: resolveCamera(compiled.project, frame),
    canvas: compiled.project.canvas,
    theme: compiled.project.theme,
    nodes,
    elements,
    ...(media.length ? { media } : {}),
  };
}
export interface Renderer {
  render(graph: RenderGraph): void;
}
export function renderAtFrame(
  compiled: CompiledProject,
  frame: number,
  renderer: Renderer,
): RenderGraph {
  const graph = evaluateAtFrame(compiled, frame);
  renderer.render(graph);
  return graph;
}

export * from './theme';
