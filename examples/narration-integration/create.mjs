// Supplied WAV + supplied external timings; no model/provider invocation.
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import {
  projectSchema,
  serializeProject,
  CURRENT_PROJECT_VERSION,
  mediaPlayableFrames,
} from '@scenewirejs/schema';
const [wav, timingFile, output] = process.argv.slice(2);
if (!wav || !timingFile || !output)
  throw Error('Usage: node create.mjs speech.wav timing.json new-directory');
const timing = JSON.parse(await readFile(timingFile, 'utf8'));
if (
  !['external-supplied', 'real-alignment', 'synthetic-fixture'].includes(
    timing.provenance,
  )
)
  throw Error('Declare timing provenance');
const { stdout } = await promisify(execFile)('ffprobe', [
  '-v',
  'error',
  '-show_entries',
  'format=duration',
  '-of',
  'json',
  wav,
]);
const durationMs = Number(JSON.parse(stdout).format.duration) * 1000;
const fps = 30,
  durationFrames = mediaPlayableFrames(durationMs, 0, 1, fps, true),
  date = new Date().toISOString();
const base = {
  id: 'narration-demo',
  version: CURRENT_PROJECT_VERSION,
  metadata: {
    title: 'Supplied narration timing',
    createdAt: date,
    updatedAt: date,
  },
  canvas: { width: 1280, height: 720, background: '#101827' },
  fps,
  theme: {
    name: 'demo',
    fontFamily: 'sans-serif',
    foreground: '#ffffff',
    accent: '#53d5b0',
  },
  assets: [
    { id: 'speech-asset', type: 'audio', src: 'speech.wav', durationMs },
  ],
  scenes: [{ id: 'scene', name: 'Narration', startFrame: 0, durationFrames }],
  tracks: [
    {
      id: 'visual',
      type: 'visual',
      name: 'Visual',
      clips: [
        {
          id: 'headline',
          component: 'Text',
          startFrame: 0,
          durationFrames,
          transform: { x: 100, y: 150, width: 1000, height: 120 },
          props: { text: timing.text, fontSize: 48 },
          semantic: { role: 'headline' },
        },
      ],
    },
    {
      id: 'voice',
      type: 'voice',
      name: 'Voice',
      clips: [
        {
          id: 'speech',
          assetId: 'speech-asset',
          startFrame: 0,
          durationFrames,
        },
      ],
    },
  ],
  markers: [],
  narration: {
    segments: [
      {
        id: 'narration',
        sceneId: 'scene',
        text: timing.text,
        audioAssetId: 'speech-asset',
        audioClipId: 'speech',
        startFrame: 0,
        durationFrames,
        words: timing.words,
        phrases: timing.phrases,
        phraseMappings: [
          {
            phrase: timing.phrases[0].text,
            target: { kind: 'clip', clipId: 'headline' },
            action: 'show',
          },
        ],
        cues: [
          {
            id: 'emphasis',
            source: 'manual',
            action: 'hide',
            target: { kind: 'clip', clipId: 'headline' },
            // A cue owns a project frame; the exact audio endpoint is exclusive.
            atMs: Math.min(
              timing.phrases[0].endMs,
              ((durationFrames - 1) * 1000) / fps,
            ),
          },
        ],
      },
    ],
  },
};
const projects = ['phrase', 'active-word'].map((mode) => {
  const p = structuredClone(base);
  p.narration.segments[0].subtitleMode = mode;
  return [mode, projectSchema.parse(p)];
});
await mkdir(output);
await copyFile(wav, join(output, 'speech.wav'));
for (const [mode, project] of projects)
  await writeFile(join(output, `${mode}.json`), serializeProject(project), {
    flag: 'wx',
  });
await writeFile(
  join(output, 'timing-provenance.json'),
  JSON.stringify(
    {
      provenance: timing.provenance,
      durationSource: 'actual ffprobe output',
      durationMs,
      words: timing.words,
      phrases: timing.phrases,
    },
    null,
    2,
  ),
);
console.log(
  'Created phrase.json and active-word.json. Render each using scenewire render <file> --output <new.mp4>.',
);
