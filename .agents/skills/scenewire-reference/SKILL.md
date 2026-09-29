---
name: scenewire-reference
description: Inspect a local reference video, interpret visual language and compare an original SceneWire adaptation through durable time-based evidence.
---

# Adapt reference language

Keep the owner's request untouched. Run `scenewire reference init <local-video> --output <new-reference-directory>`. No AI call occurs here. Inspect filmstrip and targeted frames (use `media grab --at` in seconds); read shot, motion and audio evidence. Write ReferenceSpec v1 including evidenceId/sourceSha256 and semantic shot descriptions. Run `reference-check <spec> --evidence <evidence>`, which checks live source and retained frame digests. Interpretations are yours; never label palette, typography or camera intent as machine-observed facts.

Use SourcePack exclusively for factual content. Reference on-screen text, logos, screenshots, music and photographs are not production assets unless explicitly authorized. Describe composition, hierarchy, lighting, motion and transition grammar, then let the existing Visual Director choose engines. Do not insert engine IDs into ReferenceSpec or reference metadata into VisualPlan/VideoProject.

After building an original production, write ReferenceAlignment v1: evidenceId/sourceSha256, scene mappings, chronological referenceShotIds, adaptationIntent and monotonic projectProgress/referenceProgress anchors in 0..1. Reference progress spans concatenated mapped shots; output frames remain integers. Run `reference compare <project> --reference <local-video> --alignment <alignment> --evidence <evidence> --output <new-sheet.svg>`. It retains accurate reference/project pairs and samples output motion with the existing renderer. Inspect actual paired images, record a concrete reference-driven issue, revise and compare to a different output path. Numeric rhythm evidence has no aesthetic PASS threshold. Never compare different content with SSIM/PSNR.

Finish with render-check, seek determinism, final export/media/sync checks and continuous owner playback of reference plus output. Retain nine separate review dimensions: visual language, composition, typography, palette/lighting, motion, pacing, transitions, coherence, original-content independence. Until real playback feedback arrives owner review is pending. Keep source media outside Git when requested; retain source URL/revision/digest and derived evidence. Bound long media using explicit duration/sampling/frame limits, and report omitted representative frames.
