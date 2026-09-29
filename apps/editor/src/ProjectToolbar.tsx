import { useRef, useState } from 'react';
import type { CompiledProject } from '@scenewirejs/runtime';
import { compileChoreography } from '@scenewirejs/compiler';
import { exportVideo } from '@scenewirejs/media';
import {
  StaticAssetResolver,
  IndexedDBAssetResolver,
} from '@scenewirejs/audio';
import { parseProject, serializeProject } from '@scenewirejs/schema';
import { componentRegistry } from './pack';
import { useProject, usePlayback, useSelection } from './state';
export function ProjectToolbar({
  compiled,
  resolutionError,
  onError,
}: {
  compiled: CompiledProject;
  resolutionError: string;
  onError: (error: string) => void;
}) {
  const { project, past, future, replace, undo, redo } = useProject();
  const { setPlaying, seek } = usePlayback();
  const file = useRef<HTMLInputElement>(null);
  const [exportProgress, setExportProgress] = useState<number>();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">
          S<span>W</span>
        </span>
        <div>
          SceneWire<small>Structured video, wired to voice.</small>
        </div>
      </div>
      <div className="project-title">
        {project.metadata.title}
        <span>LOCAL PROJECT</span>
      </div>
      <div className="toolbar">
        <button disabled={!past.length} onClick={undo}>
          Undo
        </button>
        <button disabled={!future.length} onClick={redo}>
          Redo
        </button>
        <button onClick={() => file.current?.click()}>Open JSON</button>
        <button
          disabled={exportProgress !== undefined || !!resolutionError}
          onClick={async () => {
            setPlaying(false);
            setExportProgress(0);
            onError('');
            const resolver = new IndexedDBAssetResolver(
              'scenewire-assets',
              new StaticAssetResolver(project.assets, window.location.href),
            );
            try {
              const { blob, report } = await exportVideo({
                compiled,
                resolver,
                onProgress: setExportProgress,
              });
              const url = URL.createObjectURL(blob),
                anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = `${project.id}.${report.container}`;
              anchor.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (cause) {
              onError(cause instanceof Error ? cause.message : 'Export failed');
            } finally {
              setExportProgress(undefined);
              await resolver.close();
            }
          }}
        >
          {exportProgress === undefined
            ? 'Export video'
            : `Exporting ${Math.round(exportProgress * 100)}%`}
        </button>
        <button
          className="primary"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([serializeProject(project)], {
                type: 'application/json',
              }),
            );
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `${project.id}.json`;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Save JSON ↗
        </button>
      </div>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Load project JSON"
        onChange={async (e) => {
          const chosen = e.target.files?.[0];
          if (!chosen) return;
          try {
            if (chosen.size > 5_000_000)
              throw new Error('Project file exceeds 5 MB');
            const loaded = parseProject(await chosen.text());
            compileChoreography({ project: loaded, componentRegistry });
            setPlaying(false);
            replace(loaded);
            seek(0);
            useSelection.getState().select(undefined);
            onError('');
          } catch (cause) {
            onError(cause instanceof Error ? cause.message : 'Invalid project');
          }
          e.target.value = '';
        }}
      />
    </header>
  );
}
