import { isVisualTrack } from '@scenewirejs/schema';
import { useRef, useState } from 'react';
import {
  minimumClipDuration,
  projectDuration,
  updateClip,
} from '@scenewirejs/editor-core';
import { clampFrame, frameToSeconds } from '@scenewirejs/time';
import { usePlayback, useProject, useSelection } from './state';
interface Gesture {
  id: string;
  pointerX: number;
  start: number;
  duration: number;
  mode: 'move' | 'resize';
  minimum: number;
  laneWidth: number;
}
export function Timeline() {
  const project = useProject((s) => s.project);
  const frame = usePlayback((s) => s.frame);
  const selectedId = useSelection((s) => s.selectedId);
  const duration = projectDuration(project);
  const [zoom, setZoom] = useState(1);
  const gesture = useRef<Gesture | undefined>(undefined);
  const [draft, setDraft] = useState<{
    id: string;
    start: number;
    duration: number;
  }>();
  const draftRef = useRef<typeof draft>(undefined);
  const seekAt = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    usePlayback
      .getState()
      .seek(
        clampFrame(
          ((event.clientX - rect.left) / rect.width) * duration,
          0,
          duration - 1,
        ),
      );
  };
  return (
    <section className="timeline">
      <div className="panel-heading">
        <span>
          TIMELINE{' '}
          <small>{frameToSeconds(duration, project.fps).toFixed(2)}s</small>
        </span>
        <label>
          Zoom{' '}
          <input
            aria-label="Timeline zoom"
            type="range"
            min={1}
            max={3}
            step={0.25}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="timeline-scroll">
        <div className="timeline-inner" style={{ minWidth: `${zoom * 100}%` }}>
          <div className="track-header">TRACKS</div>
          <div
            className="ruler"
            onPointerDown={seekAt}
            onPointerMove={(e) => {
              if (e.buttons === 1) seekAt(e);
            }}
          >
            {Array.from({ length: 11 }, (_, i) => (
              <span key={i} style={{ left: `${i * 10}%` }}>
                {(((i / 10) * duration) / project.fps).toFixed(1)}s
              </span>
            ))}
          </div>
          {project.tracks.map((track) => (
            <div className="track-row" key={track.id}>
              <div className="track-name">
                <span>{track.name}</span>
                <div>
                  <button
                    aria-label={`Mute ${track.name}`}
                    aria-pressed={track.muted}
                    onClick={() =>
                      useProject.getState().apply({
                        ...project,
                        tracks: project.tracks.map((t) =>
                          t.id === track.id ? { ...t, muted: !t.muted } : t,
                        ),
                      })
                    }
                  >
                    M
                  </button>
                  <button
                    aria-label={`Lock ${track.name}`}
                    aria-pressed={track.locked}
                    onClick={() =>
                      useProject.getState().apply({
                        ...project,
                        tracks: project.tracks.map((t) =>
                          t.id === track.id ? { ...t, locked: !t.locked } : t,
                        ),
                      })
                    }
                  >
                    L
                  </button>
                </div>
              </div>
              <div
                className={`track-lane ${track.muted ? 'muted' : ''}`}
                onPointerMove={(e) => {
                  const g = gesture.current;
                  if (!g) return;
                  const delta = Math.round(
                    ((e.clientX - g.pointerX) / g.laneWidth) * duration,
                  );
                  const next =
                    g.mode === 'move'
                      ? {
                          id: g.id,
                          start: clampFrame(
                            g.start + delta,
                            0,
                            duration - g.duration,
                          ),
                          duration: g.duration,
                        }
                      : {
                          id: g.id,
                          start: g.start,
                          duration: clampFrame(
                            g.duration + delta,
                            g.minimum,
                            duration - g.start,
                          ),
                        };
                  draftRef.current = next;
                  setDraft(next);
                }}
                onPointerUp={() => {
                  const next = draftRef.current;
                  if (next) {
                    const state = useProject.getState();
                    state.apply(
                      updateClip(state.project, next.id, (c) => ({
                        ...c,
                        startFrame: next.start,
                        durationFrames: next.duration,
                      })),
                    );
                  }
                  gesture.current = undefined;
                  draftRef.current = undefined;
                  setDraft(undefined);
                }}
                onPointerCancel={() => {
                  gesture.current = undefined;
                  draftRef.current = undefined;
                  setDraft(undefined);
                }}
              >
                {track.clips.map((clip, index) => {
                  const timing =
                    draft?.id === clip.id
                      ? draft
                      : {
                          start: clip.startFrame,
                          duration: clip.durationFrames,
                        };
                  return (
                    <button
                      key={clip.id}
                      className={`timeline-clip ${selectedId === clip.id ? 'selected' : ''}`}
                      aria-label={`Select ${clip.id}`}
                      style={{
                        left: `${(timing.start / duration) * 100}%`,
                        width: `${(timing.duration / duration) * 100}%`,
                        top: `${index * 27 + 8}px`,
                      }}
                      onClick={() => useSelection.getState().select(clip.id)}
                      onPointerDown={(e) => {
                        useSelection.getState().select(clip.id);
                        if (track.locked || !isVisualTrack(track)) return;
                        usePlayback.getState().setPlaying(false);
                        e.currentTarget.parentElement?.setPointerCapture(
                          e.pointerId,
                        );
                        gesture.current = {
                          id: clip.id,
                          pointerX: e.clientX,
                          start: clip.startFrame,
                          duration: clip.durationFrames,
                          mode: (e.target as HTMLElement).dataset.resize
                            ? 'resize'
                            : 'move',
                          minimum:
                            'component' in clip ? minimumClipDuration(clip) : 1,
                          laneWidth:
                            e.currentTarget.parentElement!.getBoundingClientRect()
                              .width,
                        };
                      }}
                    >
                      <span>
                        {'component' in clip ? clip.component : 'Audio'}{' '}
                        <small>{clip.id}</small>
                      </span>
                      <span
                        data-resize="true"
                        className="resize-handle"
                        aria-label={`Resize ${clip.id}`}
                      >
                        ⋮
                      </span>
                    </button>
                  );
                })}
                <div
                  className="playhead"
                  style={{ left: `${(frame / duration) * 100}%` }}
                />
                <div
                  style={{
                    height: `${Math.max(90, track.clips.length * 27 + 16)}px`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="timeline-footer">
        <span>
          Frame {frame} / {duration - 1}
        </span>
        <span>
          Drag clips to move · drag right edge to trim · 1-frame snapping
        </span>
      </div>
    </section>
  );
}
