import { z } from 'zod';
import { videoBenchReviewCommand } from './videobench-review';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { platform, arch, release, homedir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { parseProject, type VideoProject } from '@scenewirejs/schema';
import {
  WebRendererSession,
  type WebRenderOptions,
} from '@scenewirejs/renderer-web';
import {
  pngPixels,
  pngGrid,
  probe,
  frameBytesBatch,
  run,
} from '@scenewirejs/media-inspect';
import {
  outputIdentity,
  canonicalDigest,
  candidateIdentity,
  relativePathSchema,
} from '@scenewirejs/production-core';
import {
  benchmarkCandidateSchema,
  materializeVideoBenchEvidence,
  validateMaterializedEvidence,
  type EvidenceCaptureAdapter,
  type EvidenceCapturePlan,
  type BenchmarkCandidate,
} from '@scenewirejs/reference-core';
import {
  productionCandidate,
  retainedEvidencePath,
  hashRetainedArtifact,
} from './production-evidence';
import { producerModuleClosure } from './production-source-identity';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  resolvedPackage,
  dependencyIdentity,
} from '../../../packages/renderer-web/src/bundle/dependencies';

/** System font inventory affects raster identity; local paths never enter formal records. */
async function fontsDigest(signal: AbortSignal) {
  const roots =
    platform() === 'darwin'
      ? [
          '/System/Library/Fonts',
          '/Library/Fonts',
          join(homedir(), 'Library/Fonts'),
        ]
      : platform() === 'win32'
        ? [join(process.env.WINDIR ?? 'C:/Windows', 'Fonts')]
        : [
            '/usr/share/fonts',
            '/usr/local/share/fonts',
            join(homedir(), '.local/share/fonts'),
            join(homedir(), '.fonts'),
          ];
  const hashes: string[] = [];
  let size = 0,
    count = 0;
  async function scan(path: string, depth: number) {
    if (signal.aborted) throw Error('Capture cancelled');
    if (depth > 16 || ++count > 20000)
      throw Error('Font inventory exceeds bounds');
    const s = await lstat(path).catch((e) => {
      if (e.code === 'ENOENT') return null;
      throw e;
    });
    if (!s || s.isSymbolicLink()) return;
    if (s.isDirectory())
      for (const entry of (await readdir(path)).sort())
        await scan(join(path, entry), depth + 1);
    else if (s.isFile() && /\.(?:ttf|otf|ttc|dfont)$/i.test(path)) {
      size += s.size;
      if (size > 1024 * 1024 * 1024) throw Error('Font inventory too large');
      hashes.push(outputIdentity(await readFile(path)));
    }
  }
  for (const root of roots) await scan(root, 0);
  if (!hashes.length) throw Error('Cannot identify raster font environment');
  return canonicalDigest('videobench/system-font-bytes-v1', hashes.sort());
}
export interface VideoBenchCaptureRequest {
  candidate: BenchmarkCandidate;
  plan: EvidenceCapturePlan;
  project: string;
  renderOutput: string;
  /** Capture result seal, retained independently of the untrusted bundle. Required for diagnose. */
  evidenceDigest?: string;
}
/** Same production session implementation as export; no preview renderer or provider. */
export async function createVideoBenchAdapter(
  root: string,
  projectPath: string,
  renderOutput: string,
  sessionFactory: (
    options: WebRenderOptions,
  ) => Pick<
    WebRendererSession,
    | 'prepare'
    | 'dispose'
    | 'renderFrame'
    | 'contextAt'
    | 'builds'
    | 'performanceReport'
  > = (options) => new WebRendererSession(options),
): Promise<EvidenceCaptureAdapter> {
  root = resolve(root);
  const file = await retainedEvidencePath(root, projectPath);
  const projectBytes = await readFile(file);
  const project = parseProject(projectBytes.toString('utf8'));
  const durationFrames = Math.max(
    ...project.scenes.map((s) => s.startFrame + s.durationFrames),
  );
  if (durationFrames > 18000) throw Error('Source frame-count limit exceeded');
  const fullProject: VideoProject = {
    ...project,
    scenes: [
      {
        ...project.scenes[0]!,
        id: 'videobench-whole-project',
        startFrame: 0,
        durationFrames,
      },
    ],
  };
  const cliRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const resolver = createRequire(join(cliRoot, 'package.json'));
  const renderer = await resolvedPackage(resolver, '@scenewirejs/renderer-web');
  const closure = await producerModuleClosure(join(renderer.root, 'dist'), [
    'session/session.js',
  ]);
  const tool = {
    id: 'scenewire-production-capture',
    version: canonicalDigest('videobench/capture-implementation-v1', {
      closure,
      host: outputIdentity(await readFile(join(cliRoot, 'dist/scenewire.js'))),
      dependencies: await dependencyIdentity(cliRoot, [
        '@scenewirejs/reference-core',
        '@scenewirejs/media-inspect',
        '@scenewirejs/renderer-web',
      ]),
      ffmpeg: (
        await run('ffmpeg', ['-version'], { timeoutMs: 10000, maxBytes: 65536 })
      ).stdout.toString(),
      ffprobe: (
        await run('ffprobe', ['-version'], {
          timeoutMs: 10000,
          maxBytes: 65536,
        })
      ).stdout.toString(),
    }),
  };
  let expected:
    Awaited<ReturnType<EvidenceCaptureAdapter['resolve']>> | undefined;
  const outputFile = await retainedEvidencePath(root, renderOutput);
  let timeline: number[] = [];
  async function prepare(signal: AbortSignal) {
    const session = sessionFactory({
      project,
      projectRoot: root,
      profile: 'deterministic-export',
      signal,
      prepareTimeoutMs: 30000,
      seekTimeoutMs: 5000,
      captureTimeoutMs: 5000,
    });
    try {
      await session.prepare();
      return session;
    } catch (e) {
      await session.dispose();
      throw e;
    }
  }
  async function identity(
    session: ReturnType<typeof sessionFactory>,
    signal: AbortSignal,
  ) {
    const binding = await productionCandidate(
      root,
      projectPath,
      fullProject,
      'videobench-whole-project',
      session.builds,
    );
    if (binding.projectSha256 !== outputIdentity(projectBytes))
      throw Error('Project changed after source resolution');
    // Structured source is the exact project bytes. Foreign source uses the existing closure identity.
    if (!binding.sourceSha256) binding.sourceSha256 = binding.projectSha256;
    const report = session.performanceReport();
    return {
      binding,
      renderDigest: (await hashRetainedArtifact(root, renderOutput)).sha256,
      durationMs: (durationFrames * 1000) / project.fps,
      environment: {
        platform: `${platform()}-${arch()}-${release()}`,
        runtime: `node-${process.version}`,
        fontsDigest: await fontsDigest(signal),
        rasterizer: `chromium-${report.browserVersion}-deterministic-export`,
      },
      tool,
      config: {
        profile: 'deterministic-export',
        backend: 'playwright-element',
        fps: project.fps,
        width: project.canvas.width,
        height: project.canvas.height,
        'source-mode': 'exact-production-session-replay',
        'source-frame-limit': 18000,
        'source-frame-count': durationFrames,
        'output-decoding': 'native-size-indexed-cfr',
      },
    };
  }
  return {
    async resolve(signal) {
      const session = await prepare(signal);
      try {
        expected = await identity(session, signal);
        const media = await probe(outputFile, { signal, timeoutMs: 30000 });
        if (
          media.sha256 !== expected.renderDigest ||
          media.width !== project.canvas.width ||
          media.height !== project.canvas.height ||
          media.variableFrameRate ||
          Math.abs((media.averageFrameRate ?? 0) - project.fps) > 1e-6 ||
          Math.abs(media.durationMs - expected.durationMs) > 1
        )
          throw Error(
            'Output media timing/dimensions inconsistent with candidate',
          );
        const result = await run(
          'ffprobe',
          [
            '-v',
            'error',
            '-protocol_whitelist',
            'file,pipe',
            '-select_streams',
            'v:0',
            '-show_frames',
            '-show_streams',
            '-show_entries',
            'frame=best_effort_timestamp:stream=time_base',
            '-of',
            'json',
            outputFile,
          ],
          { signal, timeoutMs: 30000, maxBytes: 4 * 1024 * 1024 },
        );
        const decoded = JSON.parse(result.stdout.toString()) as {
          frames: { best_effort_timestamp: number }[];
          streams: { time_base: string }[];
        };
        const timeBase = decoded.streams[0]?.time_base.split('/').map(Number);
        if (
          !timeBase ||
          timeBase.length !== 2 ||
          timeBase.some((v) => !Number.isSafeInteger(v) || v <= 0)
        )
          throw Error('Output time base is unavailable');
        timeline = decoded.frames.map((f) =>
          Number.isSafeInteger(f.best_effort_timestamp)
            ? (f.best_effort_timestamp * timeBase[0]! * 1000) / timeBase[1]!
            : NaN,
        );
        if (
          timeline.length !== durationFrames ||
          timeline.length > 18000 ||
          timeline.some(
            (t, i) =>
              !Number.isFinite(t) ||
              Math.abs(t - (i * 1000) / project.fps) > 1e-6,
          )
        )
          throw Error(
            'Output timeline cannot supply exact production timestamps',
          );
        return expected;
      } finally {
        await session.dispose();
      }
    },
    async capture(times, signal, maxBytes) {
      if (
        !expected ||
        (await hashRetainedArtifact(root, renderOutput)).sha256 !==
          expected.renderDigest
      )
        throw Error('Output bytes changed');
      const indices = times.map((time) => {
        const frameIndex = timeline.findIndex((t) => Math.abs(t - time) < 1e-6);
        if (frameIndex < 0)
          throw Error('Requested time lacks exact decoded timestamp');
        return frameIndex;
      });
      const frames = await frameBytesBatch(outputFile, indices, {
        signal,
        timeoutMs: 60000,
        maxBytes,
        nativeSize: true,
      });
      if (
        (await hashRetainedArtifact(root, renderOutput)).sha256 !==
        expected.renderDigest
      )
        throw Error('Output changed during decoding');
      return frames;
    },
    async evaluate(times, signal, maxBytes) {
      if (!expected) throw Error('Resolve candidate before capture');
      const session = await prepare(signal);
      try {
        const before = await identity(session, signal);
        if (
          canonicalDigest('videobench/source-stability-v1', before) !==
          canonicalDigest('videobench/source-stability-v1', expected)
        )
          throw Error('Production source/output/environment changed');
        const frames: Buffer[] = [];
        let bytes = 0;
        for (const time of times) {
          const exact = (time * project.fps) / 1000,
            frame = Math.round(exact);
          // Existing FrameEvidence cannot store both requested/actual times. Reject imprecise requests.
          if (
            Math.abs(frame - exact) > 1e-6 ||
            frame < 0 ||
            frame >= durationFrames
          )
            throw Error('Timestamp must select an exact production frame');
          const png = (await session.renderFrame(session.contextAt(frame)))
            .source;
          bytes += png.length;
          if (bytes > maxBytes) throw Error('Evaluation byte budget exceeded');
          frames.push(png);
        }
        const after = await identity(session, signal);
        if (
          canonicalDigest('videobench/source-stability-v1', after) !==
          canonicalDigest('videobench/source-stability-v1', before)
        )
          throw Error('Production identity changed during capture');
        return { frames, environment: before.environment };
      } finally {
        await session.dispose();
      }
    },
    pixels: pngPixels,
    grid: pngGrid,
  };
}

