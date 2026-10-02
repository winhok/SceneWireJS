# Packages and source builds

Node >=22.12.0 and pnpm 12.6.0 are required to build this source distribution. The workspace contains 19 publishable libraries, a publishable CLI and a private editor app. All published packages use ESM with declarations and explicit relative import extensions.

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

Package checks compare entrypoints against [the API contract](package-contract.json). Packing checks bounded tarball contents and workspace dependency conversion. Package smoke creates a separate npm consumer, imports all 19 libraries, compiles declarations, executes the CLI and renders newly scaffolded DOM/React/Pixi/Three compositions. Generated output goes under `.build/`; it is excluded from source control.

Browser operations require Chromium (Playwright-managed or SCENEWIRE_CHROMIUM_PATH), FFmpeg and ffprobe. Install optional authoring dependencies in the consuming project when using those engines. Smoke validation covers source distribution coherence and minimal installed-product behavior.

The stable release identity is 1.0.0. Install the CLI with `npm install @scenewirejs/cli@1.0.0`. Package metadata points to the public source repository. A local build or pack does not publish any package.
