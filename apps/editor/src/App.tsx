import { ProjectToolbar } from './ProjectToolbar';
import { DemoButtons } from './DemoButtons';
import { PatchLab, type PatchPreview } from './PatchLab';
import { CameraPanel } from './CameraPanel';
import { compileChoreography } from '@scenewirejs/compiler';
import { isVisualTrack } from '@scenewirejs/schema';

import { componentRegistry } from './pack';
import { useMemo, useState } from 'react';
import {
  compileProject,
  detachLayout,
  createClipFromDefinition,
  themeIds,
  themePreset,
  resolveTheme,
} from '@scenewirejs/runtime';
import { findClip, nextId, projectDuration } from '@scenewirejs/editor-core';
import { CURRENT_PROJECT_VERSION, type Clip } from '@scenewirejs/schema';
import { frameToSeconds } from '@scenewirejs/time';
import { usePlayback, useProject, useSelection } from './state';
import { usePlaybackClock } from './usePlaybackClock';
import { Preview } from './Preview';
import { Inspector } from './Inspector';
import { Timeline } from './Timeline';
export function App() {
  const { project, apply } = useProject();
  const { frame, playing, seek, setPlaying } = usePlayback();
  const selectedId = useSelection((s) => s.selectedId);
  const resolution = useMemo(() => {
    try {
      return {
        choreography: compileChoreography({ project, componentRegistry }),
        error: '',
      };
    } catch (cause) {
      return {
        choreography: undefined,
        error: cause instanceof Error ? cause.message : 'Invalid choreography',
      };
    }
  }, [project]);
  const compiled = useMemo(
    () => compileProject(project, componentRegistry, resolution.choreography),
    [project, resolution],
  );
  const [patchPreview, setPatchPreview] = useState<PatchPreview>();
  const previewing = patchPreview?.base === project;
  const displayCompiled = useMemo(() => {
    if (!previewing) return compiled;
    const candidate = patchPreview.project;
    return compileProject(
      candidate,
      componentRegistry,
      compileChoreography({ project: candidate, componentRegistry }),
    );
  }, [compiled, previewing, patchPreview]);
  const duration = displayCompiled.durationFrames;

  const [error, setError] = useState('');
  usePlaybackClock(project, duration, setError);
  const selected = findClip(project, selectedId);
  const locked = project.tracks.some(
    (t) => t.locked && t.clips.some((c) => c.id === selectedId),
  );
  const add = (component: Clip['component']) => {
    const track = project.tracks
      .filter(isVisualTrack)
      .find((t) => t.type === 'visual' && !t.locked);
    if (!track) {
      setError('Unlock a visual track before adding a component.');
      return;
    }
    const definition = componentRegistry.find((d) => d.type === component)!;
    const clip = createClipFromDefinition({
      definition,
      id: nextId(project, component.toLowerCase()),
      startFrame: frame,
      durationFrames: Math.min(
        definition.authoring.defaultDurationFrames ?? 90,
        duration - frame,
      ),
    });
    apply({
      ...project,
      version: CURRENT_PROJECT_VERSION,
      tracks: project.tracks.map((t) =>
        isVisualTrack(t) && t.id === track.id
          ? { ...t, clips: [...t.clips, clip] }
          : t,
      ),
    });
    useSelection.getState().select(clip.id);
  };
  return (
    <main>
      <ProjectToolbar
        compiled={compiled}
        resolutionError={resolution.error}
        onError={setError}
      />
      {(error || resolution.error) && (
        <div className="error" role="alert">
          <span>{error || resolution.error}</span>
          <button onClick={() => setError('')}>Dismiss</button>
        </div>
      )}
      <div className="workspace">
        <aside className="library">
          <div className="panel-heading">COMPONENTS</div>
          <p className="library-intro">Build with structure.</p>
          {[...new Set(componentRegistry.map((d) => d.category))].map(
            (category) => (
              <section key={category}>
                <h3>
                  {category === 'primitive'
                    ? 'Primitives'
                    : `${category[0]!.toUpperCase()}${category.slice(1)} Pack`}
                </h3>
                <div className="developer-list">
                  {componentRegistry
                    .filter((d) => d.category === category)
                    .map((d) => (
                      <button
                        key={d.type}
                        aria-label={`Add ${d.type}`}
                        title={d.authoring.description}
                        onClick={() => add(d.type)}
                      >
                        {d.authoring.label}
                        <span>+</span>
                      </button>
                    ))}
                </div>
              </section>
            ),
          )}
          <h3>Project</h3>
          <CameraPanel />
          <label className="field">
            <span>Theme</span>
            <select
              aria-label="Project theme"
              value={resolveTheme(project.theme).id}
              onChange={(e) => {
                const theme = themePreset(
                  e.target.value as (typeof themeIds)[number],
                );
                apply({
                  ...project,
                  theme,
                  canvas: {
                    ...project.canvas,
                    background: resolveTheme(theme).background,
                  },
                });
              }}
            >
              {themeIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <DemoButtons />
          <div className="library-note">
            <span className="status-dot" />
            Deterministic Canvas runtime
            <p>
              {(duration / project.fps).toFixed(0)} seconds ·{' '}
              {project.scenes.length} scenes
              <br />
              Every element stays editable.
            </p>
          </div>
          <div className="selection-actions">
            <button
              disabled={!selected || locked}
              onClick={() => {
                if (!selected) return;
                const resolvedTransform =
                  compiled.clips.find((c) => c.id === selected.id)?.transform ??
                  selected.transform;
                const duplicate = {
                  ...selected,
                  id: nextId(
                    project,
                    `${selected.component.toLowerCase()}-copy`,
                  ),
                  transform: {
                    ...resolvedTransform,
                    x: resolvedTransform.x + 24,
                    y: resolvedTransform.y + 24,
                  },
                };
                apply({
                  ...project,
                  tracks: project.tracks.map((t) =>
                    isVisualTrack(t) &&
                    t.clips.some((c) => c.id === selected.id)
                      ? { ...t, clips: [...t.clips, duplicate] }
                      : t,
                  ),
                });
                useSelection.getState().select(duplicate.id);
              }}
            >
              Duplicate
            </button>
            <button
              disabled={
                !selected ||
                locked ||
                project.narration?.segments.some((s) =>
                  s.cues?.some((c) =>
                    'targetId' in c
                      ? c.targetId === selectedId
                      : c.target.kind === 'semantic'
                        ? !c.target.clipId || c.target.clipId === selectedId
                        : c.target.clipId === selectedId,
                  ),
                )
              }
              onClick={() => {
                const detached = detachLayout(project, selectedId!);
                apply({
                  ...detached,
                  tracks: detached.tracks.map((t) =>
                    !isVisualTrack(t)
                      ? t
                      : {
                          ...t,
                          clips: t.clips.filter((c) => c.id !== selectedId),
                        },
                  ),
                });
                useSelection.getState().select(undefined);
              }}
            >
              Delete
            </button>
          </div>
        </aside>
        <div className="stage">
          <Preview
            key={previewing ? 'patch' : 'original'}
            compiled={displayCompiled}
            readOnly={previewing}
          />
          <div className="transport">
            <button aria-label="Go to start" onClick={() => seek(0)}>
              ↤
            </button>
            <button
              className="play-button"
              disabled={previewing}
              aria-label={playing ? 'Pause' : 'Play'}
              onClick={() => {
                if (!playing && frame >= duration - 1) seek(0);
                setPlaying(!playing);
              }}
            >
              {playing ? 'Ⅱ' : '▶'}
            </button>
            <output aria-label="Current time">
              {frameToSeconds(frame, project.fps).toFixed(2)}
              <span>
                {' '}
                /{' '}
                {frameToSeconds(projectDuration(project), project.fps).toFixed(
                  2,
                )}
                s
              </span>
            </output>
            <input
              aria-label="Seek frame"
              type="range"
              min={0}
              max={duration - 1}
              value={frame}
              onChange={(e) => seek(Number(e.target.value))}
            />
          </div>
        </div>
        <Inspector />
      </div>
      <PatchLab onPreview={setPatchPreview} previewing={previewing} />
      <Timeline />
    </main>
  );
}
