import { isVisualTrack } from '@scenewirejs/schema';
import { useEffect, useState } from 'react';
import {
  projectSchema,
  motionSchema,
  motionProperties,
  motionPresetSchema,
  type Clip,
} from '@scenewirejs/schema';
import { detachLayout } from '@scenewirejs/runtime';
import { usePlayback, useProject } from './state';
export function SceneLayoutInspector() {
  const { project, apply } = useProject();
  const frame = usePlayback((s) => s.frame);
  const scene = project.scenes.find(
    (s) => frame >= s.startFrame && frame < s.startFrame + s.durationFrames,
  );
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(
      scene?.layout && typeof scene.layout !== 'string'
        ? JSON.stringify(scene.layout, null, 2)
        : '',
    );
    setError('');
  }, [scene]);
  if (!scene) return null;
  const ids = project.tracks
    .filter(isVisualTrack)
    .flatMap((t) => t.clips)
    .filter(
      (c) =>
        c.startFrame >= scene.startFrame &&
        c.startFrame + c.durationFrames <=
          scene.startFrame + scene.durationFrames,
    )
    .map((c) => c.id);
  const locked = project.tracks.some(
    (t) => t.locked && t.clips.some((c) => ids.includes(c.id)),
  );
  const commit = (layout: unknown) => {
    try {
      apply(
        projectSchema.parse({
          ...project,
          version: 7,
          scenes: project.scenes.map((s) =>
            s.id === scene.id ? { ...s, layout } : s,
          ),
        }),
      );
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invalid layout');
    }
  };
  return (
    <details className="authoring-section">
      <summary>Scene layout · {scene.name}</summary>
      <label className="field">
        <span>Layout type</span>
        <select
          aria-label="Layout type"
          disabled={locked || !ids.length}
          value={
            typeof scene.layout === 'object' ? scene.layout.type : 'manual'
          }
          onChange={(e) => {
            if (e.target.value === 'manual') {
              if (typeof scene.layout === 'object')
                apply(detachLayout(project, scene.layout.clipIds[0]!));
              return;
            }
            const type = e.target.value;
            commit({
              type,
              clipIds: ids,
              padding: 48,
              gap: 24,
              ...(type === 'split'
                ? { ratio: [0.42, 0.58] }
                : type === 'grid'
                  ? { columns: 2 }
                  : {}),
            });
          }}
        >
          <option value="manual">Manual</option>
          {['absolute', 'centered', 'stack', 'grid', 'split'].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Layout intent</span>
        <textarea
          aria-label="Scene layout JSON"
          value={draft}
          disabled={locked}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      <button
        disabled={locked || !draft}
        onClick={() => {
          try {
            commit(JSON.parse(draft) as unknown);
          } catch {
            setError('Invalid JSON');
          }
        }}
      >
        Apply layout
      </button>
      <p className="hint">
        References use clip IDs. Split needs two clips. Manual mode keeps
        resolved bounds. Moving a layout item detaches its scene layout.
      </p>
      {error && (
        <p role="alert" className="props-error">
          {error}
        </p>
      )}
    </details>
  );
}
export function SemanticMotionInspector({
  clip,
  disabled,
  apply,
}: {
  clip: Clip;
  disabled: boolean;
  apply: (next: Clip) => void;
}) {
  const savedTags = clip.semantic?.tags?.join(', ') ?? '';
  const [tags, setTags] = useState(savedTags);
  useEffect(() => setTags(savedTags), [clip.id, savedTags]);
  return (
    <>
      <h3>Meaning</h3>
      {(['role', 'entity', 'concept', 'tags'] as const).map((key) => (
        <label className="field" key={key}>
          <span>{key}</span>
          <input
            aria-label={`Semantic ${key}`}
            disabled={disabled}
            value={key === 'tags' ? tags : (clip.semantic?.[key] ?? '')}
            maxLength={key === 'tags' ? 1000 : 200}
            onBlur={() => {
              if (key === 'tags')
                apply({
                  ...clip,
                  semantic: {
                    ...clip.semantic,
                    tags: tags
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .slice(0, 32)
                      .map((s) => s.slice(0, 100)),
                  },
                });
            }}
            onChange={(e) => {
              const value = e.target.value;
              if (key === 'tags') {
                setTags(value);
                return;
              }
              const semantic = {
                ...clip.semantic,
                [key]: value || undefined,
              };
              apply({ ...clip, semantic });
            }}
          />
        </label>
      ))}
      <h3>Motion intent</h3>
      <label className="field">
        <span>Motion preset</span>
        <select
          aria-label="Motion preset"
          disabled={disabled || clip.durationFrames < 2}
          value={clip.motion?.[0]?.preset ?? ''}
          onChange={(e) => {
            if (!e.target.value) {
              apply({ ...clip, motion: undefined });
              return;
            }
            const m = motionSchema.parse({
              preset: e.target.value,
              durationFrames: Math.min(clip.durationFrames, 90),
            });
            const properties = motionProperties(m.preset, m.direction);
            apply({
              ...clip,
              motion: [m],
              animations: clip.animations.filter(
                (a) => !properties.includes(a.property),
              ),
            });
          }}
        >
          <option value="">None</option>
          {motionPresetSchema.options.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      {clip.motion?.[0] && (
        <label className="field">
          <span>Amplitude</span>
          <input
            aria-label="Motion amplitude"
            type="number"
            min={0}
            max={4096}
            disabled={disabled}
            value={clip.motion[0].amplitude}
            onChange={(e) => {
              const amplitude = e.target.valueAsNumber;
              if (
                Number.isFinite(amplitude) &&
                amplitude >= 0 &&
                amplitude <= 4096
              )
                apply({
                  ...clip,
                  motion: clip.motion!.map((m, i) =>
                    i === 0 ? { ...m, amplitude } : m,
                  ),
                });
            }}
          />
        </label>
      )}
      <p className="hint">
        Selecting a preset replaces tracks on its properties; other keyframes
        remain. Presets compile to normal keyframes.
      </p>
    </>
  );
}
