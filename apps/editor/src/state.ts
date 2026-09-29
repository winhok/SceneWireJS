import { create } from 'zustand';
import { createProjectStore } from '@scenewirejs/editor-core';
import { projectSchema, CURRENT_PROJECT_VERSION } from '@scenewirejs/schema';
export const demoProject = projectSchema.parse({
  id: 'starter',
  version: CURRENT_PROJECT_VERSION,
  seed: 1,
  metadata: {
    title: 'SceneWire starter',
    createdAt: '2026-09-29T00:00:00Z',
    updatedAt: '2026-09-29T00:00:00Z',
  },
  canvas: { width: 1280, height: 720, background: '#101827' },
  fps: 30,
  theme: {
    name: 'dark-tech',
    fontFamily: 'sans-serif',
    foreground: '#ffffff',
    accent: '#53d5b0',
  },
  assets: [],
  scenes: [{ id: 'scene', name: 'Scene', startFrame: 0, durationFrames: 150 }],
  tracks: [
    {
      id: 'visual',
      name: 'Visual',
      type: 'visual',
      clips: [
        {
          id: 'title',
          component: 'Text',
          startFrame: 0,
          durationFrames: 150,
          transform: { x: 120, y: 260, width: 1040, height: 160 },
          props: { text: 'Code first. Pixels last.' },
        },
      ],
    },
  ],
  markers: [],
});
export const useProject = createProjectStore(demoProject);
export const useSelection = create<{
  selectedId?: string;
  select: (id?: string) => void;
}>((set) => ({ select: (selectedId) => set({ selectedId }) }));
export const usePlayback = create<{
  frame: number;
  playing: boolean;
  seek: (frame: number) => void;
  setPlaying: (playing: boolean) => void;
}>((set) => ({
  frame: 0,
  playing: false,
  seek: (frame) => set({ frame }),
  setPlaying: (playing) => set({ playing }),
}));
