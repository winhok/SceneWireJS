import {
  lstat,
  mkdir,
  readdir,
  readFile,
  writeFile,
  rm,
  cp,
  access,
  stat,
} from 'node:fs/promises';
import { join, resolve, dirname, parse } from 'node:path';
import { constants, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import {
  projectSchema,
  CURRENT_PROJECT_VERSION,
  projectDiagnostics,
  serializeProject,
} from '@scenewirejs/schema';
import { createEngineRegistry } from '@scenewirejs/director-core';
import { installedEngineRegistry, projectPackageRoot } from './director';
import { writeScaffold } from './scaffold';
const execute = promisify(execFile);
export const ownedSkills = [
  'scenewire',
  'scenewire-create',
  'scenewire-direct',
  'scenewire-edit',
  'scenewire-review',
  'scenewire-reference',
  'scenewire-footage',
];
export async function packageManager(
  directory: string,
): Promise<'pnpm' | 'npm' | 'yarn' | undefined> {
  const root = projectPackageRoot(directory);
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const name = pkg.packageManager?.split('@')[0];
    if (['pnpm', 'npm', 'yarn'].includes(name)) return name;
  } catch {
    /* Check actual lock files next. */
  }
  const found: ('pnpm' | 'npm' | 'yarn')[] = [];
  for (const [file, name] of [
    ['pnpm-lock.yaml', 'pnpm'],
    ['package-lock.json', 'npm'],
    ['yarn.lock', 'yarn'],
  ] as const)
    if (
      await access(join(root, file)).then(
        () => true,
        () => false,
      )
    )
      found.push(name);
  if (found.length) return found.length === 1 ? found[0] : undefined;
  // pnpm workspace installs keep the lock at the workspace root. Only use an
  // ancestor when its actual workspace file and manager declaration agree.
  let ancestor = dirname(root);
  while (ancestor !== dirname(ancestor)) {
    try {
      await access(join(ancestor, 'pnpm-workspace.yaml'));
      const pkg = JSON.parse(
        await readFile(join(ancestor, 'package.json'), 'utf8'),
      );
      if (
        typeof pkg.packageManager === 'string' &&
        pkg.packageManager.startsWith('pnpm@')
      )
        return 'pnpm';
      return undefined;
    } catch {
      /* No proved workspace ownership here. */
    }
    ancestor = dirname(ancestor);
  }
  return undefined;
}
/** Reject traversal and every existing symlink component, including parent aliases. */
export async function safeDestination(directory: string) {
  if (directory.split(/[\\/]/).includes('..'))
    throw new Error('Destination traversal is unsupported');
  const logical = resolve(directory);
  const systemAlias =
    process.platform === 'darwin'
      ? ['/tmp', '/var'].find(
          (alias) => logical === alias || logical.startsWith(alias + '/'),
        )
      : undefined;
  const target = systemAlias
    ? join(realpathSync(systemAlias), logical.slice(systemAlias.length))
    : logical;
  let current = parse(target).root;
  for (const part of target
    .slice(current.length)
    .split(/[\\/]/)
    .filter(Boolean)) {
    current = join(current, part);
    const st = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (st?.isSymbolicLink())
      throw new Error('Destination symlink is unsupported');
    if (st && !st.isDirectory())
      throw new Error('Destination must be a directory');
  }
  return target;
}
export function starterProject(engineId: string) {
  const engine = createEngineRegistry().getEngine(engineId);
  if (!engine) throw new Error(`Unknown engine: ${engineId}`);
  const date = new Date().toISOString();
  return projectSchema.parse({
    id: 'starter',
    version: CURRENT_PROJECT_VERSION,
    metadata: { title: 'SceneWire starter', createdAt: date, updatedAt: date },
    canvas: { width: 1280, height: 720, background: '#101827' },
    fps: 30,
    seed: 1,
    theme: {
      name: 'starter',
      fontFamily: 'sans-serif',
      foreground: '#ffffff',
      accent: '#53d5b0',
    },
    scenes: [
      {
        id: 'scene-01',
        name: 'Hello SceneWire',
        startFrame: 0,
        durationFrames: 60,
      },
    ],
    assets: engine.scaffoldId
      ? [
          {
            id: 'composition-01',
            type: 'composition',
            rendererId: 'web',
            src: 'compositions/scene-01/composition.json',
          },
        ]
      : [],
    tracks: [
      {
        id: 'visual-01',
        name: 'Visual',
        type: 'visual',
        clips: [
          engine.scaffoldId
            ? {
                id: 'clip-01',
                component: 'ForeignComposition',
                startFrame: 0,
                durationFrames: 60,
                transform: {},
                props: {
                  assetId: 'composition-01',
                  placement: 'replace-scene',
                },
              }
            : {
                id: 'clip-01',
                component: 'Text',
                startFrame: 0,
                durationFrames: 60,
                transform: { x: 160, y: 280, width: 960, height: 100 },
                props: { text: 'Hello SceneWire', fontSize: 64 },
              },
        ],
      },
    ],
    markers: [],
  });
}
/** Windows package managers are cmd launchers. Only fixed, validated manager
 * names and the literal install action enter cmd; project paths remain cwd. */
