# Runnable narration integration

SceneWire already compiles phrase and active-word subtitles, phrase mappings and cues. This example consumes a supplied WAV and actual externally supplied timing JSON. It does not call a paid provider or perform alignment. Keep the input's declared provenance: `external-supplied`, `real-alignment`, or `synthetic-fixture`.

From the source distribution, after installing dependencies and building packages:

```sh
node examples/narration-integration/create.mjs speech.wav timing.json narration-output
cd narration-output
scenewire validate phrase.json
scenewire render phrase.json --output phrase.mp4
scenewire render active-word.json --output active-word.mp4
```

Timing JSON has `text`, ordered `words` and `phrases`, each with `text`, `startMs`, `endMs`, plus `provenance`. Use your TTS provider's word boundaries or an external forced aligner's output; label provider identity and transcript separately. The script probes the actual WAV duration. It preserves the existing NarrationDocument and compiler timing contracts and creates a phrase mapping and an explicit cue.

For a runnable synthetic contract demo only, create a two-second test tone and use `examples/narration-integration/timing.synthetic.json`:

```sh
ffmpeg -f lavfi -i sine=frequency=440:duration=2 -c:a pcm_s16le test-tone.wav
node examples/narration-integration/create.mjs test-tone.wav examples/narration-integration/timing.synthetic.json synthetic-output
```

This tone and timing fixture prove rendering and choreography integration. They are not speech, alignment evidence or narration quality acceptance. Real-provider speech infrastructure stays optional through TTSProvider and SpeechAlignmentProvider.
