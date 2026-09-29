import type { RendererCapabilities } from '@scenewirejs/renderer-core';
import type { WebRenderOptions } from './contracts';
import { WebRendererSession } from './session/session';
export const webCapabilities: RendererCapabilities = {
  videoMedia: true,
  dimensions: ['2d', '2.5d', '3d'],
  vector: true,
  dom: true,
  gpu: true,
  textLayout: 'advanced',
  shaders: true,
  particles: true,
  filters: true,
  masks: true,
  arbitraryCode: true,
  deterministicSeek: true,
  transparentOutput: false,
  browserRequired: true,
};
export function webRendererDefinition(options: WebRenderOptions) {
  return {
    id: 'web',
    capabilities: webCapabilities,
    async createSession() {
      return new WebRendererSession(options);
    },
  };
}
