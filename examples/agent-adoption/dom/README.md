# Describe → Compose → Deliver

Independent Coding Agent output from public SceneWire 1.3.0 and the seven shipped Skills. Three four-second DOM/CSS scenes; 12 seconds, 1280×720, 30 fps, intentionally silent.

```sh
npm ci
npx --no-install playwright install chromium
npx --no-install scenewire doctor
npx --no-install scenewire render-check project.json --frames 0,30,119,120,150,239,240,270,330,359
npx --no-install scenewire render project.json --output video.mp4 --profile deterministic-export
npx --no-install scenewire final-media-qc video.mp4
ffmpeg -v error -xerror -i video.mp4 -f null -
```

Use Node >=22.12 and FFmpeg/ffprobe. Project, source plans, request, compositions and public npm lockfile are included. For portable JavaScript source, the sprint operator erased TypeScript syntax and changed only composition entry extensions after the independent production finished. Original typed source is retained as `agent-original.ts.txt`; the Agent's original run and media remain separately preserved. The portable copy has its own clean-directory replay record.

Creation used scenewire, scenewire-create, scenewire-direct and scenewire-review. All seven shipped Skills were installed and byte-verified; edit, reference and footage were not applicable. No parent-provided implementation, paid model/TTS calls or private workspace packages were used. Real frame images were reviewed; continuous human playback remains unperformed. Creative Qualification=NO_GO; Formal Holdout=NOT_CONSUMED.
