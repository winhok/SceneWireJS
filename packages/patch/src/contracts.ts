import { type PatchIssue } from './inspect';
import { type VideoProject } from '@scenewirejs/schema';
export interface PatchChange {
  targetId: string;
  label: string;
  path: string;
  before: unknown;
  after: unknown;
  operationIndex: number;
}
export interface FrameRange {
  startFrame: number;
  endFrame: number;
}
export interface PatchDryRunReport {
  valid: boolean;
  resolvedTargets: { operationIndex: number; targetIds: string[] }[];
  changes: PatchChange[];
  warnings: PatchIssue[];
  issues: PatchIssue[];
  affectedScenes: string[];
  affectedFrameRanges: FrameRange[];
  suggestedPreviewFrames: number[];
  resultingProject?: VideoProject;
}
export interface PatchResult {
  project: VideoProject;
  report: PatchDryRunReport;
  patchId: string;
}
