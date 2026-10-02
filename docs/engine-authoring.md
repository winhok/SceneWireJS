# Authoring engines

Install optional engine dependencies in your consuming project (`npm install react react-dom`, `npm install pixi.js`, or `npm install three`); see [npm prerequisites](../README.md#requirements).

An engine is an authoring method; renderer is the pixel backend. `web-pixi` and `web-three` execute in `web`, not separate renderers. `scenewire engines` resolves installed dependencies without downloading anything. Pure director-core without an environment reports profiles as defined; only available engines can pass plan-check. Requirement strings refer to declared traits, not automatic creative classification.

`scenewire plan-check plan.json [--project project.json]` validates the independent VisualPlan v1. Shared direction tokens may be imported from local composition code; they are not canonical VideoProject data. `scenewire scaffold web-dom|web-react|web-pixi|web-three new-directory` creates integration boilerplate, never a design template.

## Manifest and parameters

Manifest v1 stays valid and defaults to web-dom. Manifest v2 adds optional engine (default web-dom) and parameters of string/number/boolean/color/enum types. Numeric min/max and enum membership are enforced. ForeignComposition props.parameters holds overrides in VideoProject v9; v1–v8 migration changes only the version. Resolved defaults/overrides are frozen and supplied as init.parameters per clip. Unknown values fail at prepare. `update-composition-params` patches merge typed scalar values; manifest-specific validation occurs at render preparation because ordinary patching intentionally does not read arbitrary files. Freeform code stays ordinary code.

## web-pixi

Import `pixi.js/unsafe-eval`: despite its name, this installs static CSP-compatible polyfills instead of dynamic eval. CSP remains strict. Disable Ticker.system.autoStart and stop it before app initialization, then initialize with autoStart:false, sharedTicker:false. Prefer webgl for deterministic-export; preview may use library backend detection. Register createPixiFrameAdapter({app,update,refreshMedia?,dispose?}). Disable ticker, set every visual property from FrameContext and init.random, never accumulated delta. Adapter explicitly renders stage on seek and flush. Precompute keyed particle seeds, never rely on object initialization UUIDs for visuals.

## web-three

Use synchronous withSeededLibraryRandom(init.random, namespace, callback) for library UUID construction, never asynchronous visual updates. Register createThreeFrameAdapter({renderer,scene,camera,update,mixers?,libraryRandom:init.random,refreshMedia?,dispose?}); render bookkeeping uses the same scoped seeded helper. No setAnimationLoop or requestAnimationFrame as render time. Mixer setTime uses canonical seconds; account for mixer.timeScale. Set camera/object state absolutely. Dispose geometries/materials/textures. WebGL/SwiftShader is the initial export path; WebGPU is not required. flush refreshes media and re-renders without advancing time.

## Execution and evidence

Preview chooses the hardware path; deterministic-export pins ANGLE/SwiftShader and a fresh browser context. Logical seek determinism, same-environment raster repeatability and cross-GPU repeatability are separate: only the first two are tested. Existing DOM/SVG pixel thresholds are unchanged. Fixed seed, local assets and fonts remain important. Sandboxed code has no Node, network, filesystem or uncontrolled clocks. Prepare/seek/capture remain bounded.

RenderRange is half-open [startFrame,endFrame); `scenewire render project.json --start-frame N --end-frame M --output new.mp4` preserves project time and trims canonical audio to the same interval. Progress counts frames in that range; cancellation propagates to browser/encoder. No distributed executor.

## Final frame diagnostics

A composition or registered `FrameAdapter` can implement optional `validateFrame(context)`. It runs after composition seek, adapter seek, animation synchronization, readiness and adapter flush, before capture. Return `FrameDiagnostic` objects (`id`, `severity`, `message`, optional `source` and JSON `metadata`). SceneWire supplies the canonical frame, composition and engine; author supplied provenance is ignored.

`info` and `warning` are reported and permit rendering. `error` fails rendering before accepting an output. `render-check` detects validators and first sweeps every frame without PNG capture, comparing facts in fresh forward/reverse sessions, then retains its existing representative pixel checks. Compositions without validators skip the diagnostic sweep. Reports collapse only consecutive identical facts; exact per-frame facts remain available on failures. Explicit empty or out-of-range render-check frame selections reject.

`createThreeFrameAdapter` accepts an optional `validateFrame` callback. Authors own geometry tests: camera blocker penetration, clearance, envelope exits, near-target occlusion, moving geometry penetration or invalid materials. Implement the appropriate AABB/OBB/raycast checks inside the composition; SceneWire supplies no collision algorithm or automatic correction. Validation observes the flushed camera/object/mixer/material state.

Complex GLB/Draco authoring remains outside 1.0: preprocess deterministically offline into local artifacts, avoid runtime network/uncontrolled workers, and seed initialization. Asset loader frameworks and scene-state attribution belong to later versions.
