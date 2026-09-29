import type { CaptureBackendId } from './capture';
import type { VideoProject } from '@scenewirejs/schema';
export interface RenderDiagnostic {
  retainedPicture?: string;
  encoder?: import('./export/encoder').EncoderDiagnostic;
  worker?: number;
  chunk?: string;
  engine?: string;
  renderer: string;
  composition: string;
  frame: number | null;
  phase: string;
  error: string;
}
export class RenderError extends Error {
  constructor(readonly diagnostic: RenderDiagnostic) {
    super(diagnostic.error);
  }
}
export interface WebRenderOptions {
  mediaDecodeMode?: 'random-seek' | 'sequential-export';
  captureBackend?: CaptureBackendId;
  optimizeForSpeed?: boolean;
  captureBeyondViewport?: boolean;
  project: VideoProject;
  projectRoot: string;
  workspaceRoot?: string;
  executablePath?: string;
  signal?: AbortSignal;
  prepareTimeoutMs?: number;
  seekTimeoutMs?: number;
  captureTimeoutMs?: number;
  profile?: 'preview' | 'deterministic-export';
}
export interface CompositionBuild {
  engine: string;
  bundleMs: number;
  compositionId: string;
  sourceHash: string;
  bundleHash: string;
  instanceHash?: string;
}
