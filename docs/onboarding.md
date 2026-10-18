# First video with the published CLI

Use Node >=22.12, FFmpeg/ffprobe on PATH, and a parent directory in which `my-video` does not already exist. The first command downloads the pinned public CLI and creates a **complete VideoProject**, editable DOM composition and all seven shipped SceneWire Skills. No hand-built project JSON is needed.

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

The installer and browser download are explicit. `npm install` installs the generated authoring dependencies as well as the pinned CLI; the resulting `package-lock.json` locks the resolved graph. `npx --no-install playwright` uses the Playwright installed with this project's renderer, avoiding an unrelated newly downloaded version. On a supported Linux host, Chromium may also need OS libraries: use `npx --no-install playwright install --with-deps chromium` with the appropriate administrator approval. If downloads are unavailable, set `SCENEWIRE_CHROMIUM_PATH` to a compatible browser executable and rerun `doctor`.

The generated starter is a two-second editable video. To make your own, give your coding agent the installed `.agents/skills/scenewire/SKILL.md` router and a natural-language brief. For example:

> Create a 12-second, 1280×720, 30 fps DOM information animation about Describe → Compose → Deliver. Use three readable four-second sections and frame-driven motion. No narration or music. Deliver the editable source, MP4, media checks and a list of any failures or interventions.

SceneWire renders the agent's authored code; this command sequence is not a built-in prompt-to-video model. Start with the router and progressively load `scenewire-create` or `scenewire-direct`, then `scenewire-review`. All seven shipped workflows are installed: `scenewire`, `scenewire-create`, `scenewire-direct`, `scenewire-edit`, `scenewire-review`, `scenewire-reference`, and `scenewire-footage`. Editing, reference and footage workflows apply when those inputs are present. No paid provider call is needed for the intentionally silent examples.

`init --yes --skills` must be selected **when creating the project**. Version 1.3.0 refuses a non-empty destination; a later `init --skills` does not augment an existing project. Keep an existing project's files intact and initialize a new empty directory if needed. Optional starters are `--engine web-react`, `--engine web-pixi`, `--engine web-three`, or `--engine structured`. Install the dependencies printed by init before authoring. Default DOM requires no optional graphics library.

See [three complete reproducible examples](../examples/agent-adoption/README.md) for DOM, React and Three source and commands. Each includes an npm lockfile and links to its actual rendered demo. Media decoding, frame samples and continuous playback are separate checks. `final-media-qc` plus a full `ffmpeg -v error -i video.mp4 -f null -` decode checks media; it does not establish creative quality.

Creative Qualification remains **NO_GO**; Formal Holdout remains **NOT_CONSUMED**. These are engineering examples, not aesthetic qualification or a formal evaluator run.

## Diagnostics and execution controls

`doctor` checks version, Node, package manager, FFmpeg, ffprobe, configured or Playwright-managed Chromium, dependencies and project validity. It does not launch a GPU probe. Missing optional engines are informative; the selected project engine's authoring dependencies must be complete before authoring.

`init --skills` copies the seven shipped SceneWire skills to `.agents/skills/` without network access. No generic third-party skills are included. Specialist guidance loads progressively.

On audio mux failure, the error includes sanitized FFmpeg telemetry and a retained silent picture location. Audio progress uses FFmpeg output time; the configurable internal inactivity bound defaults to five minutes without advancing output time. Picture rendering has its existing independent timeout. A successful picture can be muxed again internally using the retained file; historical audio hang root cause remains unconfirmed.

Generated optional-engine dependencies use profile-declared compatibility ranges. SceneWire-owned imports bind the installed CLI version. Commit the consumer lockfile to reproduce exact resolved versions; a compatibility range is not an immutable dependency lock. `engines` labels runtime availability and authoring completeness separately.

## Execution controls and authoring compatibility

`render-check`, `render`, `capture` and `contact-sheet` accept `--prepare-timeout-ms`, `--seek-timeout-ms` and `--capture-timeout-ms`. `preview` accepts only `--prepare-timeout-ms`, because generating the portable artifact prepares resources without a frame capture. `render` also accepts `--render-timeout-ms` and `--audio-stall-timeout-ms`. Each must be a positive integer no greater than 3,600,000; duplicate or inapplicable flags reject. Defaults are unchanged. These are execution options, never VideoProject fields. `render-check --frames` requires a nonempty comma-separated list of in-range integer frames.

`doctor --json` and `engines --json` include authoring dependency diagnostics: `missing` (not directly declared), `unresolvable` (declared but installed metadata cannot resolve), `incompatible` (installed version does not satisfy the engine range), or `complete`. No dependency is automatically installed by these commands.

All Node media paths honor `SCENEWIRE_FFMPEG_PATH` and `SCENEWIRE_FFPROBE_PATH` before PATH. A configured missing or empty executable fails with remediation and never silently falls back. Doctor reports whether discovery used `configured` or `PATH`.

The media-inspect root no longer exposes process ownership primitives. The `internal/process` subpath is reserved for SceneWire implementation and carries no stable consumer compatibility promise. Media inspection, encoder/mux and picture validation share its process-tree cancellation implementation. Use inspection APIs from the root for application code.
