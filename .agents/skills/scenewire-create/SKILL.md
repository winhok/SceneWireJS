---
name: scenewire-create
description: Produce a complete new SceneWire video from a creative request and source material using an external Code Model, durable plans, narration and visual review.
---

# Create a video

Keep the owner's original request unchanged. Classify product-launch, faceless-explainer, change-explainer or general. Capture exact source URL/repository revision and retain local snapshot plus SHA-256. Extract facts into `SourcePack`; factual claims require source IDs. Do not silently turn inferred benefits into product facts. Build `ProductionBrief` without engine choices and `NarrativePlan` with stable IDs, exact frame partition and scene voiceover. Use `scenewire brief-check`, `sources-check`, and `narrative-check` before visuals. Source order need not be story order.

When a reference video is supplied, follow [scenewire-reference](../scenewire-reference/SKILL.md) before VisualPlan: init → inspect filmstrip/targeted frames/motion → write ReferenceSpec → reference-check. After scene work create ReferenceAlignment, compare paired frames, actually inspect, revise from comparison and compare again before final render. Without a reference the existing workflow below is unchanged.

Use the existing Visual Director and EngineRegistry to create `VisualPlan`; run `plan-check`. Prefer the cheapest sufficient engine. Preserve one shared VisualDirection. Put all canonical JSON in a portable production folder and initialize with `production-init`. Resolve any validation error before scene work.

Generate narration from NarrativePlan through the existing TTS/alignment contract. Record audio bytes and word/phrase timings, attach to project, then pace final animation to speech. A synthetic sync fixture proves timing only, never final narration quality. Scene workers may be bounded and parallel only after the shared plans are locked. Give each worker the brief, its narrative/visual scene, relevant claims, shared direction and engine guidance. Each writes only its scene/composition directory; workers never modify global project, other scenes or source records. Stable IDs survive retries. Remove a Web scene’s `.scenewire-scaffold.json` marker only after replacing starter code and adding real visual implementation; `production-check` treats a remaining marker as unfinished. Structured scenes remain native clips; Web scenes use existing scaffold and FrameContext.

For every scene: render-check representative frames, capture/contact-sheet, actually inspect visuals and record issues. Revise at least once for a full-production benchmark, then capture again. Run `production-check`, final render, media and audio measurements, source-claim sampling and a continuous human narrative/visual playback review. Record story, visual, narration, transitions, level and subtitle findings separately. Do not mark technical acceptance PASS until all gates and relevant project-level semantic-editing, rendering and routing checks have evidence. Keep paid/provider operations, push/deploy and external writes within user authorization.
