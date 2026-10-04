---
name: scenewire-edit
description: Inspect or edit an existing SceneWire project using typed semantic patches, dry-run reports and reversible editor preview. Does not generate complete videos.
---

# SceneWire editing

Build the JSON CLI with `pnpm --filter @scenewirejs/cli build`; invoke `node apps/cli/dist/scenewire.js` from the repository root. No model call, remote write or paid service is part of this workflow.

1. `inspect <project.json>` gives compact scenes/tracks/component/semantic inventory. Use `inspect-scene <project.json> <scene-id>` or `inspect-clip <project.json> <clip-id>` for details and references.
2. Create the smallest SceneWirePatch v1 plan. Read `packages/patch/src/schema.ts` for the exact contract and the relevant `examples/patches/*.json` for a working example.
3. Run `patch <project.json> <patch.json> --dry-run`. Inspect `valid`, `resolvedTargets`, `changes`, `issues`, `warnings`, affected ranges and suggested preview frames. Fix errors before applying; never interpret an agent's statement as validation.
4. Write a new project with `patch <project.json> <patch.json> --output <new.json>` or paste the plan into editor Patch Lab. Preview is ephemeral; Commit uses normal Undo/Redo. A changed project/plan requires a fresh dry run. Do not overwrite the source JSON.
5. Verify a few suggested frames, plus the relevant compile/export behavior. Report exactly what changed and what remains unverified.

Semantic selectors match logical clips only, conjunctively. Default `match: one` rejects ambiguity; use explicit `many` only for intended multi-clip edits. Nested nodes such as Retriever are inspected within their owning clip and edited through narration cues/phrase mappings. Destructive edits require an explicit clip ID and fail for references; no cascade. Registry defaults create/add/replace components. Replace preserves timing, transform and semantics by default, not motion.

Timing is integer frames; 0.5 seconds at 30 fps is 15 frames. Narration timings are milliseconds relative to audio placement: edit source intent, not generated subtitle clips. Camera keyframes override static values; edit animations when adjusting an animated scene. `set-theme` uses preset tokens without rewriting clip props. Text edits do not regenerate speech. Pure validation cannot fetch asset bytes; verify them in preview/export.

Persisted format is VideoProject v9; Video props use update-clip and output timing uses retime-clip; SceneWirePatch v1 is independent. Do not add arbitrary code, CSS selectors, HTML/JSX, MCP, new domain packs or full generation for a precise-edit request.
