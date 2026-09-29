import { demoProject, usePlayback, useProject, useSelection } from './state';
export function DemoButtons() {
  const { setPlaying, seek } = usePlayback(),
    { replace } = useProject();
  return (
    <button
      className="demo-button"
      onClick={() => {
        setPlaying(false);
        replace(demoProject);
        seek(0);
        useSelection.getState().select(undefined);
      }}
    >
      ↻ Open starter project
    </button>
  );
}
