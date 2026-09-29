import { useEffect, useRef } from 'react';
import { isAudioTrack, type VideoProject } from '@scenewirejs/schema';
import {
  AudioTransport,
  StaticAssetResolver,
  IndexedDBAssetResolver,
  WallClockTransport,
  type PlaybackTransport,
} from '@scenewirejs/audio';
import { usePlayback } from './state';
export function usePlaybackClock(
  project: VideoProject,
  duration: number,
  onError: (message: string) => void,
): void {
  const playing = usePlayback((s) => s.playing),
    error = useRef(onError);
  error.current = onError;
  const transport = useRef<PlaybackTransport | undefined>(undefined);
  useEffect(() => {
    const hasAudio = project.tracks
      .filter(isAudioTrack)
      .some((t) => !t.muted && t.clips.length);
    const resolver = hasAudio
      ? new IndexedDBAssetResolver(
          'scenewire-assets',
          new StaticAssetResolver(project.assets, window.location.href),
        )
      : undefined;
    const next = hasAudio
      ? new AudioTransport(project, resolver!)
      : new WallClockTransport();
    transport.current = next;
    return () => {
      next.pause();
      if (next instanceof AudioTransport) void next.dispose();
      if (resolver) void resolver.close();
      transport.current = undefined;
    };
  }, [project]);
  useEffect(() => {
    const clock = transport.current;
    if (!clock) return;
    if (!playing) {
      clock.pause();
      return;
    }
    let canceled = false,
      request = 0,
      last = usePlayback.getState().frame;
    const tick = () => {
      if (canceled) return;
      const state = usePlayback.getState();
      if (state.frame !== last) clock.seek((state.frame * 1000) / project.fps);
      const frame = Math.floor((clock.currentTimeMs() * project.fps) / 1000);
      last = Math.min(duration - 1, Math.max(0, frame));
      state.seek(last);
      if (frame >= duration) {
        state.setPlaying(false);
        return;
      }
      request = requestAnimationFrame(tick);
    };
    void clock
      .play((last * 1000) / project.fps)
      .then(() => {
        if (!canceled) request = requestAnimationFrame(tick);
      })
      .catch((cause) => {
        if (canceled) return;
        usePlayback.getState().setPlaying(false);
        error.current(
          cause instanceof Error ? cause.message : 'Audio playback failed',
        );
      });
    return () => {
      canceled = true;
      cancelAnimationFrame(request);
      clock.pause();
    };
  }, [playing, project, duration]);
}
