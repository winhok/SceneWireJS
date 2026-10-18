import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { statusFixture } from './demo';
import './style.css';
import { quickStart } from './quick-start';
import { RealDemos } from './real-demos';
const github = 'https://github.com/winhok/SceneWireJS';
const docs = `${github}/blob/main/README.md`;
function App() {
  const [edited, setEdited] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  async function copyQuickStart() {
    try {
      await navigator.clipboard.writeText(quickStart);
      setCopyStatus('Commands copied.');
    } catch {
      setCopyStatus(
        'Clipboard unavailable. Select and copy the commands below.',
      );
    }
  }
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
          <a href="#real-demos">Real videos</a>
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
            <a className="cta" href="#real-demos">
              Watch real outputs <span>↓</span>
            </a>
          </div>
          <p className="release-note">
            v1.3.0 available · VideoBench Bounded Engineering Toolkit.
          </p>
          <p className="caption">
            Capture production evidence and inspect deterministic diagnostics.
            Creative Qualification remains NO_GO; Formal Holdout remains
            NOT_CONSUMED. Read the{' '}
            <a href={`${github}/blob/main/docs/videobench-engineering.md`}>
              VideoBench engineering guide and limits
            </a>
            .
          </p>
        </section>
        <RealDemos />
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
            verified in the v1.2 release.
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
            <div className="terminal-title">Released CLI / v1.3.0</div>
            <pre>
              <code>
                {
                  '$ npx scenewire inspect project.json\n$ npx scenewire render-check project.json\n$ npx scenewire render project.json --output video.mp4'
                }
              </code>
            </pre>
          </div>
          <p className="caption">
            Commands shown without fabricated output. The demo above illustrates
            the released v1.2 incremental production contract.
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
            Use Node 22.12 or newer and FFmpeg/ffprobe. Run from a parent
            directory where <code>my-video</code> does not exist. The
            initializer creates a complete project and installs all seven
            shipped SceneWire Skills.
          </p>
          <button
            className="copy-commands"
            type="button"
            onClick={copyQuickStart}
          >
            Copy Quick Start
          </button>
          <p className="caption" role="status" aria-live="polite">
            {copyStatus}
          </p>
          <pre className="terminal">
            <code>{quickStart}</code>
          </pre>
          <p className="caption">
            Dependency and browser installation are explicit. The Playwright
            command uses this project's installed renderer dependency. If the
            browser cannot be downloaded, follow{' '}
            <a href={`${github}/blob/main/docs/onboarding.md`}>onboarding</a> to
            configure an existing Chromium executable. No manual project JSON is
            needed.
          </p>
          <h3>Then give your coding agent a brief.</h3>
          <ol className="agent-steps">
            <li>
              Start with <code>.agents/skills/scenewire/SKILL.md</code> and
              describe the story, duration, canvas and audio requirements.
            </li>
            <li>
              Let the agent load the creation or direction workflow, author the
              composition and use the review skill to inspect actual frames.
            </li>
            <li>
              Keep the source, command log, media checks and final MP4. Report
              failures and interventions alongside the result.
            </li>
          </ol>
          <p className="caption">
            SceneWire renders code authored by your agent; it does not call a
            built-in generative model. The examples are intentionally silent and
            require no paid model or narration service.
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
        <span>SceneWire v1.3.0 · public website</span>
      </footer>
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
