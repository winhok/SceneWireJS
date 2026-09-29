# First project

Node 22.12 or newer, FFmpeg/ffprobe and compatible Chromium are render prerequisites. Install the CLI, then create an empty project:

```sh
npm install @scenewirejs/cli@next
mkdir my-video
cd my-video
npx scenewire init --yes
npx scenewire doctor
npx scenewire engines
npx scenewire render-check project.json
npx scenewire render project.json --output video.mp4
```

`init [directory]` defaults to web-dom because it needs no optional graphics library. It generates a validated project and deterministic FrameContext composition. It refuses non-empty destinations, traversal and consumer-controlled symlink parents. It never installs dependencies silently. Follow its printed install command for direct authoring imports. Optional engines use `--engine web-react`, `web-pixi` or `web-three`; structured is also supported.

`--install` explicitly requests dependency installation using actual packageManager or unambiguous lock-file facts. If these are absent or ambiguous it prints an install command and returns a nonzero status, preserving the project. `--yes` is supported for agents and scripts; init already uses stable defaults without prompts. `--json` selects structured output for init, doctor and engines. Engines' runtime availability is separate from authoring completeness: generated source must directly resolve its declared imports, including web-runtime.

`doctor` checks version, Node, package manager, FFmpeg, ffprobe, configured or Playwright-managed Chromium, dependencies and project validity. It does not launch a GPU probe. Missing optional engines are informative; the selected project engine's authoring dependencies must be complete before authoring.

`init --skills` copies the seven shipped SceneWire skills to `.agents/skills/` without network access. No generic third-party skills are included. Specialist guidance loads progressively.

On audio mux failure, the error includes sanitized FFmpeg telemetry and a retained silent picture location. Audio progress uses FFmpeg output time; the configurable internal inactivity bound defaults to five minutes without advancing output time. Picture rendering has its existing independent timeout. A successful picture can be muxed again internally using the retained file; historical audio hang root cause remains unconfirmed.

Generated optional-engine dependencies use profile-declared compatibility ranges. SceneWire-owned imports bind the installed CLI version. Commit the consumer lockfile to reproduce exact resolved versions; a compatibility range is not an immutable dependency lock. `engines` labels runtime availability and authoring completeness separately.
