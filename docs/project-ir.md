# Project model

VideoProject v9 is the canonical persisted format. `parseProject` validates current documents; `migrateProject` validates legacy documents before migrating them; `serializeProject` saves normalized JSON. The schema rejects unsupported fields and invalid references.

Root fields are id/version/metadata, canvas/fps/theme, assets, scenes, tracks and markers. Seed, narration and camera are optional. IDs are stable and globally unique. Scenes define project extent. Clips use absolute startFrame and integer durationFrames; animation keyframes use clip-local frames. Intervals are half-open. Narration word and phrase timings use milliseconds relative to audio placement.

Native primitives and domain clips retain typed props, transform, motion and semantic metadata. Structured layouts resolve geometry during compilation. Camera and clip effects are evaluated without rewriting persisted source. Audio clips reference separate binary assets and explicit offsets/gain/fades.

A ForeignComposition clip references a local composition manifest through an asset ID. Typed bounded parameters configure individual instances. Web code remains outside JSON. Video clips reference immutable footage with explicit source window, playback rate and crop; audio is a separate canonical track.

Read `packages/schema/src` for the exact contract. The [web composition document](web-compositions.md) contains a complete minimal project. See [patch editing](patch-editing.md) for reversible semantic edits.
