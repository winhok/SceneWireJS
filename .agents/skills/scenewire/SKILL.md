---
name: scenewire
description: Route SceneWire work to source creation, reference adaptation, existing footage, visual direction, project editing or review.
---

# SceneWire workflow router

Identify the actual request. A new source/prompt-to-video production uses [scenewire-create](../scenewire-create/SKILL.md). Visual planning and engine selection for known scenes use [scenewire-direct](../scenewire-direct/SKILL.md). Reference-video adaptation uses [scenewire-reference](../scenewire-reference/SKILL.md). Existing footage recuts/reframing/graphic augmentation use [scenewire-footage](../scenewire-footage/SKILL.md). Precise edits to an existing project use [scenewire-edit](../scenewire-edit/SKILL.md). Visual and media QA use [scenewire-review](../scenewire-review/SKILL.md). Load only the chosen workflow; use review after creation or editing when output quality needs inspection.

For first use, run `scenewire init --yes` in an empty directory, then `scenewire doctor`. Dependency installation requires explicit `--install`; when no package manager is determinable follow the printed command. `init --skills` copies only the seven shipped SceneWire skills. Use `engines --json` for machine parsing.
