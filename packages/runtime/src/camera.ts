import type { VideoProject } from '@scenewirejs/schema';
import { interpolate } from './interpolation';
export interface ResolvedCameraState {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly rotation: number;
}
export interface Point {
  x: number;
  y: number;
}
type Canvas = VideoProject['canvas'];
export function resolveCamera(
  project: VideoProject,
  frame: number,
): ResolvedCameraState {
  const authored = project.camera;
  const state = {
    x: authored?.x ?? project.canvas.width / 2,
    y: authored?.y ?? project.canvas.height / 2,
    zoom: authored?.zoom ?? 1,
    rotation: authored?.rotation ?? 0,
  };
  for (const track of authored?.animations ?? [])
    state[track.property] = interpolate(track, frame);
  return state;
}
export function isDefaultCamera(
  camera: ResolvedCameraState,
  canvas: Canvas,
): boolean {
  return (
    camera.x === canvas.width / 2 &&
    camera.y === canvas.height / 2 &&
    camera.zoom === 1 &&
    camera.rotation === 0
  );
}
export function worldToScreen(
  point: Point,
  camera: ResolvedCameraState,
  canvas: Canvas,
): Point {
  const a = (camera.rotation * Math.PI) / 180,
    dx = point.x - camera.x,
    dy = point.y - camera.y;
  return {
    x: canvas.width / 2 + camera.zoom * (dx * Math.cos(a) - dy * Math.sin(a)),
    y: canvas.height / 2 + camera.zoom * (dx * Math.sin(a) + dy * Math.cos(a)),
  };
}
export function screenToWorld(
  point: Point,
  camera: ResolvedCameraState,
  canvas: Canvas,
): Point {
  const a = (-camera.rotation * Math.PI) / 180,
    dx = (point.x - canvas.width / 2) / camera.zoom,
    dy = (point.y - canvas.height / 2) / camera.zoom;
  return {
    x: camera.x + dx * Math.cos(a) - dy * Math.sin(a),
    y: camera.y + dx * Math.sin(a) + dy * Math.cos(a),
  };
}
