import { stripFrames, parseCrop, reviewSvg } from './review-tools';
import { projectDiagnostics } from '@scenewirejs/schema';
import { referenceCommand } from './reference';
import { productionCommand } from './production';
import { validateVersionedVisualPlan } from '@scenewirejs/director-core';
import {
  frameTimeoutFlags,
  timeoutOptions,
  selectedFrames,
} from './render-options';
import { installedEngineRegistry, humanEngines } from './director';
import { scaffold } from './scaffold';
import { initProject, doctor, packageManager } from './onboarding';
import { readFile, open, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { parseProject, serializeProject } from '@scenewirejs/schema';
import { createPrimitiveRegistry } from '@scenewirejs/runtime';
import { createDeveloperRegistry } from '@scenewirejs/domain-developer';
import { createEducationRegistry } from '@scenewirejs/domain-education';
import { createEditorialRegistry } from '@scenewirejs/domain-editorial';
import {
  inspectProject,
  inspectScene,
  inspectClip,
  validateProjectForEditing,
  dryRunPatchPlan,
  PatchError,
} from '@scenewirejs/patch';
const registry = [
  ...createPrimitiveRegistry(),
  ...createDeveloperRegistry(),
  ...createEducationRegistry(),
  ...createEditorialRegistry(),
];
const emit = (value: unknown) =>
  process.stdout.write(`${JSON.stringify(value)}\n`);
let rendererError:
  typeof import('@scenewirejs/renderer-web').RenderError | undefined;
async function main(args: string[]) {
  const [command, file, ...rest] = args;
  if (command === 'init') {
    const result = await initProject(args.slice(1));
    if (args.includes('--json')) emit(result);
    else
      process.stdout.write(
        `Created ${result.engine} project in ${result.directory}\n${result.installation === 'installed' ? 'Dependencies installed' : `Install dependencies explicitly: ${result.installCommand}`}\n${result.next.join('\n')}\n`,
      );
    if (result.installation === 'unresolved') process.exitCode = 1;
    return;
  }
  if (command === 'doctor') {
    if ((file && file !== '--json') || rest.length)
      throw Error('Usage: scenewire doctor [--json]');
    const result = await doctor();
    if (file === '--json') emit(result);
    else
      process.stdout.write(
        `SceneWire ${result.version}\nNode ${result.node}: ${result.nodeSupported ? 'supported' : 'unsupported'}\nPackage manager: ${result.packageManager ?? 'undetermined'}\nFFmpeg: ${result.ffmpeg.available ? 'available' : 'missing'}\nffprobe: ${result.ffprobe.available ? 'available' : 'missing'}\nChromium: ${result.browser.available ? 'available' : result.browser.remediation}\nProject: ${!result.project.present ? 'absent' : result.project.valid ? 'valid' : 'invalid'}\n${humanEngines(result.engines, result.packageManager ?? 'pnpm')}`,
      );
    if (!result.valid) process.exitCode = 1;
    return;
  }

  if (command === 'final-media-qc') {
    if (!file || rest.length)
      throw Error('Usage: scenewire final-media-qc <final-video>');
    const { inspectFinalMedia } = await import('@scenewirejs/media-inspect');
    const controller = new AbortController(),
      cancel = () => controller.abort();
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    try {
      emit(await inspectFinalMedia(file, { signal: controller.signal }));
    } finally {
      process.removeListener('SIGINT', cancel);
      process.removeListener('SIGTERM', cancel);
    }
    return;
  }
  if (command && ['media', 'reference', 'reference-check'].includes(command)) {
    const result = await referenceCommand(command, args.slice(1));
    emit(result);
    if ('valid' in result && !result.valid) process.exitCode = 1;
    return;
  }
  if (
    command &&
    [
      'brief-check',
      'sources-check',
      'narrative-check',
      'production-init',
      'production-check',
    ].includes(command)
  ) {
    if (!file) throw new Error('Production command requires an input file');
    const report = await productionCommand(command, file, rest);
    emit(report);
    if (!report.valid) process.exitCode = 1;
    return;
  }
  if (command === 'engines') {
    if ((file && file !== '--json') || rest.length)
      throw new Error('Usage: scenewire engines [--json]');
    const engines = installedEngineRegistry().listEngines();
    return file === '--json'
      ? emit(engines)
      : process.stdout.write(
          humanEngines(
            engines,
            (await packageManager(process.cwd())) ?? 'pnpm',
          ),
        );
  }
  if (command === 'scaffold') {
    if (!file || rest.length !== 1)
      throw new Error('Usage: scenewire scaffold <engine> <new-directory>');
    return emit(await scaffold(file, rest[0]!));
  }
  if (command === 'plan-check') {
    if (
      !file ||
      (rest.length && !(rest.length === 2 && rest[0] === '--project'))
    )
      throw new Error(
        'Usage: scenewire plan-check <plan.json> [--project <project.json>]',
      );
    const scenes = rest.length
      ? parseProject(await readFile(rest[1]!, 'utf8')).scenes
      : undefined;
    const report = validateVersionedVisualPlan(
      JSON.parse(await readFile(file, 'utf8')),
      installedEngineRegistry(),
      { scenes },
    );
    emit(report);
    if (!report.valid) process.exitCode = 1;
    return;
  }
  if (!file)
    throw new Error(
      'Usage: scenewire inspect|inspect-scene|inspect-clip|validate|patch <project.json> ...',
    );
  const projectText = await readFile(file, 'utf8');
  const mediaIssues = projectDiagnostics(JSON.parse(projectText));
  if (mediaIssues.length) {
    emit({ valid: false, issues: mediaIssues });
    process.exitCode = 1;
    return;
  }
  const project = parseProject(projectText);
  if (
    [
      'capture',
      'contact-sheet',
      'frame-strip',
      'render-check',
      'render',
      'preview',
    ].includes(command ?? '')
  ) {
    const { WebRendererSession, renderCheck, RenderError } =
      await import('@scenewirejs/renderer-web');
    rendererError = RenderError;
    const { writeDebugPreview } =
      await import('@scenewirejs/renderer-web/preview');
    const { renderVideo } = await import('@scenewirejs/renderer-web/export');
    const flags = new Map<string, string>();
    for (let index = 0; index < rest.length; index += 2) {
      const flag = rest[index]!,
        value = rest[index + 1];
      if (
        ![
          ...(command === 'preview'
            ? ['--prepare-timeout-ms']
            : frameTimeoutFlags),
          ...(command === 'render'
            ? ['--render-timeout-ms', '--audio-stall-timeout-ms']
            : []),
          ...(command === 'capture'
            ? ['--frame', '--output', '--crop']
            : command === 'contact-sheet'
              ? ['--frames', '--output', '--crop']
              : command === 'frame-strip'
                ? ['--start-frame', '--end-frame', '--output', '--crop']
                : command === 'render-check'
                  ? ['--frames']
                  : command === 'render'
                    ? [
                        '--output',
                        '--start-frame',
                        '--end-frame',
                        '--profile',
                        '--workers',
                        '--chunk-frames',
                      ]
                    : ['--output', '--profile']),
        ].includes(flag) ||
        value === undefined ||
        flags.has(flag)
      )
        throw new Error('Invalid render arguments');
      flags.set(flag, value);
    }
    if (
      flags.has('--profile') &&
      !['preview', 'deterministic-export'].includes(flags.get('--profile')!)
    )
      throw new Error('Invalid render profile');
    const timeouts = timeoutOptions(flags);
    const controller = new AbortController(),
      cancel = () => controller.abort();
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    const options = {
      ...timeouts,
      project,
      projectRoot: dirname(resolve(file)),
      signal: controller.signal,
      profile: flags.get('--profile') as
        'preview' | 'deterministic-export' | undefined,
    };
    try {
      if (command === 'render-check')
        return emit(
          await renderCheck(
            options,
            flags.has('--frames')
              ? selectedFrames(flags.get('--frames')!)
              : undefined,
          ),
        );
      const output = flags.get('--output');
      if (!output) throw new Error('--output is required');
      if (command === 'preview')
        return emit(await writeDebugPreview(options, output));
      if (command === 'render') {
        const range =
          flags.has('--start-frame') || flags.has('--end-frame')
            ? {
                startFrame: Number(flags.get('--start-frame')),
                endFrame: Number(flags.get('--end-frame')),
              }
            : undefined;
        return emit(
          await renderVideo({
            ...options,
            output,
            range,
            workers: flags.has('--workers')
              ? flags.get('--workers') === 'auto'
                ? 'auto'
                : Number(flags.get('--workers'))
              : undefined,
            chunkFrames: flags.has('--chunk-frames')
              ? Number(flags.get('--chunk-frames'))
              : undefined,
            onAudioProgress(progress) {
              process.stderr.write(
                `${JSON.stringify({ code: 'render.audio', ...progress })}\n`,
              );
            },
            onRenderProgress(progress) {
              if (
                progress.phase !== 'render' ||
                progress.framesCompleted % project.fps === 0 ||
                progress.framesCompleted === progress.framesTotal
              )
                process.stderr.write(
                  `${JSON.stringify({ code: 'render.progress', ...progress })}\n`,
                );
            },
          }),
        );
      }
      const crop = flags.has('--crop')
        ? parseCrop(flags.get('--crop')!, project.canvas)
        : undefined;
      if (crop && !output.endsWith('.svg'))
        throw Error('Cropped evidence requires an .svg output');
      const frames =
        command === 'frame-strip'
          ? stripFrames(
              Number(flags.get('--start-frame')),
              Number(flags.get('--end-frame')),
              Math.max(
                ...project.scenes.map((s) => s.startFrame + s.durationFrames),
              ),
            )
          : command === 'capture'
            ? [Number(flags.get('--frame'))]
            : selectedFrames(flags.get('--frames') ?? '');
      if (
        (command === 'capture' && !flags.has('--frame')) ||
        !frames.length ||
        frames.some((frame) => !Number.isInteger(frame) || frame < 0)
      )
        throw new Error('Valid frame selection required');
      const session = new WebRendererSession(options);
      try {
        await session.prepare();
        const images: Buffer[] = [];
        for (const frame of frames)
          images.push(
            (await session.renderFrame(session.contextAt(frame))).source,
          );
        if (command === 'capture' && !crop)
          await writeFile(output, images[0]!, { flag: 'wx' });
        else {
          const svg = reviewSvg(frames, images, project.canvas, crop);
          await writeFile(output, svg, { flag: 'wx' });
        }
        await session.dispose();
        return emit({
          output,
          frames,
          performance: session.performanceReport(),
        });
      } finally {
        await session.dispose();
      }
    } finally {
      process.removeListener('SIGINT', cancel);
      process.removeListener('SIGTERM', cancel);
    }
  }
  if (command === 'inspect' && rest.length === 0)
    return emit(inspectProject(project, registry));
  if (command === 'inspect-scene' && rest.length === 1)
    return emit(inspectScene(project, rest[0]!));
  if (command === 'inspect-clip' && rest.length === 1)
    return emit(inspectClip(project, rest[0]!));
  if (command === 'validate' && rest.length === 0) {
    const issues = validateProjectForEditing(project, registry),
      valid = !issues.some((i) => i.severity === 'error');
    emit({ valid, issues });
    if (!valid) {
      process.stderr.write(
        `${JSON.stringify({ code: 'project.invalid', issues })}\n`,
      );
      process.exitCode = 1;
    }
    return;
  }
  if (command === 'patch') {
    const [patchFile, flag, output, ...extra] = rest;
    if (
      !patchFile ||
      extra.length ||
      !(
        (flag === '--dry-run' && output === undefined) ||
        (flag === '--output' && output)
      )
    )
      throw new Error(
        'Usage: scenewire patch <project.json> <patch.json> --dry-run | --output <new.json>',
      );
    if (output && [file, patchFile].some((f) => resolve(f) === resolve(output)))
      throw new Error('Output must differ from both inputs');
    const plan: unknown = JSON.parse(await readFile(patchFile, 'utf8'));
    const report = dryRunPatchPlan(project, plan, registry);
    if (!report.valid) throw new PatchError(report.issues);
    if (output) {
      // Exclusive creation protects existing files and symlinks, including aliases to inputs.
      await realpath(file);
      const handle = await open(output, 'wx');
      try {
        await handle.writeFile(
          serializeProject(report.resultingProject!),
          'utf8',
        );
      } finally {
        await handle.close();
      }
    }
    const { resultingProject: _candidate, ...summary } = report;
    void _candidate;
    return emit({ ...summary, ...(output ? { output } : {}) });
  }
  throw new Error('Unknown command or unexpected arguments');
}
main(process.argv.slice(2)).catch((cause: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ code: 'cli.error', ...(rendererError && cause instanceof rendererError ? { diagnostic: cause.diagnostic } : {}), issues: cause instanceof PatchError ? cause.issues : [{ severity: 'error', code: 'cli.error', message: cause instanceof Error ? cause.message : String(cause) }] })}\n`,
  );
  process.exitCode = 1;
});
