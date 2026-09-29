import { useEffect, useRef, useState } from 'react';
import {
  evaluateAtFrame,
  screenToWorld,
  type CompiledProject,
} from '@scenewirejs/runtime';
import {
  createCanvasRenderer,
  hitTest,
  applyCameraTransform,
} from '@scenewirejs/renderer-canvas';
import { updateClip } from '@scenewirejs/editor-core';
import { usePlayback, useProject, useSelection } from './state';
interface Drag {
  id: string;
  pointer: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
}
export function Preview({
  compiled,
  readOnly = false,
}: {
  compiled: CompiledProject;
  readOnly?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = usePlayback((s) => s.frame);
  const selectedId = useSelection((s) => s.selectedId);
  const [drag, setDrag] = useState<Drag>();
  const dragRef = useRef<Drag | undefined>(undefined);
  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    const evaluated = evaluateAtFrame(compiled, frame);
    const original = dragRef.current;
    const graph =
      drag && original
        ? {
            ...evaluated,
            elements: evaluated.elements?.map((e) =>
              e.id === drag.id
                ? {
                    ...e,
                    transform: {
                      ...e.transform,
                      x: e.transform.x + drag.startX - original.startX,
                      y: e.transform.y + drag.startY - original.startY,
                    },
                  }
                : e,
            ),
            nodes: evaluated.nodes.map((n) =>
              (n.ownerId ?? n.id) === drag.id
                ? {
                    ...n,
                    ...(n.parent
                      ? {
                          parent: {
                            ...n.parent,
                            x: n.parent.x + drag.startX - original.startX,
                            y: n.parent.y + drag.startY - original.startY,
                          },
                        }
                      : {
                          transform: {
                            ...n.transform,
                            x: n.transform.x + drag.startX - original.startX,
                            y: n.transform.y + drag.startY - original.startY,
                          },
                        }),
                  }
                : n,
            ),
          }
        : evaluated;
    createCanvasRenderer(surface).render(graph);
    const node = (graph.elements ?? graph.nodes).find(
      (n) => n.id === selectedId,
    );
    if (!node) return;
    const ctx = surface.getContext('2d');
    if (!ctx) return;
    const t = node.transform;
    ctx.save();
    applyCameraTransform(ctx, graph);
    ctx.translate(t.x + t.width / 2, t.y + t.height / 2);
    ctx.rotate((t.rotation * Math.PI) / 180);
    ctx.scale(t.scaleX, t.scaleY);
    ctx.strokeStyle = '#53d5b0';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.strokeRect(
      -t.width / 2 - 5,
      -t.height / 2 - 5,
      t.width + 10,
      t.height + 10,
    );
    ctx.restore();
  }, [compiled, frame, selectedId, drag]);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x:
        ((event.clientX - rect.left) * compiled.project.canvas.width) /
        rect.width,
      y:
        ((event.clientY - rect.top) * compiled.project.canvas.height) /
        rect.height,
    };
  };
  const worldPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const graph = evaluateAtFrame(compiled, frame);
    return screenToWorld(point(event), graph.camera, graph.canvas);
  };
  return (
    <section className="preview-panel">
      <div className="panel-heading">
        <span>COMPOSITION</span>
        <span>
          {compiled.project.canvas.width} × {compiled.project.canvas.height} ·{' '}
          {compiled.project.fps} FPS
        </span>
      </div>
      <div className="canvas-wrap">
        <canvas
          ref={canvas}
          aria-label="Video preview"
          width={1280}
          height={720}
          onPointerDown={(event) => {
            if (readOnly) return;
            const p = point(event);
            const id = hitTest(evaluateAtFrame(compiled, frame), p.x, p.y);
            useSelection.getState().select(id);
            if (
              !id ||
              compiled.project.tracks.some(
                (t) => t.locked && t.clips.some((c) => c.id === id),
              )
            )
              return;
            const clip = compiled.clips.find((c) => c.id === id);
            if (!clip) return;
            usePlayback.getState().setPlaying(false);
            event.currentTarget.setPointerCapture(event.pointerId);
            const next = {
              id,
              pointer: event.pointerId,
              x: worldPoint(event).x,
              y: worldPoint(event).y,
              startX: clip.transform.x,
              startY: clip.transform.y,
            };
            dragRef.current = next;
            setDrag(next);
          }}
          onPointerMove={(event) => {
            const current = dragRef.current;
            if (!current) return;
            const p = worldPoint(event);
            setDrag({
              ...current,
              startX: Math.round(current.startX + p.x - current.x),
              startY: Math.round(current.startY + p.y - current.y),
            });
          }}
          onPointerUp={(event) => {
            const current = dragRef.current;
            if (!current) return;
            const p = worldPoint(event);
            const state = useProject.getState();
            if (Math.hypot(p.x - current.x, p.y - current.y) >= 1)
              state.apply(
                updateClip(state.project, current.id, (c) => ({
                  ...c,
                  transform: {
                    ...c.transform,
                    x: Math.round(current.startX + p.x - current.x),
                    y: Math.round(current.startY + p.y - current.y),
                  },
                })),
              );
            dragRef.current = undefined;
            setDrag(undefined);
          }}
          onPointerCancel={() => {
            dragRef.current = undefined;
            setDrag(undefined);
          }}
        />
      </div>
      <div className="preview-footer">
        <span>
          {drag
            ? `Move to ${drag.startX}, ${drag.startY} · release to apply`
            : 'Select on canvas or timeline · drag to reposition'}
        </span>
        <span>
          {compiled.clips.some(
            (clip) => clip.component === 'ForeignComposition',
          )
            ? 'Hybrid project · use scenewire preview for Web layers'
            : 'Canvas 2D'}
        </span>
      </div>
    </section>
  );
}
