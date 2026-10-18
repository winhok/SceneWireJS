import React from 'react';
import manifest from '../public/demos/manifest.json';
const base = import.meta.env.BASE_URL;
const examples = [
  {
    id: 'dom',
    title: 'Describe · Compose · Deliver',
    engine: 'DOM / CSS',
    description:
      'Three steps from a natural-language brief to an editable video. Authored by an independent coding agent.',
  },
  {
    id: 'react',
    title: 'Time is data.',
    engine: 'React',
    description:
      'A technical explainer whose component state follows the requested frame.',
  },
  {
    id: 'three',
    title: 'A frame. A camera. A world.',
    engine: 'Three.js',
    description:
      'Real geometry, materials and camera movement driven by FrameContext.',
  },
];
export function RealDemos() {
  return (
    <section id="real-demos" aria-labelledby="real-demos-title">
      <h2 id="real-demos-title">Rendered with the released CLI.</h2>
      <p className="demo-intro">
        Actual MP4s from public npm 1.3.0. Play a video, download its editable
        source, then reproduce it locally.
      </p>
      <div className="real-demos">
        {examples.map((example) => {
          const media = manifest.examples.find(
            (entry) => entry.id === example.id,
          )!;
          return (
            <figure key={example.id}>
              <video
                controls
                playsInline
                preload="metadata"
                poster={`${base}demos/${example.id}.png`}
                src={`${base}demos/${example.id}.mp4`}
                aria-label={`${example.engine} example: ${example.title}`}
                aria-describedby={`demo-${example.id}-caption`}
              />
              <figcaption id={`demo-${example.id}-caption`}>
                <p className="media-facts">
                  {example.engine} · {media.durationSeconds}s · {media.width}×
                  {media.height} · {media.fps} fps · silent
                </p>
                <h3>{example.title}</h3>
                <p>{example.description}</p>
                <a href={`${base}source/${example.id}.zip`} download>
                  Download editable source (.zip)
                </a>
              </figcaption>
            </figure>
          );
        })}
      </div>
      <p className="caption">
        Each source download includes a complete project, composition code, npm
        lockfile and reproduction commands.{' '}
        <a href={`${base}demos/manifest.json`}>
          Inspect render and media records
        </a>
        . All three MP4s passed full decoding. Sample-frame review is separate
        from continuous human playback. Creative Qualification remains NO_GO;
        Formal Holdout remains NOT_CONSUMED.
      </p>
    </section>
  );
}
