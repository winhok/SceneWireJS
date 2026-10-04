import { revealPath, screenToWorld, isDefaultCamera } from '@scenewirejs/runtime';
import type { RenderGraph, RenderNode, Renderer } from '@scenewirejs/runtime';
export interface CanvasSurface {
  width: number;
  height: number;
  getContext(
    contextId: '2d',
  ): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
}
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
function drawNode(ctx: Context, node: RenderNode, font: string): void {
  const t = node.transform;
  ctx.save();
  ctx.globalAlpha = t.opacity;
  if (node.effects?.blurPx) ctx.filter = `blur(${node.effects.blurPx}px)`;
  if (node.parent) {
    const p = node.parent;
    ctx.globalAlpha *= p.opacity;
    ctx.translate(p.x + p.width / 2, p.y + p.height / 2);
    ctx.rotate((p.rotation * Math.PI) / 180);
    ctx.scale(p.scaleX, p.scaleY);
    ctx.translate(-p.width / 2, -p.height / 2);
    ctx.beginPath();
    ctx.rect(0, 0, p.width, p.height);
    ctx.clip();
  }
  ctx.translate(t.x + t.width / 2, t.y + t.height / 2);
  ctx.rotate((t.rotation * Math.PI) / 180);
  ctx.scale(t.scaleX, t.scaleY);
  ctx.translate(-t.width / 2, -t.height / 2);
  switch (node.component) {
    case 'Text': {
      const p = node.props;
      if (!('text' in p)) break;
      ctx.fillStyle = p.color;
      ctx.font = `500 ${p.fontSize}px ${p.fontFamily === 'monospace' ? 'ui-monospace, Menlo, monospace' : font}`;
      ctx.textBaseline = 'top';
      ctx.textAlign = p.align;
      const x =
        p.align === 'center' ? t.width / 2 : p.align === 'right' ? t.width : 0;
      ctx.beginPath();
      ctx.rect(0, 0, t.width, t.height);
      ctx.clip();
      p.text
        .split('\n')
        .forEach((line, i) =>
          ctx.fillText(line, x, i * p.fontSize * 1.3, t.width),
        );
      break;
    }
    case 'Shape': {
      const p = node.props;
      if (!('fill' in p)) break;
      ctx.fillStyle = p.fill;
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(
        0,
        0,
        t.width,
        t.height,
        Math.min(p.radius, t.width / 2, t.height / 2),
      );
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'Path': {
      const p = node.props;
      if (!('points' in p)) break;
      const points = revealPath(
        p.points,
        t.width,
        t.height,
        node.progress,
        p.closed,
      );
      if (points.length < 2) break;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(points[0]!.x, points[0]!.y);
      for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
      break;
    }
    case 'Arrow': {
      const p = node.props;
      if (!('lineWidth' in p)) break;
      ctx.strokeStyle = p.color;
      ctx.fillStyle = p.color;
      ctx.lineWidth = p.lineWidth;
      ctx.lineCap = 'round';
      const x = t.width * node.progress;
      const y = t.height / 2;
      if (node.progress <= 0) break;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 12, y - 8);
      ctx.lineTo(x - 12, y + 8);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}
export function applyCameraTransform(
  ctx: Context,
  graph: Pick<RenderGraph, 'camera' | 'canvas'>,
): void {
  if (isDefaultCamera(graph.camera, graph.canvas)) return;
  ctx.translate(graph.canvas.width / 2, graph.canvas.height / 2);
  ctx.rotate((graph.camera.rotation * Math.PI) / 180);
  ctx.scale(graph.camera.zoom, graph.camera.zoom);
  ctx.translate(-graph.camera.x, -graph.camera.y);
}
export function createCanvasRenderer(surface: CanvasSurface): Renderer {
  const ctx = surface.getContext('2d');
  if (!ctx) throw new Error('Canvas2D unavailable');
  return {
    render(graph) {
      if (graph.media?.length)
        throw new Error('Video media requires the browser/Web render provider');
      if (surface.width !== graph.canvas.width)
        surface.width = graph.canvas.width;
      if (surface.height !== graph.canvas.height)
        surface.height = graph.canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = graph.canvas.background;
      ctx.fillRect(0, 0, surface.width, surface.height);
      ctx.save();
      applyCameraTransform(ctx, graph);
      for (const node of graph.nodes)
        drawNode(ctx, node, graph.theme.fontFamily);
      ctx.restore();
    },
  };
}
// Rotation and scale are inverted for picking; painter order determines the front-most hit.
export function hitTest(
  graph: RenderGraph,
  x: number,
  y: number,
): string | undefined {
  const world = screenToWorld({ x, y }, graph.camera, graph.canvas);
  x = world.x;
  y = world.y;
  for (const node of [...(graph.elements ?? graph.nodes)].reverse()) {
    const t = node.transform;
    if (t.opacity <= 0) continue;
    const dx = x - t.x - t.width / 2,
      dy = y - t.y - t.height / 2;
    const angle = (-t.rotation * Math.PI) / 180;
    const lx =
      (dx * Math.cos(angle) - dy * Math.sin(angle)) / t.scaleX + t.width / 2;
    const ly =
      (dx * Math.sin(angle) + dy * Math.cos(angle)) / t.scaleY + t.height / 2;
    if (lx >= 0 && lx <= t.width && ly >= 0 && ly <= t.height) return node.id;
  }
}

export const canvasCapabilities: import('@scenewirejs/renderer-core').RendererCapabilities =
  {
    dimensions: ['2d', '2.5d'],
    vector: true,
    dom: false,
    gpu: false,
    textLayout: 'basic',
    shaders: false,
    particles: false,
    filters: true,
    masks: false,
    arbitraryCode: false,
    deterministicSeek: true,
    transparentOutput: false,
    browserRequired: false,
  };
export function canvasRendererDefinition(
  surface: CanvasSurface,
  graphAt: (frame: number) => RenderGraph,
): import('@scenewirejs/renderer-core').RendererDefinition {
  return {
    id: 'canvas',
    capabilities: canvasCapabilities,
    async createSession() {
      const renderer = createCanvasRenderer(surface);
      return {
        async prepare() {},
        async renderFrame(context) {
          renderer.render(graphAt(context.frame));
          return {
            frame: context.frame,
            width: surface.width,
            height: surface.height,
            source: surface,
          };
        },
        async dispose() {},
      };
    },
  };
}
// Hybrid host only: the existing opaque render path above is unchanged.
export function drawCanvasOverlay(
  surface: CanvasSurface,
  graph: RenderGraph,
): void {
  const ctx = surface.getContext('2d');
  if (!ctx) throw new Error('Canvas2D unavailable');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, surface.width, surface.height);
  ctx.save();
  applyCameraTransform(ctx, graph);
  for (const node of graph.nodes) drawNode(ctx, node, graph.theme.fontFamily);
  ctx.restore();
}
