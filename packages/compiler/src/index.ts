import {
  animationSchema,
  clipSchema,
  isAudioTrack,
  projectSchema,
  visualClips,
  type Clip,
  type NarrationDocument,
  type SemanticCue,
  type WordTiming,
  type VideoProject,
} from '@scenewirejs/schema';
import {
  resolveSemanticTargets,
  type ComponentDefinition,
  type ComponentRegistry,
  type ResolvedChoreography,
  type ResolvedTarget,
} from '@scenewirejs/runtime';
import { validateSpeechTimings } from '@scenewirejs/audio';
type Interval = {
  id: string;
  clipId: string;
  start: number;
  end: number;
  priority: number;
  patch: Record<string, unknown>;
};
const normalize = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export function mapPhrase(
  words: readonly WordTiming[],
  phrase: string,
): { startMs: number; endMs: number }[] {
  const tokens = phrase.trim().split(/\s+/).map(normalize);
  if (tokens.some((t) => !t)) throw new Error('Invalid phrase mapping');
  const result: { startMs: number; endMs: number }[] = [];
  for (let i = 0; i + tokens.length <= words.length; i++)
    if (tokens.every((t, j) => normalize(words[i + j]!.text) === t))
      result.push({
        startMs: words[i]!.startMs,
        endMs: words[i + tokens.length - 1]!.endMs,
      });
  return result;
}
export function compileChoreography({
  project: input,
  narration,
  componentRegistry = [],
}: {
  project: VideoProject;
  narration?: NarrationDocument;
  componentRegistry?: ComponentRegistry;
}): ResolvedChoreography {
  const project = projectSchema.parse(
      narration ? { ...(input as object), narration } : input,
    ),
    document = project.narration;
  const result: ResolvedChoreography = {
    clipStates: [],
    generatedAnimations: [],
    generatedSubtitles: [],
  };
  const clips = visualClips(project),
    byId = new Map(clips.map((c) => [c.id, c]));
  const audio = project.tracks.filter(isAudioTrack).flatMap((t) => t.clips),
    intervals: Interval[] = [];
  const componentByType = new Map<string, ComponentDefinition>();
  for (const component of componentRegistry)
    if (!componentByType.has(component.type))
      componentByType.set(component.type, component as ComponentDefinition);
  const audioById = new Map(audio.map((c) => [c.id, c]));
  const numeric = new Map<
    string,
    {
      clip: Clip;
      primitiveId?: string;
      property: ReturnType<typeof animationSchema.parse>['property'];
      cues: {
        id: string;
        start: number;
        end: number;
        from: number;
        to: number;
        priority: number;
      }[];
    }
  >();
  const add = (cue: SemanticCue, base: number, duration: number) => {
    const relative = cue.range ?? {
      startMs: cue.atMs!,
      endMs:
        cue.atMs! +
        (typeof cue.payload?.durationMs === 'number'
          ? cue.payload.durationMs
          : 1000 / project.fps),
    };
    if (relative.endMs > duration || relative.endMs <= relative.startMs)
      throw new Error(`Cue outside segment: ${cue.id}`);
    const targets = resolveSemanticTargets(project, cue.target);
    if (!targets.length)
      throw new Error(`Unresolved semantic target: ${cue.id}`);
    for (const target of targets) {
      const clip = byId.get(target.clipId)!;
      const start = base + Math.round((relative.startMs * project.fps) / 1000),
        end = base + Math.round((relative.endMs * project.fps) / 1000);
      if (
        end <= start ||
        start < clip.startFrame ||
        end > clip.startFrame + clip.durationFrames
      )
        throw new Error(
          `Cue outside target clip or shorter than a frame: ${cue.id}`,
        );
      const adapter = componentByType.get(clip.component)?.choreography;
      const patch =
        cue.action === 'show' || cue.action === 'hide'
          ? {
              animation: {
                property: 'opacity' as const,
                from: cue.action === 'show' ? 0 : 1,
                to: cue.action === 'show' ? 1 : 0,
              },
            }
          : adapter?.apply(cue.action, target, clip.props, cue.payload);
      if (!patch)
        throw new Error(
          `Unsupported choreography: ${clip.component}/${cue.action}`,
        );
      const priority = cue.source === 'manual' ? 2 : 1;
      if (patch.propsPatch) {
        clipSchema.parse({
          ...clip,
          props: { ...clip.props, ...patch.propsPatch },
        });
        // Persisted explicit props are the highest priority; default absence allows cues.
        const accepted = Object.fromEntries(
          Object.entries(patch.propsPatch).filter(
            ([key]) =>
              (clip.props as Record<string, unknown>)[key] === undefined,
          ),
        );
        if (Object.keys(accepted).length)
          intervals.push({
            id: cue.id,
            clipId: clip.id,
            start,
            end,
            priority,
            patch: accepted,
          });
      }
      if (patch.animation) {
        const a = patch.animation;
        if (
          !a.primitiveId &&
          clip.animations.some((t) => t.property === a.property)
        )
          continue;
        const key = JSON.stringify([clip.id, a.primitiveId, a.property]);
        let group = numeric.get(key);
        if (!group) {
          group = {
            clip,
            primitiveId: a.primitiveId,
            property: a.property,
            cues: [],
          };
          numeric.set(key, group);
        }
        group.cues.push({
          id: cue.id,
          start: start - clip.startFrame,
          end: end - clip.startFrame - 1,
          from: a.from,
          to: a.to,
          priority,
        });
      }
    }
  };
  for (const segment of document?.segments ?? []) {
    const linked = audioById.get(segment.audioClipId ?? '');
    const base = linked?.startFrame ?? segment.startFrame ?? 0;
    const duration =
      ((linked?.durationFrames ?? segment.durationFrames ?? 0) * 1000) /
      project.fps;
    if (!duration && (segment.cues?.length || segment.words?.length))
      throw new Error('Timed narration requires duration');
    const words = validateSpeechTimings(segment.words ?? [], duration || 1);
    for (const cue of segment.cues ?? []) {
      const normalized: SemanticCue =
        'targetId' in cue
          ? {
              id: cue.id,
              source: 'manual',
              action: cue.type,
              target: { kind: 'clip', clipId: cue.targetId },
              atMs: cue.atMs,
              payload: cue.payload,
            }
          : cue;
      add(normalized, base, duration);
    }
    for (const [i, mapping] of (segment.phraseMappings ?? []).entries()) {
      const matches = mapPhrase(words, mapping.phrase);
      if (!matches.length)
        throw new Error(`Phrase not found: ${mapping.phrase}`);
      matches.forEach((range, j) =>
        add(
          {
            id: `${segment.id}:phrase:${i}:${j}`,
            source: 'alignment',
            action: mapping.action,
            target: mapping.target,
            range: {
              ...range,
              endMs: mapping.durationMs
                ? range.startMs + mapping.durationMs
                : range.endMs,
            },
          },
          base,
          duration,
        ),
      );
    }
    if (segment.subtitleMode && words.length) {
      const phrases = segment.phrases?.length
        ? validateSpeechTimings(segment.phrases, duration)
        : Array.from({ length: Math.ceil(words.length / 7) }, (_, i) => {
            const part = words.slice(i * 7, i * 7 + 7);
            return {
              text: part.map((w) => w.text).join(' '),
              startMs: part[0]!.startMs,
              endMs: part.at(-1)!.endMs,
            };
          });
      phrases.forEach((phrase, i) => {
        const startFrame =
            base + Math.round((phrase.startMs * project.fps) / 1000),
          endFrame = base + Math.round((phrase.endMs * project.fps) / 1000);
        if (endFrame <= startFrame) return;
        result.generatedSubtitles.push(
          clipSchema.parse({
            id: `subtitle:${segment.id}:${i}`,
            component: 'Text',
            startFrame,
            durationFrames: endFrame - startFrame,
            transform: {
              x: 40,
              y: project.canvas.height - 65,
              width: project.canvas.width - 80,
              height: 38,
              zIndex: 1000,
            },
            props: {
              text: phrase.text,
              fontSize: 23,
              align: 'center',
              color: project.theme.foreground,
            },
          }),
        );
      });
      if (segment.subtitleMode === 'active-word')
        words.forEach((word, i) => {
          const startFrame =
              base + Math.round((word.startMs * project.fps) / 1000),
            endFrame = base + Math.round((word.endMs * project.fps) / 1000);
          if (endFrame <= startFrame) return;
          result.generatedSubtitles.push(
            clipSchema.parse({
              id: `word:${segment.id}:${i}`,
              component: 'Text',
              startFrame,
              durationFrames: endFrame - startFrame,
              transform: {
                x: 40,
                y: project.canvas.height - 100,
                width: project.canvas.width - 80,
                height: 32,
                zIndex: 1001,
              },
              props: {
                text: word.text,
                fontSize: 21,
                align: 'center',
                color: project.theme.accent,
              },
            }),
          );
        });
    }
  }
  const intervalsByClipId = new Map<string, Interval[]>();
  for (const interval of intervals) {
    const list = intervalsByClipId.get(interval.clipId) ?? [];
    list.push(interval);
    intervalsByClipId.set(interval.clipId, list);
  }
  for (const clip of clips) {
    const states = intervalsByClipId.get(clip.id) ?? [];
    if (!states.length) continue;
    const bounds = [...new Set(states.flatMap((s) => [s.start, s.end]))].sort(
      (a, b) => a - b,
    );
    for (let i = 0; i < bounds.length - 1; i++) {
      const startFrame = bounds[i]!,
        endFrame = bounds[i + 1]!,
        active = states.filter(
          (s) => s.start <= startFrame && s.end >= endFrame,
        );
      const patch: Record<string, unknown> = {},
        priorities = new Map<string, number>();
      for (const state of active.sort(
        (a, b) => b.priority - a.priority || a.id.localeCompare(b.id, 'en'),
      ))
        for (const [key, value] of Object.entries(state.patch)) {
          const priority = priorities.get(key);
          if (
            priority === state.priority &&
            JSON.stringify(patch[key]) !== JSON.stringify(value)
          )
            throw new Error(`Conflicting cues patch ${clip.id}.${key}`);
          if (priority === undefined) {
            priorities.set(key, state.priority);
            patch[key] = value;
          }
        }
      if (Object.keys(patch).length)
        result.clipStates.push({
          sourceClipId: clip.id,
          startFrame,
          endFrame,
          propsPatch: patch,
        });
    }
  }
  for (const group of numeric.values()) {
    const ordered = group.cues.sort(
      (a, b) =>
        a.start - b.start ||
        b.priority - a.priority ||
        a.id.localeCompare(b.id, 'en'),
    );
    const bounds = [
      ...new Set(ordered.flatMap((c) => [c.start, c.end + 1])),
    ].sort((a, b) => a - b);
    const keys = new Map<number, number>();
    keys.set(0, ordered[0]!.from);
    let held = ordered[0]!.from;
    for (let i = 0; i < bounds.length - 1; i++) {
      const start = bounds[i]!,
        end = bounds[i + 1]! - 1;
      const active = ordered
        .filter((c) => c.start <= start && c.end >= end)
        .sort(
          (a, b) => b.priority - a.priority || a.id.localeCompare(b.id, 'en'),
        );
      const winner = active[0];
      if (!winner) {
        keys.set(start, held);
        keys.set(end, held);
        continue;
      }
      const value = (cue: typeof winner, frame: number) =>
        cue.start === cue.end
          ? cue.to
          : cue.from +
            ((cue.to - cue.from) * (frame - cue.start)) / (cue.end - cue.start);
      for (const other of active.slice(1))
        if (
          other.priority === winner.priority &&
          (value(other, start) !== value(winner, start) ||
            value(other, end) !== value(winner, end))
        )
          throw new Error(
            `Conflicting generated animations: ${group.clip.id}.${group.property}`,
          );
      keys.set(start, value(winner, start));
      held = value(winner, end);
      keys.set(end, held);
    }
    result.generatedAnimations.push({
      sourceClipId: group.clip.id,
      primitiveId: group.primitiveId,
      track: animationSchema.parse({
        property: group.property,
        keyframes: [...keys]
          .sort(([a], [b]) => a - b)
          .map(([frame, value]) => ({ frame, value, easing: 'linear' })),
      }),
    });
  }
  // Namespace collisions must never silently mask source objects.
  const ids = new Set(clips.map((c) => c.id));
  for (const clip of result.generatedSubtitles) {
    if (ids.has(clip.id)) throw new Error('Generated subtitle ID collision');
    ids.add(clip.id);
  }
  return result;
}
export type { ResolvedTarget };
