import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { statusFixture } from './demo';
import './style.css';
const github = 'https://github.com/winhok/SceneWireJS';
const docs = `${github}/blob/main/README.md`;
function App() {
  const [edited, setEdited] = useState(false);
  const status = statusFixture(edited);
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header>
        <a className="wordmark" href="#main">
          SceneWire<span> / </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#how">How it works</a>
          <a href="#quick-start">Quick Start</a>
          <a href={github}>GitHub ↗</a>
        </nav>
      </header>
      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow">Motion Engineering / SceneWire</p>
          <h1 id="hero-title">
            Motion Engineering
            <br />
            for Coding Agents<span>.</span>
          </h1>
          <div className="hero-bottom">
            <p>
              Change one scene.
              <br />
              <strong>Rebuild only what became invalid.</strong>
            </p>
            <a className="cta" href="#demo">
              Explore the production model <span>↓</span>
            </a>
          </div>
          <p className="release-note">
            v1.2.0 available · Incremental production is a v1.2 engineering
            preview.
          </p>
        </section>
        <section id="demo" aria-labelledby="demo-title">
          <div className="section-heading">
            <p className="eyebrow">01 / The smallest useful change</p>
            <h2 id="demo-title">A change has a boundary.</h2>
            <p>Edit B. Follow the dependency, keep the siblings.</p>
          </div>
          <div className="demo-note">
            Interactive illustration · schema-validated fixture · not a live
            renderer or qualification result
          </div>
          <div className="scenes" aria-live="polite">
            {status.artifacts.map((artifact, index) => (
              <article
                className={`scene scene-${index} ${edited && index === 1 ? 'changed' : ''}`}
                key={artifact.id}
              >
                <div className="scene-top">
                  <span>Scene {artifact.scene?.id}</span>
                  <span>
                    {artifact.scene?.startFrame}—{artifact.scene?.endFrame}
                  </span>
                </div>
                <div className="scene-art" aria-hidden="true">
                  <span>{artifact.scene?.id}</span>
                  <i />
                  <i />
                </div>
                <div className="scene-bottom">
                  <strong>
                    {edited ? (index === 1 ? 'REBUILD' : 'REUSE') : 'FRESH'}
                  </strong>
                  <span>
                    Review →{' '}
                    {artifact.reviewRetention === 'invalidated'
                      ? 'INVALIDATE'
                      : 'RETAIN'}
                  </span>
                </div>
              </article>
            ))}
          </div>
          <div className="demo-controls">
            <button type="button" onClick={() => setEdited(!edited)}>
              {edited ? 'Reset baseline' : 'Edit Scene B'}{' '}
              <span aria-hidden="true">↗</span>
            </button>
            <p>
              {edited
                ? 'B changes. Final media must be reassembled.'
                : 'Three independent ranges. One production.'}
            </p>
          </div>
          <div className="explain" aria-live="polite">
            <code>production-explain</code>
            {edited ? (
              <dl>
                <div>
                  <dt>Direct cause</dt>
                  <dd>Final media depends on changed raster B.</dd>
                </div>
                <div>
                  <dt>Transitive cause</dt>
                  <dd>B’s authored recipe changed.</dd>
                </div>
                <div>
                  <dt>Unaffected siblings</dt>
                  <dd>A and C remain fresh; review bindings retained.</dd>
                </div>
              </dl>
            ) : (
              <p>Edit B to reveal the causal explanation.</p>
            )}
          </div>
          <p className="caption">
            Review retention describes candidate binding validity. It is not an
            approval or acceptance claim. Real bounded render reuse remains
            under qualification.
          </p>
        </section>
        <section id="why" className="editorial">
          <p className="eyebrow">02 / Why SceneWire</p>
          <h2>
            Leave more behind
            <br />
            than another MP4.
          </h2>
          <p>
            Every render should leave behind reusable production knowledge — not
            just another MP4. Source intent, bounded artifacts, review bindings
            and causal explanations give the next change somewhere to start.
          </p>
        </section>
        <section id="how">
          <p className="eyebrow">03 / How it works</p>
          <h2>Intent → artifacts → evidence.</h2>
          <ol className="steps">
            <li>
              <span>01</span>
              <h3>Author with boundaries</h3>
              <p>
                Describe scenes, compositions, visual systems and audio as
                explicit production inputs.
              </p>
            </li>
            <li>
              <span>02</span>
              <h3>Explain invalidation</h3>
              <p>
                Track semantic recipes and dependencies. Separate a scene change
                from a shared input change.
              </p>
            </li>
            <li>
              <span>03</span>
              <h3>Keep verified knowledge</h3>
              <p>
                Verified artifacts and durable review records carry distinct
                identities. Rendering and final assembly stay separate.
              </p>
            </li>
          </ol>
        </section>
        <section id="terminal">
          <p className="eyebrow">04 / At the terminal</p>
          <h2>Code first. Pixels last.</h2>
          <div className="terminal">
            <div className="terminal-title">Released CLI / v1.2.0</div>
            <pre>
              <code>
                {
                  '$ npx scenewire inspect project.json\n$ npx scenewire render-check project.json\n$ npx scenewire render project.json --output video.mp4'
                }
              </code>
            </pre>
          </div>
          <p className="caption">
            Commands shown without fabricated output. The incremental production
            demo above previews v1.2; it is not a released CLI walkthrough.
          </p>
        </section>
        <section id="examples">
          <p className="eyebrow">05 / Examples</p>
          <h2>A source you can inspect.</h2>
          <div className="examples">
            <a href={`${github}/tree/main/examples`}>
              <h3>
                Web compositions <span>↗</span>
              </h3>
              <p>
                Explore authored examples and renderer contracts in the public
                source.
              </p>
            </a>
            <a href={`${github}/blob/main/docs/web-compositions.md`}>
              <h3>
                Composition contract <span>↗</span>
              </h3>
              <p>
                See how a project references its composition manifest and
                source.
              </p>
            </a>
          </div>
        </section>
        <section id="quick-start">
          <p className="eyebrow">06 / Quick Start</p>
          <h2>Start with the released CLI.</h2>
          <p>
            Use Node 24 and install v1.2.0 in your project. Install Chromium for
            browser rendering.
          </p>
          <pre className="terminal">
            <code>
              {
                'npm install @scenewirejs/cli@1.2.0\nnpm install -D playwright\nnpx playwright install chromium\nnpx scenewire engines\nnpx scenewire scaffold web-dom composition'
              }
            </code>
          </pre>
          <p className="caption">
            The scaffold creates composition source, not a complete video
            project. Follow the{' '}
            <a href={`${github}/blob/main/docs/web-compositions.md`}>
              Web composition contract
            </a>{' '}
            to create a VideoProject v9 referencing
            composition/composition.json, then run the inspect, render-check and
            render commands above. Rendering also needs FFmpeg.
          </p>
        </section>
        <section className="closing">
          <p className="eyebrow">07 / Continue in source</p>
          <h2>
            Make the next change
            <br />
            understandable.
          </h2>
          <div>
            <a className="cta" href={github}>
              Explore GitHub ↗
            </a>
            <a href={docs}>Read the docs ↗</a>
          </div>
        </section>
      </main>
      <footer>
        <span>SceneWire / Motion Engineering</span>
        <span>Website v1 · public deployment pending</span>
      </footer>
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
