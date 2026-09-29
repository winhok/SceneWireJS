# Semantic editing

SceneWirePatch v1 is separate from VideoProject. It applies bounded semantic operations to a cloned project and validates the resulting schema and compilation. Ambiguous selectors and invalid references fail without partially changing the source.

```sh
scenewire inspect project.json
scenewire inspect-scene project.json scene
scenewire inspect-clip project.json clip
scenewire patch project.json patch.json --dry-run
scenewire patch project.json patch.json --output edited.json
```

Author `patch.json` using the exact operation contract in `packages/patch/src/schema.ts`. Inspect resolvedTargets, changes, issues, warnings and suggested frames before applying. Default selectors match one logical clip; explicit many is required for intended multi-clip changes. Destructive edits use explicit IDs and reject dangling references.

Narration source intent owns generated choreography. Text edits do not regenerate audio. Composition parameters use typed parameter operations; freeform source remains an ordinary code edit. Pure validation cannot fetch asset bytes: inspect/render the resulting project before using the output.

The editor Patch Lab previews an ephemeral candidate and commits through normal Undo/Redo. The [editing skill](../.agents/skills/scenewire-edit/SKILL.md) describes the complete local workflow.
