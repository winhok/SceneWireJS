export * from './adapters';
import type { FrameAdapter, FrameContext } from '@scenewirejs/renderer-core';
export type { FrameAdapter, FrameContext } from '@scenewirejs/renderer-core';
export interface CompositionInitContext {
  compositionId: string;
  width: number;
  height: number;
  fps: number;
  seed: number;
  parameters: Readonly<Record<string, string | number | boolean>>;
  direction?: Readonly<Record<string, unknown>>;
  registerAdapter(adapter: FrameAdapter): void;
  ready(promise: Promise<unknown>): void;
  random(key: string, frame?: number): number;
}
export interface WebComposition {
  mount(
    root: HTMLElement,
    context: CompositionInitContext,
  ): void | Promise<void>;
  seek(context: FrameContext): void | Promise<void>;
  dispose?(): void | Promise<void>;
}
export function seededRandom(
  seed: number,
  compositionId: string,
  key: string,
  frame = 0,
): number {
  let hash = (seed ^ 2166136261) >>> 0;
  for (const char of `${compositionId}:${key}:${frame}`)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  return (hash >>> 0) / 4294967296;
}
// React users can subscribe once through useSyncExternalStore; seek updates do not remount.
export function createFrameStore(initial: FrameContext) {
  let context = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => context,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    seek(next: FrameContext) {
      context = next;
      listeners.forEach((listener) => listener());
    },
  };
}
