# Packages and source builds

Node >=22.12.0 and pnpm 12.8.1 are required to build this source distribution. The workspace contains 19 publishable libraries, a publishable CLI and a private editor app. All published packages use ESM with declarations and explicit relative import extensions.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm lint
pnpm format:check
pnpm package:check
pnpm package:pack
pnpm package:smoke
```

Package checks compare entrypoints against [the API contract](package-contract.json). Packing checks bounded tarball contents and workspace dependency conversion. Package smoke creates a separate npm consumer, imports all 19 libraries, compiles declarations, executes the CLI and performs frame render-checks on newly scaffolded DOM/React/Pixi/Three compositions. It also exercises the installed VideoBench API, strict evidence revalidation, identity and resource limits, conservative aggregation, receipt rejection and a real DOM renderer-to-CLI capture with MP4 output. These frame checks do not themselves export four MP4s. The v1.3.0 release qualification separately validated actual DOM/React/Pixi/Three MP4 containers, dimensions, frame rates, frame counts and full decoding. Per-case VideoBench results are printed and retained in `.build/npm/acceptance.json`. Generated output goes under `.build/`; it is excluded from source control.

Browser operations require Chromium (Playwright-managed or SCENEWIRE_CHROMIUM_PATH), FFmpeg and ffprobe. Install optional authoring dependencies in the consuming project when using those engines. Smoke validation covers source distribution coherence and minimal installed-product behavior.

The published stable release is v1.3.0 **VideoBench Bounded Engineering Toolkit**; install it with `npm install @scenewirejs/cli@1.3.0`. Its immutable package source and v1.3.0 tag identify `630d9bab59a6d08bb105a8b84960a4c1e6e3dfa4`. Later documentation/site commits do not change or republish those tarballs. A local build or pack does not publish any package. See [the release](https://github.com/winhok/SceneWireJS/releases/tag/v1.3.0) and [the engineering guide](videobench-engineering.md).

After building this source, inspect the local CLI with:

```sh
node apps/cli/dist/scenewire.js videobench --help
node apps/cli/dist/scenewire.js videobench identify identify.json --json
node apps/cli/dist/scenewire.js videobench capture capture.json --output evidence --json
```

The help describes request inputs and available engineering commands. `identify` binds an existing local project and render output; `capture` validates the requested identity before materializing frame, sheet and strip evidence into a new directory. Supply authored inputs and your own licensed assets. The installed consumer fixture in `scripts/videobench-installed.mjs` provides an owned synthetic example.

VideoBench evidence and deterministic diagnostics do not establish creative superiority. **Creative Qualification remains NO_GO and Formal Holdout remains NOT_CONSUMED.** Synthetic receipt and authority rejection tests do not authenticate independent reviewers. A qualification artifact is not Owner approval; formal exposure requires separately trusted host authority, a verified freeze and the consume-once ledger. This release does not claim universal aesthetic scoring, an authenticated creative evaluation or a proved unique cause of historical capture stalls.
