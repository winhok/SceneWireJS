# SceneWire

**Motion Engineering for Coding Agents.**

SceneWire v1.3.0 is released as the **VideoBench Bounded Engineering Toolkit**: production-output evidence capture, deterministic diagnostics, blinded review packets and conservative aggregation. It retains v1.2's verified local incremental production. See [the release](https://github.com/winhok/SceneWireJS/releases/tag/v1.3.0), [VideoBench engineering tools](docs/videobench-engineering.md) and [the production contract](docs/incremental-production.md).

Creative Qualification remains **NO_GO**; Formal Holdout remains **NOT_CONSUMED**. Engineering evidence does not establish automatic aesthetic improvement or universal quality scoring.

## What it is

SceneWire is a structured video toolkit with a local editor and CLI. It combines editable native components, code-authored web compositions and immutable footage in one validated project document. An external coding agent can author and inspect that structure; SceneWire owns deterministic time, validation and rendering.

## Core concepts

VideoProject owns scenes, tracks, clips, assets and narration. FrameContext drives arbitrary seeks. Native domain components compile into primitives; web compositions retain their own code. Semantic patches provide reversible bounded edits.

## First video

Node >=22.12 and FFmpeg/ffprobe are required. Run from a parent directory where `my-video` does not exist:

```sh
npm exec --yes --package=@scenewirejs/cli@1.3.0 -- scenewire init my-video --yes --skills
cd my-video
npm install --save-exact @scenewirejs/cli@1.3.0
npx --no-install playwright install chromium
npx --no-install scenewire doctor
npx --no-install scenewire render-check project.json
npx --no-install scenewire render project.json --output video.mp4
npx --no-install scenewire final-media-qc video.mp4
```

`init --yes --skills` creates a complete editable VideoProject and installs the seven SceneWire Skills. The dependency and Chromium installations are explicit. The starter renders without manually assembling JSON. Give your coding agent a natural-language brief and start with `.agents/skills/scenewire/SKILL.md`; see [onboarding](docs/onboarding.md) for prerequisites, optional engines and failure recovery.

## Reproduce a real example

[DOM information animation, React technical explainer and Three visual study](examples/agent-adoption/README.md) include complete editable source, public npm lockfiles, commands and actual rendered MP4s. Source and media checks travel together. The [website](https://winhok.github.io/SceneWireJS/) distinguishes real rendered examples from its interactive production illustration.

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
- [VideoBench engineering tools and qualification limits](docs/videobench-engineering.md)
- [Packages and source builds](docs/npm-distribution.md)

Build this source with `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build` and `pnpm package:check`. `pnpm dev` starts the editor with an asset-free starter project. `pnpm package:smoke` validates a clean installed consumer.

## License

SceneWire project code and workflows are [MIT licensed](LICENSE). Dependencies and user-supplied assets retain their own licenses.

See [third-party software notices](THIRD_PARTY_NOTICES.md) for dependency licenses and distribution notices.