export async function videoBenchCommand(args: string[]) {
  if (args.length === 1 && ['--help', 'help'].includes(args[0]!))
    return {
      commands: [
        'identify',
        'capture',
        'diagnose',
        'review-pack',
        'review-import',
        'report',
        'qualification-freeze',
        'holdout-preflight',
        'holdout-consume',
        'holdout-reconcile',
        'holdout-status',
        'holdout-init',
        'holdout-retire',
      ],
      scope:
        'Engineering toolkit, not a qualified creative judge. Creative judgment, independent reviewer qualification and automatic creative superiority remain experimental and have not completed formal qualification.',
      qualification:
        'Report V2 requires an independently verified qualification freeze. Holdout must be consumed before exposure.',
    };
  if (
    [
      'review-pack',
      'review-import',
      'report',
      'holdout-reconcile',
      'holdout-status',
      'holdout-init',
      'holdout-retire',
      'qualification-freeze',
      'holdout-preflight',
      'holdout-consume',
    ].includes(args[0] ?? '')
  )
    return videoBenchReviewCommand(args);
  const [command, file, ...rest] = args;
  if (command === 'identify') {
    if (!file || rest.length !== 1 || rest[0] !== '--json')
      throw Error('Usage: scenewire videobench identify <request.json> --json');
    const request = z
      .object({
        id: benchmarkCandidateSchema.shape.id,
        projectId: benchmarkCandidateSchema.shape.projectId,
        project: relativePathSchema,
        renderOutput: relativePathSchema,
      })
      .strict()
      .parse(JSON.parse(await readFile(file, 'utf8')));
    const adapter = await createVideoBenchAdapter(
      dirname(resolve(file)),
      request.project,
      request.renderOutput,
    );
    const actual = await adapter.resolve(AbortSignal.timeout(180000));
    return benchmarkCandidateSchema.parse({
      version: 1,
      id: request.id,
      projectId: request.projectId,
      binding: actual.binding,
      productionCandidateDigest: candidateIdentity(actual.binding),
      renderDigest: actual.renderDigest,
      durationMs: actual.durationMs,
      rasterSensitive: true,
      environment: actual.environment,
    });
  }

  if (
    !file ||
    !['capture', 'diagnose'].includes(command ?? '') ||
    (command === 'capture'
      ? rest.length !== 3 || rest[0] !== '--output' || rest[2] !== '--json'
      : rest.length !== 3 || rest[0] !== '--expected' || rest[2] !== '--json')
  )
    throw Error(
      'Usage: scenewire videobench capture <request.json> --output <new-directory> --json | diagnose <bundle-directory> --expected <request.json> --json',
    );
  if (command === 'diagnose') {
    const request = JSON.parse(
      await readFile(rest[1]!, 'utf8'),
    ) as VideoBenchCaptureRequest;
    if (!/^[a-f0-9]{64}$/.test(request.evidenceDigest ?? ''))
      throw Error(
        'Diagnose requires independently retained evidenceDigest in expected request',
      );
    const result = await validateMaterializedEvidence(
      resolve(file),
      {
        candidate: benchmarkCandidateSchema.parse(request.candidate),
        plan: request.plan,
        semanticDigest: request.evidenceDigest,
        caseId: request.plan.caseId,
        arm: request.plan.arm,
      },
      { pixels: pngPixels, grid: pngGrid },
    );
    if (!result.valid) throw Error(result.errors.join('; '));
    const raw = result.bundle.evidence.find((e) => e.kind === 'diagnostic')!;
    if (raw.kind !== 'diagnostic') throw Error('Missing diagnostic artifact');
    return {
      valid: true,
      technical: result.bundle.technical,
      diagnostics: JSON.parse(
        await readFile(
          await retainedEvidencePath(resolve(file), raw.artifact.path),
          'utf8',
        ),
      ),
    };
  }
  const request = JSON.parse(
    await readFile(file, 'utf8'),
  ) as VideoBenchCaptureRequest;
  const candidate = benchmarkCandidateSchema.parse(request.candidate);
  const adapter = await createVideoBenchAdapter(
    dirname(resolve(file)),
    request.project,
    request.renderOutput,
  );
  return materializeVideoBenchEvidence(
    candidate,
    request.plan,
    adapter,
    rest[1]!,
  );
}
