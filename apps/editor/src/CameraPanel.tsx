import { useState } from 'react';
import { projectSchema } from '@scenewirejs/schema';
import { useProject } from './state';
export function CameraPanel() {
  const project = useProject((s) => s.project);
  const signature = JSON.stringify(project.camera ?? {});
  return <CameraFields key={signature} />;
}
function CameraFields() {
  const project = useProject((s) => s.project),
    apply = useProject((s) => s.apply);
  const [draft, setDraft] = useState({
    x: project.camera?.x ?? project.canvas.width / 2,
    y: project.camera?.y ?? project.canvas.height / 2,
    zoom: project.camera?.zoom ?? 1,
    rotation: project.camera?.rotation ?? 0,
  });
  const [json, setJson] = useState(
    JSON.stringify(project.camera?.animations ?? [], null, 2),
  );
  const [error, setError] = useState('');
  return (
    <details>
      <summary>Camera</summary>
      <p className="hint">
        X/Y is the world point at canvas center. Rotation is in degrees.
        Keyframes use project frames.
      </p>
      {(['x', 'y', 'zoom', 'rotation'] as const).map((key) => (
        <label className="field" key={key}>
          <span>{key}</span>
          <input
            aria-label={`Camera ${key}`}
            type="number"
            step="any"
            value={draft[key]}
            onChange={(e) =>
              setDraft({ ...draft, [key]: e.target.valueAsNumber })
            }
          />
        </label>
      ))}
      <label className="field">
        <span>Keyframes JSON</span>
        <textarea
          aria-label="Camera keyframes JSON"
          value={json}
          onChange={(e) => setJson(e.target.value)}
        />
      </label>
      <button
        onClick={() => {
          try {
            const next = projectSchema.parse({
              ...project,
              version: 7,
              camera: { ...draft, animations: JSON.parse(json) as unknown },
            });
            apply(next);
            setError('');
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Invalid camera');
          }
        }}
      >
        Apply camera
      </button>
      <button
        onClick={() => {
          const { camera: _camera, ...rest } = project;
          void _camera;
          apply(projectSchema.parse({ ...rest, version: 7 }));
        }}
      >
        Reset camera
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </details>
  );
}
