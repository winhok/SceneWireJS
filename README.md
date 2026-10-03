# SceneWire

**Code first. Pixels last.**

## What it is

SceneWire is a structured video toolkit with a local editor and CLI. It combines editable native components, code-authored web compositions and immutable footage in one validated project document. An external coding agent can author and inspect that structure; SceneWire owns deterministic time, validation and rendering.

## Core concepts

VideoProject owns scenes, tracks, clips, assets and narration. FrameContext drives arbitrary seeks. Native domain components compile into primitives; web compositions retain their own code. Semantic patches provide reversible bounded edits.

## Install

```sh
npm install @scenewirejs/cli@1.0.1
npx scenewire engines
```

Install optional React, Pixi or Three dependencies in your project for those authoring engines. DOM authoring needs no optional graphics engine.

## Requirements

Node >=22.12.0. Source builds use pnpm 12.6.0. Browser rendering requires Chromium and FFmpeg/ffprobe on PATH. Install Chromium with `npx playwright install chromium` after installing Playwright, or set `SCENEWIRE_CHROMIUM_PATH` to an installed browser executable. Rendering never installs dependencies.

## Quick start

```sh
npx scenewire scaffold web-dom composition
```

Save the complete inline project in [Web compositions](docs/web-compositions.md) as `project.json`, then run:

```sh
npx scenewire inspect project.json
npx scenewire render-check project.json
npx scenewire render project.json --output video.mp4
```

## CLI

The CLI provides inspect/validate, semantic patching, scaffold/engines, capture/contact-sheet, preview/render, production planning and local media/reference inspection. Run `npx scenewire` for usage. Outputs use new paths to preserve source input.

## Authoring engines

Choose native structured components, DOM/CSS/SVG, React, Pixi or Three according to the scene. All time comes from FrameContext; randomness comes from the seeded initialization contract. See [engine authoring](docs/engine-authoring.md).

## Project model

VideoProject v9 is the canonical JSON format, independent of the editor. Code and binary assets remain separate files. See [project model](docs/project-ir.md) and [semantic editing](docs/patch-editing.md).

## Rendering/security

The browser provider isolates local compositions and restricts resource access. It supports trusted editable visual code with bounded execution; inspect generated code before rendering. Native Canvas and WebCodecs export remain available. See [rendering](docs/rendering.md) and [web compositions](docs/web-compositions.md).

## Packages

19 libraries cover schema/time/runtime, audio/compiler/media, rendering, editing, domains, direction, production and reference inspection. `@scenewirejs/cli` is the command-line package. See [API contract](docs/package-contract.json) and [source builds](docs/npm-distribution.md).

## Documentation

- [Architecture](docs/architecture.md)
- [Project model](docs/project-ir.md)
- [Rendering/security](docs/rendering.md)
- [Web compositions](docs/web-compositions.md)
- [Engine authoring](docs/engine-authoring.md)
- [Semantic editing](docs/patch-editing.md)
- [Packages and source builds](docs/npm-distribution.md)

Build this source with `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build` and `pnpm package:check`. `pnpm dev` starts the editor with an asset-free starter project. `pnpm package:smoke` validates a clean installed consumer.

## License

SceneWire project code and workflows are [MIT licensed](LICENSE). Dependencies and user-supplied assets retain their own licenses.
