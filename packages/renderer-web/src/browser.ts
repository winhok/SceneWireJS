import type {
  WebComposition,
  CompositionInitContext,
} from '@scenewirejs/web-runtime';
import { seededRandom } from '@scenewirejs/web-runtime';
import type { FrameAdapter, FrameContext } from '@scenewirejs/renderer-core';
export async function mountComposition(
  composition: WebComposition,
  init: Omit<CompositionInitContext, 'registerAdapter' | 'ready' | 'random'>,
) {
  const adapters: FrameAdapter[] = [],
    pending: Promise<unknown>[] = [];
  let prepared = false;
  const root = document.getElementById('root')!;
  Math.random = () => {
    throw new Error('Use SceneWire seeded random');
  };
  await composition.mount(root, {
    ...init,
    parameters: Object.freeze({ ...init.parameters }),
    registerAdapter(adapter) {
      if (prepared) throw new Error('Register adapters during mount');
      adapters.push(adapter);
    },
    ready(promise) {
      if (prepared) throw new Error('Register readiness during mount');
      pending.push(promise);
    },
    random: (key, frame) =>
      seededRandom(init.seed, init.compositionId, key, frame),
  });
  await Promise.all(pending);
  for (const adapter of adapters) await adapter.prepare?.();
  prepared = true;
  async function ready() {
    await document.fonts.ready;
    if ([...document.fonts].some((font) => font.status === 'error'))
      throw new Error('Font load failed');
    await Promise.all(
      [...document.images].map(async (image) => {
        await image.decode();
        if (!image.naturalWidth)
          throw new Error(`Image failed: ${image.getAttribute('src')}`);
      }),
    );
  }
  await ready();
  let disposed = false;
  async function dispose() {
    if (disposed) return;
    disposed = true;
    await composition.dispose?.();
    for (const adapter of adapters) await adapter.dispose?.();
  }
  addEventListener('message', async (event) => {
    if (event.source !== parent) return;
    if (event.data?.type === 'scenewire:hello') {
      parent.postMessage({ type: 'scenewire:ready' }, '*');
      return;
    }
    if (event.data?.type === 'scenewire:dispose') {
      try {
        await dispose();
        parent.postMessage(
          { type: 'scenewire:disposed', requestId: event.data.requestId },
          '*',
        );
      } catch (error) {
        parent.postMessage(
          {
            type: 'scenewire:disposed',
            requestId: event.data.requestId,
            error: String(error),
          },
          '*',
        );
      }
      return;
    }
    if (event.data?.type !== 'scenewire:seek') return;
    const { requestId, context } = event.data as {
      requestId: number;
      context: FrameContext;
    };
    try {
      const frozen = Object.freeze({ ...context });
      (globalThis as unknown as { __sceneTime: number }).__sceneTime =
        context.timeMs;
      // Discard Chromium's retained paint/layer history before applying an
      // absolute frame. Restore layout synchronously before author code runs.
      const display = root.style.display;
      root.style.display = 'none';
      root.getBoundingClientRect();
      root.style.display = display;
      root.getBoundingClientRect();
      await composition.seek(frozen);
      for (const adapter of adapters) await adapter.seek(frozen);
      for (const animation of document.getAnimations()) {
        animation.pause();
        animation.currentTime = context.timeMs;
      }
      await ready();
      for (const adapter of adapters) await adapter.flush?.();
      root.getBoundingClientRect();
      parent.postMessage({ type: 'scenewire:seeked', requestId }, '*');
    } catch (error) {
      parent.postMessage(
        { type: 'scenewire:seeked', requestId, error: String(error) },
        '*',
      );
    }
  });
  addEventListener('pagehide', () => {
    void dispose();
  });
  parent.postMessage({ type: 'scenewire:ready' }, '*');
}
