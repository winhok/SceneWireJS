# Architecture

SceneWire uses a canonical, validated VideoProject document. Product logic is independent of React and the rendering backend.

`VideoProject → compileChoreography → compileProject → evaluateAtFrame → RenderGraph`

Schema owns persistence and migrations; time owns frame conversion. Runtime resolves layouts, motion and registered domain components. Compiler turns narration cues into runtime choreography. Canvas draws native primitives. Renderer-core defines frame/session interfaces; renderer-web bundles local compositions and captures them through Chromium. Web-runtime supplies deterministic frame stores and engine adapters. Media handles native encoding; audio handles asset resolution, scheduling and mixing.

Editor-core owns reversible project operations; the React editor adds authoring controls. Patch validates atomic semantic edit plans. Director-core selects authoring engines through explicit plans. Production-core validates briefs, sources, narratives and asset ledgers. Media-inspect and reference-core inspect local footage and compare interpreted reference language. The CLI composes these APIs without requiring the editor.

Compilation snapshots the project. Frame evaluation depends on the requested frame, canonical project and seed. Domain components lower to the same native primitives; foreign compositions retain editable code outside JSON. External footage remains an immutable asset.

See [project model](project-ir.md), [rendering](rendering.md), [web compositions](web-compositions.md) and [engines](engine-authoring.md).
