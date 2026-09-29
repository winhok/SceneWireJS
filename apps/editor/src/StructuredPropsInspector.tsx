import { useEffect, useState } from 'react';
import { clipSchema, type Clip } from '@scenewirejs/schema';
export function StructuredPropsInspector({
  clip,
  disabled,
  apply,
}: {
  clip: Clip;
  disabled: boolean;
  apply: (next: Clip) => void;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(JSON.stringify(clip.props, null, 2));
    setError('');
  }, [clip]);
  return (
    <>
      <label className="field">
        <span>Structured props</span>
        <textarea
          className="props-editor"
          aria-label="Component props JSON"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      <button
        disabled={disabled}
        onClick={() => {
          try {
            const candidate = clipSchema.parse({
              ...clip,
              props: JSON.parse(draft) as unknown,
            });
            apply(candidate);
            setError('');
          } catch (cause) {
            setError(
              cause instanceof Error ? cause.message : 'Invalid properties',
            );
          }
        }}
      >
        Apply props
      </button>
      {error && (
        <p className="props-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
