import type { FrameAdapter, FrameContext } from '@scenewirejs/renderer-core';
// Structural contracts avoid bundling a visual library into every composition.
export function createPixiFrameAdapter<S>(options: {
  app: {
    ticker: { stop(): void };
    stage: S;
    renderer: { render(stage: S): void };
  };
  update(context: FrameContext): void | Promise<void>;
  refreshMedia?(): void | Promise<void>;
  dispose?(): void | Promise<void>;
}): FrameAdapter {
  const render = () => options.app.renderer.render(options.app.stage);
  options.app.ticker.stop();
  return {
    prepare() {
      options.app.ticker.stop();
    },
    async seek(context) {
      options.app.ticker.stop();
      await options.update(context);
      render();
    },
    async flush() {
      await options.refreshMedia?.();
      render();
    },
    dispose: options.dispose,
  };
}
export function createThreeFrameAdapter<S, C>(options: {
  renderer: {
    setAnimationLoop(callback: null): void;
    render(scene: S, camera: C): void;
  };
  scene: S;
  camera: C;
  update(context: FrameContext): void | Promise<void>;
  validateFrame?: FrameAdapter['validateFrame'];
  mixers?: readonly { setTime(seconds: number): unknown }[];
  libraryRandom?: (key: string) => number;
  refreshMedia?(): void | Promise<void>;
  dispose?(): void | Promise<void>;
}): FrameAdapter {
  const render = () =>
    options.libraryRandom
      ? withSeededLibraryRandom(options.libraryRandom, 'three-render', () =>
          options.renderer.render(options.scene, options.camera),
        )
      : options.renderer.render(options.scene, options.camera);
  options.renderer.setAnimationLoop(null);
  return {
    prepare() {
      options.renderer.setAnimationLoop(null);
    },
    async seek(context) {
      options.renderer.setAnimationLoop(null);
      for (const mixer of options.mixers ?? [])
        mixer.setTime(context.timeSeconds);
      await options.update(context);
      render();
    },
    async flush() {
      await options.refreshMedia?.();
      render();
    },
    validateFrame: options.validateFrame,
    dispose: options.dispose,
  };
}
/** Synchronous library bookkeeping (e.g. UUIDs), backed by keyed SceneWire random.
 * Never wrap async work or visual updates; those use init.random directly. */
export function withSeededLibraryRandom<T>(
  random: (key: string) => number,
  namespace: string,
  action: () => T,
): T {
  const previous = Math.random;
  let index = 0;
  Math.random = () => random(`${namespace}:${index++}`);
  try {
    return action();
  } finally {
    Math.random = previous;
  }
}
