import { type ProjectShape } from './schema';
import { type Clip } from './../clips/domain';
import { type AudioClip } from './../track';
import { isVisualTrack } from './../track';
export function buildProjectIndex(project: ProjectShape) {
  const assetById = new Map(project.assets.map((a) => [a.id, a]));
  const sceneById = new Map(project.scenes.map((s) => [s.id, s]));
  const clipById = new Map<string, Clip>();
  const audioClipById = new Map<string, AudioClip>();
  const voiceClipIds = new Set<string>();
  const allClipIds = new Set<string>();
  for (const track of project.tracks) {
    if (isVisualTrack(track)) {
      for (const clip of track.clips) {
        allClipIds.add(clip.id);
        clipById.set(clip.id, clip);
      }
    } else {
      for (const clip of track.clips) {
        allClipIds.add(clip.id);
        audioClipById.set(clip.id, clip);
        if (track.type === 'voice') voiceClipIds.add(clip.id);
      }
    }
  }
  return {
    assetById,
    sceneById,
    clipById,
    audioClipById,
    voiceClipIds,
    allClipIds,
  };
}
