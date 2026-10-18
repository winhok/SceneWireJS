# SceneWire public website source

React 19 + Vite + TypeScript with `/SceneWireJS/` as the production base. The incumbent paper/ink visual system and keyboard/mobile/reduced-motion behavior remain. No backend or UI dependency was added.

```sh
pnpm --dir apps/website build
pnpm --dir apps/website test
pnpm --dir apps/website test:browser
```

The real-video gallery reads `public/demos/manifest.json`, serves three actual MP4s and posters, and links complete editable-source ZIPs. The DOM example was independently authored with public npm and shipped Skills; React/Three are scoped sprint examples. All videos have media/QC and source digests. They are intentionally silent. Full decoding and sampled-frame checks do not establish continuous human playback or Creative Qualification.

The A/B/C production interaction remains explicitly illustrative; its schema-valid fixture is not a live renderer result. `src/demo.test.ts` retains canonical schema assertions. Quick Start now generates a complete VideoProject with `init --yes --skills`; a parity test keeps README/onboarding/website commands aligned. The browser test verifies actual video metadata/play progress and ZIP downloads on desktop and mobile, in addition to existing production interaction, keyboard, navigation and reduced-motion checks.

Changes are prepared locally for one-way Public source export and corresponding CI. No deployment or metadata mutation is included. Creative Qualification remains NO_GO; Formal Holdout remains NOT_CONSUMED.
