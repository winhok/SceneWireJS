# Web compositions

VideoProject v9 owns time, scenes, assets, semantic metadata and audio. Use native components first when they express the idea; use Web for unfamiliar layouts and visual behavior. No embedded model or generative service is required.

## Local authoring

A composition asset references a project-relative manifest:

```json
{
  "id": "hero-code",
  "type": "composition",
  "rendererId": "web",
  "src": "compositions/hero/composition.json"
}
```

```json
{
  "schemaVersion": 1,
  "renderer": "web",
  "entry": "./src/index.tsx",
  "transparent": true,
  "permissions": { "network": false }
}
```

Use one `ForeignComposition` visual clip with props `assetId` and `placement`. It must lie within one scene. Placements are full-stage `background`, `foreground` or `replace-scene`; arbitrary z interleaving, camera transforms and motion/effects on foreign clips are rejected. Native subtitles occupy a controlled top Canvas layer. Muted tracks do not execute code.

Default-export a `WebComposition`: `mount(root, init)` once, `seek(FrameContext)` at arbitrary frames, optional `dispose()`. Plain JS/TS/DOM/CSS/SVG and React work equally. `init.registerAdapter` adds prepare/seek/flush/dispose adapters; `init.ready` declares additional readiness promises during mount. Fonts and image decoding are awaited before capture. Import assets in code/CSS so Vite resolves them, or use composition-local relative asset URLs. No source symlinks, parent traversal or executable remote references.

Use context frame/time/progress/dimensions/seed, and `init.random(key, optionalFrame)` for deterministic randomness. For React, mount once with createRoot, subscribe with `createFrameStore`/useSyncExternalStore and use flushSync to publish frame updates before seek returns. CSS properties or direct styles are preferred; discovered CSS/WAAPI animations are paused and scrubbed to project time.

Avoid Math.random, Date.now, performance.now and wall-clock timers in author source. The sandbox exposes deterministic Date/performance values and rejects timers/rAF/unseeded randomness during mount/seek. React's internal module-initialization key receives a fixed random value before author mount; this is not an author randomness API. A browser sandbox is not a general hostile-code VM; Code Model output is editable trusted/generated visual code, and render-check is required.

## Minimal npm project

Run `npx scenewire scaffold web-dom composition`, then save this complete document as `project.json`. It is self-contained:

```json
{
  "id": "demo",
  "version": 9,
  "seed": 1,
  "metadata": {
    "title": "Demo",
    "createdAt": "2026-09-29T00:00:00Z",
    "updatedAt": "2026-09-29T00:00:00Z"
  },
  "canvas": {
    "width": 320,
    "height": 180,
    "background": "#101827"
  },
  "fps": 30,
  "theme": {
    "name": "demo",
    "fontFamily": "sans-serif",
    "foreground": "#ffffff",
    "accent": "#53d5b0"
  },
  "assets": [
    {
      "id": "code",
      "type": "composition",
      "rendererId": "web",
      "src": "composition/composition.json"
    }
  ],
  "scenes": [
    {
      "id": "scene",
      "name": "Demo",
      "startFrame": 0,
      "durationFrames": 60
    }
  ],
  "tracks": [
    {
      "id": "visual",
      "name": "Demo",
      "type": "visual",
      "clips": [
        {
          "id": "clip",
          "component": "ForeignComposition",
          "startFrame": 0,
          "durationFrames": 60,
          "transform": {},
          "props": {
            "assetId": "code",
            "placement": "replace-scene"
          }
        }
      ]
    }
  ],
  "markers": []
}
```

## Headless workflow

Install @scenewirejs/cli and the browser prerequisites described in the README. Run from your consuming project; rendering never installs packages.

```sh
npx scenewire inspect project.json
npx scenewire capture project.json --frame 120 --output frame.png
npx scenewire contact-sheet project.json --frames 0,30,120,300,359 --output sheet.svg
npx scenewire render-check project.json --frames 0,30,120,300,120,30
npx scenewire preview project.json --output preview.html
npx scenewire render project.json --output video.mp4
```

Run from your consuming project directory; API callers may supply workspaceRoot as the authoring dependency root. Installed runtime assets resolve relative to the package itself. Chromium and FFmpeg are local prerequisites. `SCENEWIRE_CHROMIUM_PATH` selects an installed executable. Outputs use exclusive creation. Contact sheets are portable SVGs with embedded PNGs. Preview HTML is a minimal debug artifact with sandbox iframes and canonical frame slider; source code remains in the project directory. Editor Canvas preview explicitly reports foreign layers; native export rejects them with the browser-provider command instead of silently omitting them.

## Execution and evidence

Bundle once, launch once, mount once, seek/capture many frames, dispose once. The bounded workflow cache keys composition-local source/assets, manifest, engine, shipped runtime and resolved dependency identities. Instance parameters/dimensions/seed remain session data. No package-manager lockfile or SceneWire checkout is required. Imports are restricted to the composition tree, resolved npm dependencies and public SceneWire clock/runtime APIs. Other local source imports are rejected. Future dependencies are a development operation.

Fresh browser contexts have no inherited cookies/storage. Composition iframes omit allow-same-origin and cannot access host DOM, filesystem or Node. CSP blocks connect/worker/child-frame activity. Request interception exposes only the corresponding local composition resources; unexpected network/missing resources are errors. Chromium's process sandbox is enabled. CSS captures use software compositing to avoid GPU cache-dependent rasterization. Cross-platform GPU rasterization is not guaranteed.

Prepare/seek/capture have bounded timeouts (30s/5s/5s defaults). SIGINT/SIGTERM cancel CLI work; exports have a 10-minute default total timeout. API AbortSignal, progress callback and timeout overrides are available. Infinite loops are bounded by host watchdog and browser shutdown. Chromium OS memory limits are not configured; peak memory reports null. Non-cooperative dispose hooks cannot block process cleanup.

render-check reports same-frame and fresh-session comparisons: channel delta <= 1/255 and changed pixels <= 0.01% in the same environment. Larger differences fail, including stateful animation. Pixel comparisons and hashes are retained; cross-platform/font equality is not claimed. Performance includes build/prepare, mean/p50/p95 seek+capture and total workflow time.

Browser MP4 export streams PNGs with encoder backpressure into FFmpeg, then applies canonical audio gain/offset/placement and minimum crossing-fade envelope. Muted audio tracks are omitted, mix normalization is disabled and silence is padded to exact timeline duration. H.264 uses yuv420p for even dimensions, yuv444p for odd dimensions. Native WebCodecs/Mediabunny export is retained. Video and temporary encoder files are cleaned on failure; a final local file appears only after successful encoding.

Errors are JSON diagnostics with renderer, composition ID, frame, phase and message. Pure inspection exposes composition references without trying to patch arbitrary implementation source. Freeform edits remain ordinary code diffs; SceneWirePatch retains its structured protocol.
