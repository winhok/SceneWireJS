# Review capture and final media measurements

Use the existing controlled renderer; these commands never render a hidden full video.

```sh
scenewire contact-sheet project.json --frames 0,24,48 --output sheet.svg
scenewire frame-strip project.json --start-frame 120 --end-frame 138 --output strip.svg
scenewire frame-strip project.json --start-frame 120 --end-frame 138 --crop 100,80,320,180 --output detail.svg
scenewire capture project.json --frame 120 --crop 100,80,320,180 --output crop.svg
scenewire final-media-qc final.mp4 > final-media-qc.json
```

A strip captures every integer frame in `[startFrame,endFrame)`, in order, with a maximum of 120 frames. The entire range must fit within the project. Frames are embedded PNGs in portable SVGs. Capture and contact-sheet also accept `--crop x,y,width,height`, in integer frame-space pixels. Cropped output must use `.svg`. This clips the displayed image; original full-frame bytes remain embedded, so it is not a redaction tool. Existing capture without crop still produces its original PNG. Output files must not already exist.

Review frame selection is separate from representative determinism frames. The internal selection helper accepts bounded project-space ranges (for example mapped shot/read or diagnostic ranges) and returns sorted unique starts and last included frames plus project endpoints. It does not infer motion peaks or aesthetic quality, and it does not change render-check.

Final media QC hashes and decodes the actual encoded video, not an upstream PCM mix. It uses the existing bounded, cancellable, shell-free local process runner and restricts input protocols to local file/pipe. The first video and audio streams are inspected. Measurements include FFmpeg loudnorm **input** integrated loudness and true peak, astats decoded sample peak, fixed -50 dBFS/100 ms silence ranges and signed audio-minus-video stream endpoint drift. Stream endpoints require stream duration and start time; container duration is not substituted for missing stream facts. The report binds the encoded SHA-256 and rejects input mutation during inspection.

`possibleClipping` means decoded sample peaks reached full scale. It cannot prove whether the original recording clipped, and is not a clipped-sample count. `complete` describes metric availability; it is not a quality PASS, review acceptance or release approval. Missing audio, unavailable/nonfinite measurements (including infinite silence loudness), or unknown endpoint timing remain `pending`, with explicit unavailable fields. Apply production-specific limits in the review, rather than a universal loudness rule. FFmpeg/ffprobe must be installed; failures and resource bounds remain explicit errors.

Metric semantics: [FFmpeg filter documentation](https://ffmpeg.org/ffmpeg-filters.html). Review vocabulary follows the project requirement provenance; no external implementation was copied.