export function dependencyInstallInvocation(
  manager: 'pnpm' | 'npm' | 'yarn',
  platform: NodeJS.Platform = process.platform,
) {
  // A newly generated project has new dependencies and no reusable lockfile.
  // Explicit --install authorizes creating/updating it, including under CI.
  const args =
    manager === 'pnpm' ? ['install', '--no-frozen-lockfile'] : ['install'];
  return platform === 'win32'
    ? {
        command: 'cmd.exe',
        args: ['/d', '/s', '/c', `${manager} ${args.join(' ')}`],
      }
    : { command: manager, args };
}
export async function initProject(args: string[]) {
  let directory = '.',
    engineId = 'web-dom';
  const flags = new Set<string>();
  let hasDirectory = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--engine') {
      if (flags.has(arg) || !args[i + 1]) throw Error('Invalid init engine');
      flags.add(arg);
      engineId = args[++i]!;
    } else if (['--yes', '--install', '--json', '--skills'].includes(arg)) {
      if (flags.has(arg)) throw Error('Duplicate init flag');
      flags.add(arg);
    } else if (!arg.startsWith('-') && !hasDirectory) {
      directory = arg;
      hasDirectory = true;
    } else
      throw Error(
        'Usage: scenewire init [directory] [--engine id] [--yes] [--install] [--skills] [--json]',
      );
  }
  const project = starterProject(engineId),
    engine = createEngineRegistry().getEngine(engineId)!;
  const target = await safeDestination(directory);
  const exists = await access(target).then(
    () => true,
    () => false,
  );
  if (exists && (await readdir(target)).length)
    throw Error('Destination is non-empty; init never overwrites');
  const manager = await packageManager(exists ? target : dirname(target));
  const cliVersion = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ).version as string;
  const dependencies = Object.fromEntries(
    (engine.authoringDependencies ?? []).map((id) => {
      const range = id.startsWith('@scenewirejs/')
        ? cliVersion
        : engine.authoringDependencyRanges?.[id];
      if (!range || range === '*')
        throw Error(
          `Engine ${engineId} has no authoring compatibility range for ${id}`,
        );
      return [id, range];
    }),
  );
  const created: string[] = [];
  if (!exists) await mkdir(target); // Parent must exist; no implicit tree creation.
  try {
    for (const [name, content] of [
      ['project.json', serializeProject(project)],
      [
        'package.json',
        JSON.stringify(
          {
            name: 'scenewire-starter',
            private: true,
            type: 'module',
            dependencies,
          },
          null,
          2,
        ) + '\n',
      ],
    ] as const) {
      await writeFile(join(target, name), content, { flag: 'wx' });
      created.push(name);
    }
    if (engine.scaffoldId) {
      await mkdir(join(target, 'compositions'));
      created.push('compositions');
      await writeScaffold(engineId, join(target, 'compositions', 'scene-01'));
    }
    if (flags.has('--skills')) {
      const resource = join(dirname(fileURLToPath(import.meta.url)), 'skills');
      await mkdir(join(target, '.agents', 'skills'), { recursive: true });
      created.push('.agents');
      for (const skill of ownedSkills)
        await cp(
          join(resource, skill),
          join(target, '.agents', 'skills', skill),
          { recursive: true, errorOnExist: true, force: false },
        );
    }
  } catch (error) {
    for (const name of created.reverse())
      await rm(join(target, name), { recursive: true, force: true });
    if (!exists) await rm(target, { recursive: true, force: true });
    throw error;
  }
  let installation: 'not-requested' | 'unresolved' | 'installed' =
    'not-requested';
  const installCommand = `${manager ?? 'npm'} ${dependencyInstallInvocation(manager ?? 'npm', 'linux').args.join(' ')}`;
  if (flags.has('--install')) {
    if (!manager) installation = 'unresolved';
    else {
      const invocation = dependencyInstallInvocation(manager);
      await execute(invocation.command, invocation.args, {
        cwd: target,
        timeout: 300000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
      });
      installation = 'installed';
    }
  }
  return {
    valid: true,
    directory: target,
    engine: engineId,
    installation,
    packageManager: manager ?? null,
    installCommand,
    skills: flags.has('--skills') ? ownedSkills : [],
    engines: installedEngineRegistry(target).listEngines(),
    next: [
      'scenewire doctor',
      'scenewire render-check project.json',
      'scenewire render project.json --output video.mp4',
    ],
  };
}
export async function doctor(directory = process.cwd()) {
  const tool = async (name: string) => {
    try {
      const result = await execute(name, ['-version'], {
        timeout: 5000,
        maxBuffer: 64000,
      });
      return { available: true, version: result.stdout.split('\n')[0] };
    } catch {
      return { available: false, remediation: `Install ${name} on PATH` };
    }
  };
  const [ffmpeg, ffprobe] = await Promise.all([
    tool('ffmpeg'),
    tool('ffprobe'),
  ]);
  let browser: { available: boolean; source: string; remediation?: string } = {
    available: false,
    source: 'unresolved',
    remediation: 'Install Playwright Chromium or set SCENEWIRE_CHROMIUM_PATH',
  };
  try {
    let executable = process.env.SCENEWIRE_CHROMIUM_PATH;
    if (!executable) {
      // Resolve through the installed renderer; never rely on a transitive consumer import.
      const renderer = createRequire(import.meta.url).resolve(
        '@scenewirejs/renderer-web',
      );
      const requireRenderer = createRequire(renderer);
      const { chromium } = requireRenderer('playwright') as {
        chromium: { executablePath(): string };
      };
      executable = chromium.executablePath();
    }
    browser = {
      available: await access(executable!, constants.X_OK).then(
        async () => (await stat(executable!)).isFile(),
        () => false,
      ),
      source: process.env.SCENEWIRE_CHROMIUM_PATH
        ? 'configured'
        : 'playwright-managed',
      remediation: 'Install Playwright Chromium or set SCENEWIRE_CHROMIUM_PATH',
    };
  } catch {
    /* Report absence without launching GPU/browser. */
  }
  const engineRegistry = installedEngineRegistry(directory);
  let authoringReady = true;
  let project: {
    present: boolean;
    valid?: boolean;
    issues?: ReturnType<typeof projectDiagnostics>;
  } = { present: false };
  try {
    const data = JSON.parse(
      await readFile(join(directory, 'project.json'), 'utf8'),
    );
    const issues = projectDiagnostics(data);
    project = { present: true, valid: !issues.length, issues };
    if (!issues.length) {
      const parsed = projectSchema.parse(data);
      for (const asset of parsed.assets) {
        if (asset.type !== 'composition') continue;
        try {
          const manifest = JSON.parse(
            await readFile(join(directory, asset.src), 'utf8'),
          );
          const engine = engineRegistry.getEngine(manifest.engine ?? 'web-dom');
          if (
            !engine ||
            engine.availability !== 'available' ||
            engine.authoringAvailability !== 'complete'
          ) {
            authoringReady = false;
            issues.push({
              code: 'doctor.authoring.incomplete',
              path: ['assets', parsed.assets.indexOf(asset)],
              message: 'Selected engine authoring dependencies are incomplete',
              details: {
                engine: manifest.engine ?? 'web-dom',
                missing: engine?.missingAuthoringDependencies ?? [],
              },
            });
          }
        } catch {
          authoringReady = false;
          issues.push({
            code: 'doctor.composition.read',
            path: ['assets', parsed.assets.indexOf(asset)],
            message: 'Composition manifest cannot be read',
          });
        }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      project = {
        present: true,
        valid: false,
        issues: [
          {
            code: 'project.read',
            path: [],
            message: 'Project JSON cannot be read',
          },
        ],
      };
  }
  let version = 'unknown';
  try {
    version = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ).version;
  } catch {
    /* source invocation */
  }
  const engines = engineRegistry.listEngines();
  const nodeSupported =
    Number(process.versions.node.split('.')[0]) >= 22 &&
    (Number(process.versions.node.split('.')[0]) > 22 ||
      Number(process.versions.node.split('.')[1]) >= 12);
  return {
    version,
    authoringReady,
    node: process.versions.node,
    nodeSupported,
    packageManager: (await packageManager(directory)) ?? null,
    ffmpeg,
    ffprobe,
    browser,
    project,
    engines,
    valid:
      nodeSupported &&
      ffmpeg.available &&
      ffprobe.available &&
      browser.available &&
      project.valid !== false &&
      authoringReady,
  };
}
