import {
  type VideoProject,
  type AudioClip,
  type NarrationSegment,
} from '@scenewirejs/schema';
import { type ProductionBrief } from './../contracts/brief';
import { type NarrativePlan } from './../contracts/narrative';
import { type TTSProvider } from '@scenewirejs/audio';
import { type SpeechAlignmentProvider } from '@scenewirejs/audio';
import { synthesizeAligned } from '@scenewirejs/audio';
import { relativePathSchema } from './../contracts/common';
import { projectSchema } from '@scenewirejs/schema';
export async function buildProductionNarration(
  project: VideoProject,
  brief: ProductionBrief,
  narrative: NarrativePlan,
  provider: TTSProvider,
  options: {
    alignment?: SpeechAlignmentProvider;
    voice?: string;
    assetPath?: (sceneId: string) => string;
    sceneIds?: readonly string[];
  } = {},
) {
  if (brief.narration !== 'voiceover')
    throw new Error('Brief must request voiceover');
  const narrativeById = new Map(narrative.scenes.map((s) => [s.id, s]));
  const selected = options.sceneIds ?? narrative.scenes.map((s) => s.id);
  if (
    new Set(selected).size !== selected.length ||
    selected.some((id) => !narrativeById.has(id))
  )
    throw new Error(
      'Narration scene selection contains duplicate or unknown ID',
    );
  const next = structuredClone(project),
    outputs = [];
  const sceneById = new Map(next.scenes.map((s) => [s.id, s]));
  const selectedIds = new Set(selected);
  const audioIds = new Set(selected.map((id) => `audio-${id}`));
  const voiceIds = new Set(selected.map((id) => `voice-${id}`));
  next.assets = next.assets.filter((asset) => !audioIds.has(asset.id));
  const existing = next.tracks.find((t) => t.id === `voice-${brief.id}`);
  if (existing && existing.type !== 'voice')
    throw new Error('Narration track ID occupied');
  if (existing && existing.type === 'voice')
    existing.clips = existing.clips.filter((c) => !voiceIds.has(c.id));
  const clips: AudioClip[] = [];
  const segments: NarrationSegment[] = (next.narration?.segments ?? []).filter(
    (s) => !s.sceneId || !selectedIds.has(s.sceneId),
  );
  for (const scene of narrative.scenes.filter((s) => selectedIds.has(s.id))) {
    const target = sceneById.get(scene.id);
    if (!target || !scene.voiceover)
      throw new Error(`Missing narration scene ${scene.id}`);
    const result = await synthesizeAligned(
      provider,
      { text: scene.voiceover, voice: options.voice },
      options.alignment,
    );
    const durationFrames = Math.ceil(
      (result.durationMs * brief.canvas.fps) / 1000,
    );
    if (durationFrames > target.durationFrames)
      throw new Error(`Narration exceeds scene ${scene.id}`);
    const assetId = `audio-${scene.id}`,
      clipId = `voice-${scene.id}`,
      path = options.assetPath?.(scene.id) ?? `audio/${scene.id}.wav`;
    relativePathSchema.parse(path);
    next.assets.push({
      id: assetId,
      type: 'audio',
      src: path,
      durationMs: result.durationMs,
    });
    clips.push({
      id: clipId,
      assetId,
      startFrame: target.startFrame,
      durationFrames,
      sourceOffsetMs: 0,
      gain: 1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
    });
    segments.push({
      id: `narration-${scene.id}`,
      sceneId: scene.id,
      text: scene.voiceover,
      audioAssetId: assetId,
      audioClipId: clipId,
      startFrame: target.startFrame,
      durationFrames,
      words: result.words,
      ...(result.phrases ? { phrases: result.phrases } : {}),
      subtitleMode: 'phrase',
    });
    outputs.push({ sceneId: scene.id, path, ...result });
  }
  if (existing && existing.type === 'voice') existing.clips.push(...clips);
  else if (clips.length)
    next.tracks.push({
      id: `voice-${brief.id}`,
      name: 'Narration',
      type: 'voice',
      muted: false,
      locked: false,
      clips,
    });
  next.narration = {
    segments: segments.sort(
      (a, b) => (a.startFrame ?? 0) - (b.startFrame ?? 0),
    ),
  };
  return { project: projectSchema.parse(next), outputs };
}
