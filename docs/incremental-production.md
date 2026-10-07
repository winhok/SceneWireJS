# Incremental production — v1.2 candidate

SceneWire v1.2 is a local qualification candidate. It has not been published to npm or released. Installation instructions continue to use the released v1.1.0 CLI; the commands below belong to the v1.2 candidate.

A production graph keeps semantic recipes, produced bytes and review bindings separate. Matching recipes permit reuse only after current output bytes and dependency validity are verified. A changed scene rebuilds its required closure while independent scenes remain reusable. Rendering uses existing bounded scene ranges; transitions conservatively expand affected ranges. Audio mix and final assembly are independent producers.

## Candidate CLI

```sh
scenewire production-status production.json --profile profile.json --json
scenewire production-explain production.json final-media --profile profile.json --json
scenewire production-build production.json --profile profile.json --json
```

These commands use the existing production manifest (brief, sources, narrative plan, visual plan and project). The profile declares semantic producer and raster environment fingerprints, renderer profile and capture backend; it may include the existing shared VisualSystem. Declared compatibility is not automatic cross-platform qualification.

Status and explain are read-only. `--records observations.json` supplies current product records and production-relative output paths. Without that flag, observation reads the default production records when available. It verifies bytes rather than trusting stored freshness. Explain returns direct and transitive causes, previous/current recipe identities and verified unaffected neighbors.

Build accepts `--state build-state-directory`, verifies reusable outputs and resumes completed work automatically. A state directory supports one local writer. Source, provenance and durable reviews belong outside disposable build state. Cache loss does not authorize removing those durable records. Missing or corrupt output bytes rebuild required downstream artifacts; conflicting outputs for the same recipe fail closed. Disk layout and checkpoint primitives are implementation details.

## Results and metrics

The three JSON result envelopes use `schemaVersion: 1`. Build reports actual artifact actions, range/frame receipts, verified byte identities, review retention and execution metrics. `bytesWritten` sums bytes produced and committed by rebuilt artifacts during that build, including identical content already present in CAS. It does not measure physical CAS growth. Frames are counted once even when conservative support overlaps boundaries. Savings are omitted without a comparable measured baseline.

A retained review remains bound to its candidate. Retention does not imply visual PASS, owner acceptance or release approval. Runtime media validation cannot provide those human decisions.

## API boundary

The v1.2 product interface is the CLI plus versioned JSON contracts. Existing deliberate v1.1 package exports remain unchanged. Raw artifact stores, atomic-write helpers, canonical JSON, checkpoints and executor implementations are not newly exposed as public APIs.

The purpose-built qualification production owns A [0,180), B [180,360) and C [360,540), at 30 fps and 320×180. Qualification checks actual producer invocations, incremental/clean complete MP4/WAV equality and exact decoded RGBA frames. Results from one declared local environment do not establish cross-platform media equality or creative quality.
