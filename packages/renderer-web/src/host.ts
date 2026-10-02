import type { SceneWireHostBridge } from './host-bridge';
import { MediaFrameResolver, type MediaRequest } from './media';
import {
  compileProject,
  evaluateAtFrame,
  createPrimitiveRegistry,
} from '@scenewirejs/runtime';
import { compileChoreography } from '@scenewirejs/compiler';
import { createDeveloperRegistry } from '@scenewirejs/domain-developer';
import { createEducationRegistry } from '@scenewirejs/domain-education';
import { createEditorialRegistry } from '@scenewirejs/domain-editorial';
import {
  createCanvasRenderer,
  drawCanvasOverlay,
} from '@scenewirejs/renderer-canvas';
import { isVisualTrack, type VideoProject } from '@scenewirejs/schema';
import type {
  FrameContext,
  ResolvedFrameDiagnostic,
} from '@scenewirejs/renderer-core';
const registry = [
  ...createPrimitiveRegistry(),
  ...createDeveloperRegistry(),
  ...createEducationRegistry(),
  ...createEditorialRegistry(),
];
export async function mountHost(
  project: VideoProject,
  mediaUrls: Record<string, string> = {},
) {
  const choreography = compileChoreography({
    project,
    narration: project.narration,
    componentRegistry: registry,
  });
  const compiled = compileProject(project, registry, choreography);
  const canvas = document.querySelector('canvas')!;
  const renderer = createCanvasRenderer(canvas);
  const subtitleCanvas =
    document.querySelector<HTMLCanvasElement>('.subtitle-layer');
  const subtitles = new Set([
    ...choreography.generatedSubtitles.map((clip) => clip.id),
    ...project.tracks
      .filter((track) => track.type === 'subtitle')
      .flatMap((track) => track.clips.map((clip) => clip.id)),
  ]);
  const media = new MediaFrameResolver();
  const surfaces = new Map(
    [...document.querySelectorAll<HTMLCanvasElement>('.video-layer')].map(
      (c) => [c.dataset.clip!, c],
    ),
  );
  let mediaReady = false;
  const mediaPrepared = media.prepare(project, mediaUrls).then(() => {
    mediaReady = true;
  });
  let counter = 0;
  const frames = [...document.querySelectorAll('iframe')];
  const ready = new Set<Window>();
  const validators = new Set<Window>();
  const pending = new Map<
    number,
    {
      source: Window;
      resolve(diagnostics: ResolvedFrameDiagnostic[]): void;
      reject(error: Error): void;
    }
  >();
  addEventListener('message', (event) => {
    if (!frames.some((frame) => frame.contentWindow === event.source)) return;
    if (event.data?.type === 'scenewire:ready') {
      ready.add(event.source as Window);
      if (event.data.frameDiagnostics === true)
        validators.add(event.source as Window);
    }
    if (
      event.data?.type === 'scenewire:seeked' ||
      event.data?.type === 'scenewire:disposed'
    ) {
      const request = pending.get(event.data.requestId);
      if (!request || request.source !== event.source) return;
      pending.delete(event.data.requestId);
      if (event.data.error) request.reject(new Error(event.data.error));
      else request.resolve(event.data.diagnostics ?? []);
    }
  });
  const clips = project.tracks
    .filter(isVisualTrack)
    .filter((track) => !track.muted)
    .flatMap((track) => track.clips)
    .filter((clip) => clip.component === 'ForeignComposition');
  const bridge: SceneWireHostBridge = {
    sceneWireReady: () => {
      frames
        .filter((frame) => !ready.has(frame.contentWindow!))
        .forEach((frame) =>
          frame.contentWindow!.postMessage({ type: 'scenewire:hello' }, '*'),
        );
      return (
        mediaReady && frames.every((frame) => ready.has(frame.contentWindow!))
      );
    },
    sceneWireFrameDiagnostics: () => validators.size > 0,
    sceneWireMediaMetrics: () => [...media.decodeMs],
    sceneWireMediaSequenceMetrics: () => ({
      sequentialSamples: media.sequentialSamples,
      randomSamples: media.randomSamples,
      maxRequestedBatchFrames: media.maxRequestedBatchFrames,
    }),
    sceneWireBeginMediaRange: async (
      range: { startFrame: number; endFrame: number } | null,
    ) => {
      await mediaPrepared;
      const requests: MediaRequest[] = [];
      if (range && surfaces.size) {
        for (let frame = range.startFrame; frame < range.endFrame; frame++)
          for (const element of evaluateAtFrame(compiled, frame).media ?? [])
            requests.push({
              clipId: element.id,
              assetId: element.assetId,
              frame,
              sourceTimeMs: element.sourceTimeMs,
            });
      }
      await media.beginRange(requests);
    },
    sceneWireDispose: async () => {
      await media.dispose();
      for (const surface of surfaces.values())
        surface.width = surface.height = 1;
      await Promise.all(
        frames.map((iframe) => {
          const requestId = ++counter;
          const promise = new Promise<ResolvedFrameDiagnostic[]>(
            (resolve, reject) =>
              pending.set(requestId, {
                source: iframe.contentWindow!,
                resolve,
                reject,
              }),
          );
          iframe.contentWindow!.postMessage(
            { type: 'scenewire:dispose', requestId },
            '*',
          );
          return promise;
        }),
      );
    },
    sceneWireSeek: async (context: FrameContext) => {
      const diagnostics: ResolvedFrameDiagnostic[] = [];
      const decodeBefore = media.totalDecodeMs;
      await mediaPrepared;
      let graph = evaluateAtFrame(compiled, context.frame);
      const activeMedia = graph.media ?? [];
      await media.draw(graph, surfaces);
      graph = { ...graph, media: [] };
      const active = clips.filter(
        (clip) =>
          context.frame >= clip.startFrame &&
          context.frame < clip.startFrame + clip.durationFrames,
      );
      const background =
        activeMedia.some((m) => m.placement !== 'foreground') ||
        active.some((clip) => clip.props.placement !== 'foreground');
      const replace =
        activeMedia.some((m) => m.placement === 'replace-scene') ||
        active.some((clip) => clip.props.placement === 'replace-scene');
      if (subtitleCanvas) {
        drawCanvasOverlay(subtitleCanvas, {
          ...graph,
          nodes: graph.nodes.filter((node) =>
            subtitles.has(node.ownerId ?? node.id),
          ),
        });
        graph = {
          ...graph,
          nodes: graph.nodes.filter(
            (node) => !subtitles.has(node.ownerId ?? node.id),
          ),
        };
      }
      if (replace) graph = { ...graph, nodes: [] };
      if (background) drawCanvasOverlay(canvas, graph);
      else renderer.render(graph);
      for (const iframe of frames) {
        const clip = clips.find((clip) => clip.id === iframe.dataset.clip)!;
        const visible = active.some((item) => item.id === clip.id);
        iframe.style.display = visible ? 'block' : 'none';
        if (!visible) continue;
        const requestId = ++counter;
        const promise = new Promise<ResolvedFrameDiagnostic[]>(
          (resolve, reject) =>
            pending.set(requestId, {
              source: iframe.contentWindow!,
              resolve,
              reject,
            }),
        );
        iframe.contentWindow!.postMessage(
          { type: 'scenewire:seek', requestId, context },
          '*',
        );
        try {
          diagnostics.push(...(await promise));
        } catch (error) {
          throw new Error(`${clip.props.assetId}: ${String(error)}`);
        }
      }
      const paintStart = performance.now();
      await document.fonts.ready;
      canvas.getBoundingClientRect();
      // Flush the trusted host's compositor without advancing the composition clock.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      return {
        diagnostics,
        mediaDecodeMs: media.totalDecodeMs - decodeBefore,
        paintFlushMs: performance.now() - paintStart,
      };
    },
  };
  Object.assign(window, bridge);
  await mediaPrepared;
}
