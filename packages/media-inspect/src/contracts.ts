import { type MediaProbe } from '@scenewirejs/reference-core';
import { type RunOptions } from './process';
export interface LocalMedia {
  path: string;
  probe: MediaProbe;
}
export interface InspectOptions extends RunOptions {
  maxDurationSeconds?: number;
  motionFps?: number;
  threshold?: number;
  maxFrames?: number;
  maxShots?: number;
}
