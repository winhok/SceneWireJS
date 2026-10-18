# VideoBench engineering tools

SceneWire v1.3.0 adds tools for capturing and checking evidence from actual video
production output. It retains the incremental production graph, invalidation
explanations, verified reuse and checkpoint/resume capabilities introduced in v1.2.

## Install and inspect

Use Node.js 22.12 or newer:

```sh
npm install @scenewirejs/cli@1.3.0
npx scenewire engines --json
npx scenewire videobench --help
```

[Onboarding](onboarding.md) describes project setup, Chromium and FFmpeg/ffprobe.
Install optional React, Pixi or Three authoring dependencies in the consuming project
when selecting those engines. Rendering never silently installs dependencies.

## Evidence capture and diagnostics

Prepare requests against the same installed distribution and actual render output.
Inspect each command's help before authoring inputs:

```sh
npx scenewire videobench identify identity-request.json --json
npx scenewire videobench capture capture-request.json --output evidence-run --json
npx scenewire videobench diagnose evidence-run --expected retained-request.json --json
```

`identify` binds a local project and render output to exact source, candidate, output
and environment identities. `capture` validates that identity before materializing
representative frames, contact sheets and temporal strips in a new output directory.
Reusing an existing directory is rejected. `diagnose` revalidates retained bytes,
derivations and semantic seals. Its expected request must carry the independently
retained `evidenceDigest`; an artifact cannot authorize its own identity.

The installed-product fixture in `scripts/videobench-installed.mjs` provides an
owned synthetic example of the request contracts and rejection behavior. It is a
security and engineering fixture, not a formal Holdout result.

## Review boundaries

Blind A/B packets keep private mappings separate from review material. Controlled
imports, host receipts and complete schedules support conservative unanimous-v1
aggregation. Strict Report V1/V2 validation rejects altered receipts, unsupported
fields, incomplete evidence, unsafe paths and identity changes. Command availability
and synthetic rejection tests do not authenticate an independent reviewer or grant
formal exposure authority.

## Qualification limits

This release is an accepted **bounded engineering toolkit**. Creative Qualification
remains **NO_GO / incomplete**; no formally authenticated independent Creative
Reviewer has been qualified, and Formal Holdout remains **NOT_CONSUMED**.

Technical measurements and deterministic diagnostics remain separate from creative
judgment. There is no verified guarantee of automatic aesthetic improvement or
universal video quality scoring. Historical RED/FAIL results and evidence-access
limits remain preserved; the unique cause of the historical capture timeout remains
unproven.

The immutable package source and v1.3.0 tag identify
`630d9bab59a6d08bb105a8b84960a4c1e6e3dfa4`. Documentation/site follow-up commits
maintain these guides without changing the published package bytes.
