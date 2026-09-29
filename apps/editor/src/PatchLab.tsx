import { useState } from 'react';
import {
  dryRunPatchPlan,
  applyPatchPlan,
  type PatchDryRunReport,
} from '@scenewirejs/patch';
import type { VideoProject } from '@scenewirejs/schema';
import { componentRegistry } from './pack';
import { usePlayback, useProject } from './state';
export interface PatchPreview {
  base: VideoProject;
  project: VideoProject;
}
export function PatchLab({
  onPreview,
  previewing,
}: {
  onPreview: (value?: PatchPreview) => void;
  previewing: boolean;
}) {
  const project = useProject((s) => s.project);
  const [text, setText] = useState(
    '{\n  "version": 1,\n  "id": "edit-1",\n  "operations": []\n}',
  );
  const [state, setState] = useState<{
    base: VideoProject;
    text: string;
    report: PatchDryRunReport;
  }>();
  const [error, setError] = useState('');
  const fresh = state?.base === project && state.text === text;
  const report = fresh ? state.report : undefined;
  const valid = !!report?.valid;
  const clear = () => {
    onPreview(undefined);
    setState(undefined);
    setError('');
  };
  return (
    <section className="patch-lab" aria-label="Patch Lab">
      <h2>Patch Lab</h2>
      <p>SceneWirePatch v1 · inspect the diff, preview, then commit.</p>
      <label className="field">
        <span>PatchPlan JSON</span>
        <textarea
          aria-label="PatchPlan JSON"
          rows={9}
          value={text}
          onChange={(e) => {
            clear();
            setText(e.target.value);
          }}
        />
      </label>
      <div className="patch-actions">
        <button
          onClick={() => {
            onPreview(undefined);
            setError('');
            setState(undefined);
            try {
              const raw: unknown = JSON.parse(text);
              setState({
                base: project,
                text,
                report: dryRunPatchPlan(project, raw, componentRegistry),
              });
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Invalid JSON');
            }
          }}
        >
          Dry Run
        </button>
        <button
          disabled={!valid}
          onClick={() => {
            usePlayback.getState().setPlaying(false);
            onPreview({ base: project, project: report!.resultingProject! });
            usePlayback.getState().seek(report!.suggestedPreviewFrames[0] ?? 0);
          }}
        >
          Preview patch
        </button>
        <button
          disabled={!valid}
          onClick={() => {
            try {
              const result = applyPatchPlan(
                project,
                JSON.parse(text),
                componentRegistry,
              );
              usePlayback.getState().setPlaying(false);
              useProject.getState().apply(result.project);
              clear();
            } catch (e) {
              onPreview(undefined);
              setError(e instanceof Error ? e.message : 'Patch failed');
            }
          }}
        >
          Commit patch
        </button>
        <button onClick={clear}>Cancel patch</button>
        {previewing && (
          <button onClick={() => onPreview(undefined)}>
            Return to original
          </button>
        )}
      </div>
      {state && !fresh && (
        <p role="status">Project changed. Run Dry Run again.</p>
      )}
      {previewing && (
        <p role="status">
          Patch preview · original project and history unchanged
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {report && (
        <div className="patch-report" aria-label="Patch report">
          <strong>{report.valid ? 'Valid patch' : 'Invalid patch'}</strong>
          <ul aria-label="Semantic diff">
            {report.changes.map((change, index) => (
              <li key={index}>
                <strong>{change.label}</strong> · {change.path}
                <br />
                <code>{JSON.stringify(change.before)}</code> →{' '}
                <code>{JSON.stringify(change.after)}</code>
              </li>
            ))}
          </ul>
          <pre>
            {JSON.stringify(
              {
                resolvedTargets: report.resolvedTargets,
                warnings: report.warnings,
                issues: report.issues,
                affectedScenes: report.affectedScenes,
                affectedFrameRanges: report.affectedFrameRanges,
                suggestedPreviewFrames: report.suggestedPreviewFrames,
              },
              null,
              2,
            )}
          </pre>
          {report.suggestedPreviewFrames.map((f) => (
            <button key={f} onClick={() => usePlayback.getState().seek(f)}>
              Frame {f}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
