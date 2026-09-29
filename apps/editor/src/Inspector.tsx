import {
  SceneLayoutInspector,
  SemanticMotionInspector,
} from './AuthoringInspector';
import { resolveProjectLayouts } from '@scenewirejs/runtime';
import { StructuredPropsInspector } from './StructuredPropsInspector';
import { inspectorAdapters } from './inspectorAdapters';
import {
  findClip,
  minimumClipDuration,
  projectDuration,
  updateClip,
} from '@scenewirejs/editor-core';
import type { Clip } from '@scenewirejs/schema';
import { useProject, useSelection } from './state';
function NumberField({
  label,
  value,
  min,
  max,
  change,
  disabled,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  change: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => {
          const value = event.target.valueAsNumber;
          if (
            !Number.isFinite(value) ||
            (min !== undefined && value < min) ||
            (max !== undefined && value > max)
          )
            return;
          change(value);
        }}
      />
    </label>
  );
}
export function Inspector() {
  const project = useProject((s) => s.project);
  const selectedId = useSelection((s) => s.selectedId);
  const authored = findClip(project, selectedId);
  const clip =
    resolveProjectLayouts(project).find((c) => c.id === selectedId) ?? authored;
  const PropsInspector = clip
    ? (inspectorAdapters[clip.component] ?? StructuredPropsInspector)
    : StructuredPropsInspector;
  const apply = useProject((s) => s.apply);
  const locked = project.tracks.some(
    (t) => t.locked && t.clips.some((c) => c.id === selectedId),
  );
  const edit = (change: (clip: Clip) => Clip) => {
    if (clip) apply(updateClip({ ...project, version: 7 }, clip.id, change));
  };
  return (
    <aside className="inspector">
      <div className="panel-heading">INSPECTOR</div>
      <SceneLayoutInspector />
      {clip ? (
        <>
          <div className="component-tag">
            {clip.component}
            <span>{locked ? 'Locked' : 'Editable'}</span>
          </div>
          <p className="id-label">{clip.id}</p>
          <h3>Transform</h3>
          <div className="field-grid">
            {(
              ['x', 'y', 'width', 'height', 'rotation', 'opacity'] as const
            ).map((key) => (
              <NumberField
                key={key}
                label={key}
                value={clip.transform[key]}
                min={
                  key === 'opacity'
                    ? 0
                    : key === 'width' || key === 'height'
                      ? 1
                      : undefined
                }
                max={key === 'opacity' ? 1 : undefined}
                disabled={locked}
                change={(value) =>
                  edit((c) => ({
                    ...c,
                    transform: { ...c.transform, [key]: value },
                  }))
                }
              />
            ))}
          </div>
          <NumberField
            label="Blur px"
            value={clip.effects?.blurPx ?? 0}
            min={0}
            max={40}
            disabled={locked}
            change={(value) =>
              edit((c) => ({ ...c, effects: { blurPx: value } }))
            }
          />
          <h3>Content</h3>
          {clip.component === 'Text' && (
            <>
              <label className="field">
                <span>Text</span>
                <textarea
                  aria-label="Text"
                  value={clip.props.text}
                  disabled={locked}
                  onChange={(e) =>
                    edit((c) =>
                      c.component === 'Text'
                        ? { ...c, props: { ...c.props, text: e.target.value } }
                        : c,
                    )
                  }
                />
              </label>
              <NumberField
                label="Font size"
                value={clip.props.fontSize}
                min={1}
                max={300}
                disabled={locked}
                change={(value) =>
                  edit((c) =>
                    c.component === 'Text'
                      ? { ...c, props: { ...c.props, fontSize: value } }
                      : c,
                  )
                }
              />
            </>
          )}
          {clip.component === 'Text' ||
          clip.component === 'Shape' ||
          clip.component === 'Arrow' ||
          clip.component === 'Path' ? (
            <label className="field">
              <span>{clip.component === 'Shape' ? 'Fill' : 'Color'}</span>
              <input
                type="color"
                aria-label="Color"
                disabled={locked}
                value={
                  clip.component === 'Shape'
                    ? clip.props.fill
                    : clip.props.color
                }
                onChange={(e) =>
                  edit((c) =>
                    c.component === 'Shape'
                      ? { ...c, props: { ...c.props, fill: e.target.value } }
                      : c.component === 'Text'
                        ? { ...c, props: { ...c.props, color: e.target.value } }
                        : c.component === 'Arrow'
                          ? {
                              ...c,
                              props: { ...c.props, color: e.target.value },
                            }
                          : c.component === 'Path'
                            ? {
                                ...c,
                                props: { ...c.props, color: e.target.value },
                              }
                            : c,
                  )
                }
              />
            </label>
          ) : (
            <PropsInspector
              clip={clip}
              disabled={locked}
              apply={(next) => edit(() => next)}
            />
          )}

          {clip.component === 'Path' && (
            <StructuredPropsInspector
              clip={clip}
              disabled={locked}
              apply={(next) => edit(() => next)}
            />
          )}
          <SemanticMotionInspector
            clip={clip}
            disabled={locked}
            apply={(next) => edit(() => next)}
          />
          <h3>Timing</h3>
          <NumberField
            label="Start frame"
            value={clip.startFrame}
            min={0}
            max={projectDuration(project) - clip.durationFrames}
            disabled={locked}
            change={(value) =>
              edit((c) => ({ ...c, startFrame: Math.round(value) }))
            }
          />
          <NumberField
            label="Duration frames"
            value={clip.durationFrames}
            min={minimumClipDuration(clip)}
            max={projectDuration(project) - clip.startFrame}
            disabled={locked}
            change={(value) =>
              edit((c) => ({ ...c, durationFrames: Math.round(value) }))
            }
          />
          <h3>Animation</h3>
          <p className="hint">
            {clip.animations.length
              ? clip.animations.map((a) => a.property).join(' · ')
              : 'Static component'}
          </p>
          <p className="hint">
            Keyframes use clip-local frames. Animated properties override base
            values during preview.
          </p>
        </>
      ) : (
        <div className="empty-state">
          <span>↗</span>
          <h3>Make it yours</h3>
          <p>
            Select a component on the canvas or timeline to edit its properties.
          </p>
        </div>
      )}
    </aside>
  );
}
