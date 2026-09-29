# Rendering and security

`compileProject` validates and snapshots a project, resolves layouts and motion, and invokes registered component compilers. `evaluateAtFrame` clamps frame time and evaluates half-open clip intervals. Arbitrary seeks use canonical time rather than playback history.

Canvas renders native primitives. The browser provider composites foreign compositions, immutable footage and native layers through an isolated Chromium host. Native exports use WebCodecs/Mediabunny; browser video export streams frames to FFmpeg and applies one canonical audio mix. Font and graphics differences across machines can affect pixels.

Code uses FrameContext and seeded randomness. Preparation awaits declared resources. Browser sessions have fresh storage; sandboxed composition frames cannot read host DOM or Node/filesystem APIs. CSP and request interception restrict resources. Source paths are bounded to the composition tree and explicitly resolved dependencies. Rendering never installs packages. This is a boundary for trusted editable visual code, not a general hostile-code virtual machine.

Chromium uses its process sandbox. Seek/capture and exports have bounded timeouts; cancellation disposes resources. `render-check` compares repeated and fresh-session frames in the same environment. See [web compositions](web-compositions.md) for detailed permissions and export behavior.
