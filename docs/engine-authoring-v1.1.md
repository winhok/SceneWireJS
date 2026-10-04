# Deterministic offline Three asset ingress (reference workflow)

This is authoring guidance, not a stable SceneWire loader API. Continue using the existing [engine contract](engine-authoring.md): bounded local resources, seeded synchronous initialization, canonical FrameContext and explicit disposal. Renderer core does not import Three or Draco.

## Prepare outside render time

1. Keep the source GLB and its provenance separately from generated cache. Record SHA-256 of the original bytes, the pinned converter/tool version, explicit conversion options and each generated resource. A filename is organization, not identity.
2. Decode Draco or mesh compression offline using a pinned local tool. Export a self-contained uncompressed GLB or an explicit local glTF resource set. Reject external HTTP URIs, path traversal and resources outside the project asset root. Do not install tools or download decoders during rendering.
3. For a multi-resource glTF, inventory buffers and textures, their relative paths, byte counts and SHA-256. Verify every resource before preparation. Do not silently substitute missing textures, fonts or geometry.
4. Pin scale, axes, color space and material assumptions in a small project-local ingress record. Test the prepared asset in a fresh bounded renderer session before promoting it to production.

A project-local ingress record can contain `schemaVersion`, `sourceDigest`, `converter: {name, version, options}`, `resources: [{path, sha256, bytes}]` and `assumptions`. This is a documented example, not a root-exported contract. Never store credentials or absolute machine paths.

## Initialize and seek

Load only resources explicitly supplied through the existing bounded local ResourceHost. If loading is asynchronous, complete it during bounded preparation; register the adapter only after required geometry/materials/textures are ready. Do not use `withSeededLibraryRandom` across an `await`: use its synchronous callback for object construction after decoding. A loader that requires decoder workers, uncontrolled randomness, clocks or networking must be preprocessed further or rejected.

Set transforms, camera and mixer time from canonical frame time on every seek. Track and dispose owned buffers, geometries, materials, textures and renderer. Keep author-owned geometry diagnostics separate from creative review findings. Re-run random-order seeks and fresh-session captures after changing any asset bytes.

## Identity and acceptance

Bind review evidence to project, composition source, ingress record and relevant resource digests. After asset replacement, previous review images are stale even if the relative path stays the same. Raster reproducibility remains environment-sensitive; pin fonts, browser/backend and renderer profile in measurement records. Same logical asset identity does not prove identical pixels across operating systems or GPUs.

The historical pre-1.0.1 v1.1 dogfood used the existing Aster procedural Three module; it exercised bounded deterministic Three initialization and historical captures, not compressed GLB conversion. Those records remain historical in archive tags; fresh dogfood on integration/v1.1 is pending. Promoting a loader API requires repeated real GLB/Draco use. Offline converter execution and its output comparison remain pending until a real asset and pinned converter are available. This guidance intentionally makes no claim that this unexecuted conversion path has passed qualification.
