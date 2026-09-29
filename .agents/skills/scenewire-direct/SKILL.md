---
name: scenewire-direct
description: Create a SceneWire video from a visual brief or reference with external Code Model engine selection, validated planning and visual iteration.
---

# Direct a video

Read the brief/reference and inspect `scenewire engines` (use `--json` for machine parsing). Keep the original brief as evidence; do not add engine instructions to it. Create VisualPlan v1 with per-scene intent, selected engine, rationale, requirements and shared palette/typography/motion direction. Run `scenewire plan-check plan.json` (add `--project project.json` when sceneId is supplied).

Prefer the cheapest sufficient engine: existing structured components first, natural DOM/CSS/SVG next; React only for useful component/state structure; GPU 2D for large object fields; true 3D only when perspective/camera/materials carry meaning. Candidates inform selection; the agent makes the final choice. Reject unavailable engines. Read [engine guidance](../../../docs/engine-authoring.md) only for selected engines.

Implement each scene using `scenewire scaffold <engine> <new-directory>` when useful. All time derives from FrameContext; random derives from init.random. Expose useful bounded parameters rather than rewriting unrelated code on every edit. Do not install packages at render time or widen sandbox permissions.

Required feedback loop: render-check → representative capture/contact-sheet → actual vision inspection → documented revision → capture again. Check hierarchy, readability, motion, reference language, visual bugs and cross-scene coherence. Then assemble the canonical project, render final video and verify random/fresh-session repeatability and media timing. Report engine choices and alternatives, performance, edits and evidence. Continuous human playback remains a separate gate until actual owner review is recorded.
