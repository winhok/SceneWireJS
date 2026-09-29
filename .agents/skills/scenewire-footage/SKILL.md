---
name: scenewire-footage
description: Edit existing footage, turn a recording into a short, add graphics to a talking head, reframe a video or make a clip from a recording through canonical SceneWire media clips.
---

# Existing footage workflow

Treat the local MP4 as immutable external footage. Inspect only media bytes and optional supplied transcripts, not the source project/code that generated it. Owner supplies source, intent and duration/aspect; agent decides source windows, crop and code graphics.

1. `scenewire media probe <file>` then filmstrip/shots/waveform; inspect representative images and optional external SRT/VTT/word timings. No downloader or embedded ASR.
2. Select useful source ranges. `scenewire media ingest <file> --output <new-directory>` copies/hashes video and extracts independent audio. Retain ingest provenance; never re-encode ordinary trim/crop edits.
3. Create VideoProject v9 video/audio assets. Add visual-only `Video` clips with sourceInMs, constant playbackRate 0.25–4, fit, normalized upright-display crop and background/foreground/replace-scene placement. Source out = sourceIn + durationFrames/fps*1000*rate; reject outside duration.
4. Place canonical audio clips with matching sourceOffsetMs and timeline start/duration. At 1x preserve alignment. Different video rates need explicitly derived audio; there is no implicit embedded audio playback.
5. VisualPlan may declare `existing-footage`; this is fulfilled by the Web host media provider while graphics requirements still select the graphics engine. Plan code graphics with existing graphics engines or structured clips. Include hook, feature/lower-third, callout and timed emphasis/closing treatment. Reuse captions; footage is content, never an engine or ForeignComposition.
6. `inspect-clip` checks derived source in/out and project timing. Use `update-clip` props/transform and existing `retime-clip` for local edits; include corresponding audio offset/duration only when necessary.
7. Run render-check at start/mid/end, every cut, reverse/repeated frames and fresh sessions. Capture/contact-sheet and visually inspect portrait framing and overlay hierarchy. Export with the same Web host source-time path.
8. Validate final packet timing, source/audio sync within one frame, start/end/cut/final black-tail and decode/render performance. Full playback owner review remains separate from deterministic pixel tests. Keep acceptance pending until required evidence and owner review exist.
