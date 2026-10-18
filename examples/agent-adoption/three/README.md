# A frame, a camera, a world

A real Three.js geometry/camera example, rendered by the public SceneWire 1.3.0 CLI. 8 seconds, 1280×720, 30 fps. Intentionally silent. All animation derives from FrameContext; no wall clock, remote assets or model calls.

From this example directory:

```sh
npm ci
npx --no-install playwright install chromium
npx --no-install scenewire doctor
npx --no-install scenewire render-check project.json
npx --no-install scenewire render project.json --output video.mp4
npx --no-install scenewire final-media-qc video.mp4
ffmpeg -v error -i video.mp4 -f null -
```

Use Node >=22.12 and FFmpeg/ffprobe. `package-lock.json` fixes the installed public dependency graph. The full project and composition source are included. Representative-frame review does not constitute continuous human playback or Creative Qualification.
