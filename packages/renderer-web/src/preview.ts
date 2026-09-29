import { writeFile } from 'node:fs/promises';
import { frameContext } from '@scenewirejs/renderer-core';
import { WebRendererSession, type WebRenderOptions } from './index';
const escapeAttribute = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;');
const script = (code: string) =>
  `<script src="data:text/javascript;base64,${Buffer.from(code).toString('base64')}"></script>`;
// One portable engineering preview. It contains compiled execution code; editable sources stay in the project.
export async function writeDebugPreview(
  options: WebRenderOptions,
  output: string,
) {
  const session = new WebRendererSession(options);
  try {
    await session.prepare();
    const resources = await session.previewResources();
    const origin = session.resourceOrigin;
    const inlineAssets = (code: string) => {
      for (const [path, bytes] of resources)
        if (!/\.(js|html|css)$/.test(path)) {
          const type = path.startsWith('/media/')
            ? path.endsWith('.webm')
              ? 'video/webm'
              : 'video/mp4'
            : path.endsWith('.svg')
              ? 'image/svg+xml'
              : path.endsWith('.woff2')
                ? 'font/woff2'
                : path.endsWith('.woff')
                  ? 'font/woff'
                  : 'image/png';
          const uri = `data:${type};base64,${bytes.toString('base64')}`;
          code = code
            .replaceAll(origin + path, uri)
            .replaceAll('"/' + path.split('/').at(-1) + '"', '"' + uri + '"')
            .replaceAll("'/" + path.split('/').at(-1) + "'", "'" + uri + "'");
        }
      return code;
    };
    const inlineDocument = (html: string) =>
      html
        .replace(
          /<meta http-equiv="Content-Security-Policy"[^>]*>/,
          `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src data:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src data:; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'">`,
        )
        .replace(
          /<link rel="stylesheet" href="([^"]+)"\s*>/g,
          (_, url: string) =>
            `<style>${inlineAssets(resources.get(url.replace(origin, ''))!.toString()).replaceAll('</style', '<\\/style')}</style>`,
        )
        .replace(/<script src="([^"]+)"><\/script>/g, (_, url: string) =>
          script(
            inlineAssets(resources.get(url.replace(origin, ''))!.toString()),
          ),
        );
    let host = resources.get('/index.html')!.toString();
    host = host.replace(
      /src="(\/composition\/[^\"]+\/index.html)"/g,
      (_, path: string) =>
        `srcdoc="${escapeAttribute(inlineDocument(resources.get(path)!.toString()))}"`,
    );
    host = inlineDocument(host);
    // The host permits its sandbox frames; each child keeps frame-src none and an opaque origin.
    host = host.replace("frame-src 'none'", "frame-src 'self' data: blob:");
    const { project } = options,
      total = Math.max(
        ...project.scenes.map((s) => s.startFrame + s.durationFrames),
      );
    const state = {
      frame: 0,
      fps: project.fps,
      durationFrames: total,
      width: project.canvas.width,
      height: project.canvas.height,
      seed: project.seed ?? 0,
    };
    const controls = `<div style="position:fixed;bottom:0;left:0;right:0;background:#111;color:#eee;padding:12px;font:14px system-ui;z-index:10;display:flex;gap:12px"><label>Canonical frame <input id="frame" type="range" min="0" max="${total - 1}" value="0" style="width:400px"></label><output id="value">0</output><span id="error"></span></div>`;
    const controller = script(
      `const contextAt=${frameContext.toString()};const state=${JSON.stringify(state)};let pending=0,busy=false;async function seek(){if(busy)return;busy=true;try{while(pending!==null){const frame=pending;pending=null;document.getElementById('value').textContent=frame;await window.sceneWireSeek(contextAt({...state,frame}));}}catch(e){document.getElementById('error').textContent=String(e);}finally{busy=false;}}document.getElementById('frame').oninput=e=>{pending=Number(e.target.value);seek();};function ready(){if(window.sceneWireReady()){seek();}else requestAnimationFrame(ready)}ready();`,
    );
    await writeFile(
      output,
      host.replace(
        /<\/body><\/html>$/,
        () => controls + controller + '</body></html>',
      ),
      { flag: 'wx' },
    );
    return { output, kind: 'sandbox-debug-preview', frames: total };
  } finally {
    await session.dispose();
  }
}
