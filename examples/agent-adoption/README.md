# Three reproducible public-npm videos

Each example contains a complete VideoProject, editable composition source and an npm lockfile for public SceneWire CLI 1.3.0. No private workspace package or model API is required. Node >=22.12, FFmpeg/ffprobe and compatible Chromium are host prerequisites.

| Example | Source                             | Real rendered video                              | Intent                                                                                   |
| ------- | ---------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| DOM     | [Complete source](dom/README.md)   | [MP4](../../apps/website/public/demos/dom.mp4)   | 12-second Describe → Compose → Deliver information animation; independent Agent authored |
| React   | [Complete source](react/README.md) | [MP4](../../apps/website/public/demos/react.mp4) | 10-second component-state technical explanation                                          |
| Three   | [Complete source](three/README.md) | [MP4](../../apps/website/public/demos/three.mp4) | 8-second real geometry/material/camera visual study                                      |

From the repository root, copy each source to a new directory outside the checkout, install its exact public dependency graph and render/check actual video:

```sh
node examples/agent-adoption/replay.mjs dom ../dom-replay
node examples/agent-adoption/replay.mjs react ../react-replay
node examples/agent-adoption/replay.mjs three ../three-replay
```

The helper refuses existing destinations. It runs `npm ci`, the installed Playwright browser installer, `doctor`, representative/boundary `render-check`, actual `render`, `final-media-qc`, counted `ffprobe`, full `ffmpeg -xerror` decode and actual frame capture/contact sheet. Every command and failure is retained in the new directory's `checks/`. Each example README also provides the direct commands without the helper.

[Public demo media records](../../apps/website/public/demos/manifest.json) bind the real MP4 bytes, media metadata and source/QC evidence. Website source downloads include the complete example folder. The DOM example retains its independent Agent's original typed sources alongside an explicitly recorded portable JavaScript copy; it was not a parent-authored substitute.

These videos are intentionally silent. Actual sampled frames and full media decoding do not establish continuous human playback, aesthetic superiority or formal qualification. Creative Qualification remains **NO_GO**; Formal Holdout remains **NOT_CONSUMED**.
