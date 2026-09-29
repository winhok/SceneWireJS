import { flags } from './options';
import { limits } from './options';
import { required } from './options';
import { options } from './options';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { referenceEvidenceSchema } from '@scenewirejs/reference-core';
import { json } from './options';
import { validateReferenceEvidence } from '@scenewirejs/reference-core';
import { MediaError } from '@scenewirejs/media-inspect';
import { verifyEvidence } from '@scenewirejs/media-inspect';
import { parseProject } from '@scenewirejs/schema';
import { readFile } from 'node:fs/promises';
import { validateReferenceAlignment } from '@scenewirejs/reference-core';
import { hashFile } from '@scenewirejs/media-inspect';
import { relative } from 'node:path';
import { readdir } from 'node:fs/promises';
import { absent } from './options';
import { mkdir } from 'node:fs/promises';
import { type ReferenceComparisonReport } from '@scenewirejs/reference-core';
import { writeFile } from 'node:fs/promises';
import { run } from '@scenewirejs/media-inspect';
import { motionFromGray } from '@scenewirejs/media-inspect';
import { writeJson } from '@scenewirejs/media-inspect';
import { referenceTimeAt } from '@scenewirejs/reference-core';
import { frameBytes } from '@scenewirejs/media-inspect';
import { xml } from '@scenewirejs/media-inspect';
import { compareMotion } from '@scenewirejs/reference-core';
import { sampleMotion } from '@scenewirejs/reference-core';
import { alignedReferenceProgress } from '@scenewirejs/reference-core';
import { referenceComparisonReportSchema } from '@scenewirejs/reference-core';
export async function compareCommand(
  file: string,
  rest: string[],
  signal: AbortSignal,
) {
  const f = flags(rest, [
      '--reference',
      '--alignment',
      '--evidence',
      '--output',
      ...limits,
    ]),
    alignmentFile = required(f, '--alignment'),
    reference = required(f, '--reference'),
    output = required(f, '--output'),
    o = options(f, signal);
  const evidenceFile =
    f.get('--evidence') ?? resolve(dirname(alignmentFile), 'evidence.json');
  const e = referenceEvidenceSchema.parse(await json(evidenceFile));
  const evidenceReport = validateReferenceEvidence(e);
  if (!evidenceReport.valid)
    throw new MediaError(
      'reference.evidence',
      evidenceReport.errors.join('; '),
    );
  await verifyEvidence(e, evidenceFile, reference, o.signal);
  const project = parseProject(await readFile(file, 'utf8')),
    report = validateReferenceAlignment(
      await json(alignmentFile),
      e,
      project.scenes,
    );
  if (!report.valid || !report.value)
    throw new MediaError('reference.alignment', report.errors.join('; '));
  const alignment = report.value;
  const totalFrames = Math.max(
    ...project.scenes.map((s) => s.startFrame + s.durationFrames),
  );
  if (totalFrames / project.fps > (o.maxDurationSeconds ?? 600))
    throw new MediaError(
      'reference.duration',
      'Project exceeds comparison duration limit',
    );
  if (alignment.mappings.reduce((sum, m) => sum + m.anchors.length, 0) > 120)
    throw new MediaError(
      'reference.anchors',
      'Comparison has more than 120 anchors',
    );
  const projectRoot = dirname(resolve(file));
  const projectSha256 = await hashFile(file, o.signal);
  const renderSources: { path: string; sha256: string }[] = [];
  for (const asset of project.assets) {
    if (asset.type !== 'composition') continue;
    const folder = dirname(resolve(projectRoot, asset.src));
    const rel = relative(projectRoot, folder);
    if (rel.startsWith('../') || rel === '..')
      throw new MediaError(
        'reference.path',
        'Composition directory escapes project',
      );
    for (const entry of await readdir(folder, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (entry.isSymbolicLink())
        throw new MediaError(
          'reference.path',
          'Reference comparison sources must not contain symlinks',
        );
      if (!entry.isFile()) continue;
      const path = resolve(entry.parentPath, entry.name);
      renderSources.push({
        path: relative(projectRoot, path),
        sha256: await hashFile(path, o.signal),
      });
      if (renderSources.length > 1000)
        throw new MediaError(
          'reference.sources',
          'Too many composition source files',
        );
    }
  }
  const directory = `${output}.frames`;
  for (const p of [output, `${output}.json`, directory]) await absent(p);
  // Metrics use a rendered candidate video, not screenshot differences. Sample existing renderer output at a bounded rate.
  const { WebRendererSession } = await import('@scenewirejs/renderer-web');
  const session = new WebRendererSession({
    project,
    projectRoot: dirname(resolve(file)),
    signal: o.signal,
  });
  await mkdir(directory);
  const tiles: string[] = [],
    mappings: ReferenceComparisonReport['mappings'] = [];
  let row = 0;
  try {
    await session.prepare();
    const motionFps = o.motionFps ?? 4;
    if (motionFps < 0.1 || motionFps > 30)
      throw new MediaError(
        'reference.sampling',
        'Motion sampling must be 0.1..30 fps',
      );
    const motionDirectory = resolve(directory, 'motion');
    await mkdir(motionDirectory);
    const motionCount = Math.ceil((totalFrames / project.fps) * motionFps);
    for (let i = 0; i < motionCount; i++) {
      const frame = Math.min(
        totalFrames - 1,
        Math.round((i * project.fps) / motionFps),
      );
      await writeFile(
        resolve(motionDirectory, `motion-${String(i).padStart(5, '0')}.png`),
        (await session.renderFrame(session.contextAt(frame))).source,
        { flag: 'wx' },
      );
    }
    const gray = await run(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-threads',
        '1',
        '-filter_threads',
        '1',
        '-framerate',
        String(motionFps),
        '-i',
        resolve(motionDirectory, 'motion-%05d.png'),
        '-vf',
        'scale=64:36,format=gray',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'gray',
        'pipe:1',
      ],
      o,
    );
    const candidateMotion = motionFromGray(
      gray.stdout,
      (totalFrames / project.fps) * 1000,
      [],
      motionFps,
    );
    await writeJson(resolve(directory, 'motion.json'), candidateMotion);
    for (const m of alignment.mappings) {
      const scene = project.scenes.find((s) => s.id === m.sceneId)!,
        shots = m.referenceShotIds.map((id) =>
          e.shotCandidates.find((s) => s.id === id)!,
        );
      const pairedFrames: string[] = [];
      for (const [index, a] of m.anchors.entries()) {
        const frame = Math.min(
          scene.startFrame + scene.durationFrames - 1,
          scene.startFrame +
            Math.round(a.projectProgress * scene.durationFrames),
        );
        const referenceTime = Math.min(
          referenceTimeAt(shots, a.referenceProgress),
          shots[shots.length - 1]!.endMs -
            Math.min(
              50,
              (shots[shots.length - 1]!.endMs -
                shots[shots.length - 1]!.startMs) /
                4,
            ),
        );
        const rendered = (await session.renderFrame(session.contextAt(frame)))
            .source,
          ref = await frameBytes(reference, referenceTime, 'accurate', o);
        if (!ref.length)
          throw new MediaError(
            'reference.frame',
            'Empty reference comparison frame',
          );
        const pair = `pair-${row}-${index}`;
        await writeFile(resolve(directory, `${pair}-project.png`), rendered, {
          flag: 'wx',
        });
        await writeFile(resolve(directory, `${pair}-reference.png`), ref, {
          flag: 'wx',
        });
        pairedFrames.push(
          relative(
            dirname(resolve(output)),
            resolve(directory, `${pair}-project.png`),
          ),
          relative(
            dirname(resolve(output)),
            resolve(directory, `${pair}-reference.png`),
          ),
        );
        const y = row * 300;
        tiles.push(
          `<image x="0" y="${y}" width="480" height="270" href="data:image/png;base64,${rendered.toString('base64')}"/><image x="480" y="${y}" width="480" height="270" href="data:image/png;base64,${ref.toString('base64')}"/><text x="8" y="${y + 290}">${xml(m.sceneId)} project ${(frame / project.fps).toFixed(3)}s | reference ${(referenceTime / 1000).toFixed(3)}s</text>`,
        );
        row++;
      }
      const referenceDuration = shots.reduce(
          (s, x) => s + x.endMs - x.startMs,
          0,
        ),
        n = 41;
      const metrics = candidateMotion
        ? compareMotion(
            Array.from({ length: n }, (_, i) =>
              sampleMotion(
                candidateMotion!,
                ((scene.startFrame +
                  (i / (n - 1)) * (scene.durationFrames - 1)) /
                  project.fps) *
                  1000,
              ),
            ),
            Array.from({ length: n }, (_, i) =>
              sampleMotion(
                e.motion,
                referenceTimeAt(
                  shots,
                  alignedReferenceProgress(m.anchors, i / (n - 1)),
                ),
              ),
            ),
          )
        : {};
      mappings.push({
        sceneId: scene.id,
        ...metrics,
        durationRatio:
          ((scene.durationFrames / project.fps) * 1000) / referenceDuration,
        pairedFrames,
        anchorCoverage:
          m.anchors.length > 1
            ? m.anchors[m.anchors.length - 1]!.projectProgress -
              m.anchors[0]!.projectProgress
            : 0,
      });
    }
  } finally {
    await session.dispose();
  }
  if ((await hashFile(file, o.signal)) !== projectSha256)
    throw new MediaError(
      'reference.stale',
      'Project changed during comparison',
    );
  for (const source of renderSources)
    if (
      (await hashFile(resolve(projectRoot, source.path), o.signal)) !==
      source.sha256
    )
      throw new MediaError(
        'reference.stale',
        'Composition changed during comparison',
      );
  await verifyEvidence(e, evidenceFile, reference, o.signal);
  const comparison = referenceComparisonReportSchema.parse({
    version: 1,
    referenceId: e.id,
    sourceSha256: e.source.sha256,
    projectId: project.id,
    projectSha256,
    renderSources,
    alignmentCoverage:
      alignment.mappings.reduce(
        (sum, m) =>
          sum + project.scenes.find((s) => s.id === m.sceneId)!.durationFrames,
        0,
      ) / totalFrames,
    mappings,
    interpretation: 'Evidence only; human/vision style review required',
  });
  await writeFile(
    output,
    `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${row * 300}">${tiles.join('')}</svg>`,
    { flag: 'wx' },
  );
  await writeJson(`${output}.json`, comparison);
  return {
    valid: true,
    output,
    report: `${output}.json`,
    motionMetricsAvailable: !!mappings.find(
      (m) => m.meanEnergyDifference !== undefined,
    ),
    comparison,
  };
}
