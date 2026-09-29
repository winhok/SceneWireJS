import { useState } from 'react';
import { StructuredPropsInspector } from './StructuredPropsInspector';
import { clipSchema, type Clip } from '@scenewirejs/schema';
export function DeveloperInspector({
  clip,
  disabled,
  apply,
}: {
  clip: Clip;
  disabled: boolean;
  apply: (next: Clip) => void;
}) {
  const [error, setError] = useState('');
  const edit = (patch: Record<string, unknown>) => {
    const candidate = clipSchema.safeParse({
      ...clip,
      props: { ...clip.props, ...patch },
    });
    if (candidate.success) {
      apply(candidate.data);
      setError('');
    } else setError(candidate.error.issues.map((i) => i.message).join('; '));
  };
  const diagram =
    clip.component === 'FlowDiagram' ||
    clip.component === 'ArchitectureDiagram' ||
    clip.component === 'RAGPipeline' ||
    clip.component === 'AgentGraph'
      ? clip.props
      : undefined;
  return (
    <>
      {clip.component === 'CodeWindow' && (
        <>
          <label className="field">
            <span>Filename</span>
            <input
              aria-label="Filename"
              value={clip.props.filename}
              disabled={disabled}
              onChange={(e) => {
                if (e.target.value) edit({ filename: e.target.value });
              }}
            />
          </label>
          <label className="field">
            <span>Language</span>
            <select
              aria-label="Language"
              value={clip.props.language}
              disabled={disabled}
              onChange={(e) => edit({ language: e.target.value })}
            >
              {[
                'typescript',
                'javascript',
                'json',
                'python',
                'bash',
                'text',
              ].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Code</span>
            <textarea
              aria-label="Code"
              value={clip.props.code}
              disabled={disabled}
              onChange={(e) =>
                edit({
                  code: e.target.value,
                  highlightedLines: [],
                  focusRegion: undefined,
                })
              }
            />
          </label>
        </>
      )}
      {diagram && (
        <>
          <label className="field">
            <span>Direction</span>
            <select
              aria-label="Direction"
              value={diagram.direction}
              disabled={disabled}
              onChange={(e) => edit({ direction: e.target.value })}
            >
              <option value="horizontal">Horizontal</option>
              <option value="vertical">Vertical</option>
            </select>
          </label>
          <label className="field">
            <span>Active node</span>
            <select
              aria-label="Active node"
              value={diagram.activeNodeId ?? ''}
              disabled={disabled}
              onChange={(e) =>
                edit({ activeNodeId: e.target.value || undefined })
              }
            >
              <option value="">None</option>
              {diagram.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Active edge</span>
            <select
              aria-label="Active edge"
              value={diagram.activeEdgeId ?? ''}
              disabled={disabled}
              onChange={(e) =>
                edit({ activeEdgeId: e.target.value || undefined })
              }
            >
              <option value="">None</option>
              {diagram.edges.map((edge) => (
                <option key={edge.id} value={edge.id}>
                  {edge.from} → {edge.to}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <StructuredPropsInspector clip={clip} disabled={disabled} apply={apply} />
      {error && <p role="alert">{error}</p>}
      <p className="hint">
        Props are validated before entering project state. Edit nodes, edges,
        line highlights or reveal settings here.
      </p>
    </>
  );
}
