import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  realpathSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, relative, dirname, sep } from 'node:path';
const repository = realpathSync(process.cwd()),
  artifacts = resolve('.build/npm');
const report = JSON.parse(readFileSync(join(artifacts, 'manifest.json')));
const consumer = realpathSync(
  mkdtempSync(join(tmpdir(), 'scenewire-npm-consumer-')),
);
if (!relative(repository, realpathSync(consumer)).startsWith('..'))
  throw Error('Consumer must be outside checkout');
const npmCli = [
  join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
].find(existsSync);
if (!npmCli) throw Error('Cannot locate installed Node npm CLI');
const command = (file, args) =>
  execFileSync(
    file === 'npm' ? process.execPath : file,
    file === 'npm' ? [npmCli, ...args] : args,
    {
      cwd: consumer,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_PATH: '',
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
      },
      timeout: 180000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
writeFileSync(
  join(consumer, 'package.json'),
  JSON.stringify({
    name: 'scenewire-clean-consumer',
    private: true,
    type: 'module',
    // Bind the whole unpublished release train to local tarballs. Root overrides
    // prevent npm from consulting the registry for transitive SceneWire edges.
    dependencies: Object.fromEntries([
      ...report.packages.map((p) => [
        p.name,
        'file:' + join(artifacts, p.tarball),
      ]),
      ['typescript', '6.0.2'],
    ]),
    overrides: Object.fromEntries(
      report.packages.map((p) => [p.name, '$' + p.name]),
    ),
  }),
);
command('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
const libraries = report.packages.filter((p) => p.exports);
writeFileSync(
  join(consumer, 'imports.mjs'),
  `import {realpathSync} from 'node:fs';import {fileURLToPath} from 'node:url';\n` +
    libraries
      .map(
        (p) =>
          `if(!realpathSync(fileURLToPath(import.meta.resolve('${p.name}'))).startsWith(${JSON.stringify(join(consumer, 'node_modules') + sep)}))throw Error('Repository resolution');await import('${p.name}');`,
      )
      .join('\n') +
    "\nconsole.log('All 19 Node ESM roots PASS');",
);
const imports = command('node', ['imports.mjs']);
writeFileSync(
  join(consumer, 'consumer.ts'),
  libraries
    .map((p, i) => `import * as p${i} from '${p.name}'; void p${i};`)
    .join('\n') +
    "\nimport {renderVideo} from '@scenewirejs/renderer-web/export'; void renderVideo;\nimport * as preview from '@scenewirejs/renderer-web/preview'; void preview;\n",
);
writeFileSync(
  join(consumer, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    },
    include: ['consumer.ts'],
  }),
);
command(process.execPath, [
  join(consumer, 'node_modules/typescript/bin/tsc'),
  '-p',
  'tsconfig.json',
]);
const cli = join(consumer, 'node_modules/@scenewirejs/cli/dist/scenewire.js');
const cliCommand = (args) => command(process.execPath, [cli, ...args]);
const initialEngines = JSON.parse(cliCommand(['engines', '--json']));
for (const id of ['web-react', 'web-pixi', 'web-three'])
  if (initialEngines.find((e) => e.id === id)?.availability !== 'unavailable')
    throw Error(`Unexpected optional engine before install: ${id}`);
let chromium = process.env.SCENEWIRE_CHROMIUM_PATH;
if (!chromium) {
  chromium = command('node', [
    '--input-type=module',
    '-e',
    "import {chromium} from 'playwright'; console.log(chromium.executablePath())",
  ]).trim();
  if (!existsSync(chromium))
    throw Error(
      'Install Chromium with npx playwright install chromium, or supply SCENEWIRE_CHROMIUM_PATH',
    );
}
// The fixture is generated with the installed CLI, not copied from repository source.
const project = {
  id: 'npm-project',
  version: 9,
  seed: 1,
  metadata: {
    title: 'npm fixture',
    createdAt: '2026-09-29T00:00:00Z',
    updatedAt: '2026-09-29T00:00:00Z',
  },
  canvas: { width: 320, height: 180, background: '#101827' },
  fps: 30,
  theme: {
    name: 'npm',
    fontFamily: 'sans-serif',
    foreground: '#ffffff',
    accent: '#53d5b0',
  },
  assets: [
    {
      id: 'npm-composition',
      type: 'composition',
      rendererId: 'web',
      src: 'composition/composition.json',
    },
  ],
  scenes: [{ id: 'npm-scene', name: 'npm', startFrame: 0, durationFrames: 2 }],
  tracks: [
    {
      id: 'npm-track',
      name: 'npm',
      type: 'visual',
      clips: [
        {
          id: 'npm-clip',
          component: 'ForeignComposition',
          startFrame: 0,
          durationFrames: 2,
          transform: {},
          props: { assetId: 'npm-composition', placement: 'replace-scene' },
        },
      ],
    },
  ],
  markers: [],
};
const renders = [];
for (const engine of ['web-dom']) {
  cliCommand(['scaffold', engine, 'composition']);
  writeFileSync(join(consumer, 'project.json'), JSON.stringify(project));
  renders.push({
    engine,
    command: ['scenewire', 'render-check', 'project.json'],
    result: JSON.parse(cliCommand(['render-check', 'project.json'])),
  });
}
const optional = [
  'react@19.3.0',
  'react-dom@19.3.0',
  'pixi.js@8.22.0',
  'three@0.186.1',
];
command('npm', [
  'install',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
  ...optional,
]);
const engines = JSON.parse(cliCommand(['engines', '--json']));
for (const engine of ['web-react', 'web-pixi', 'web-three']) {
  if (engines.find((e) => e.id === engine)?.availability !== 'available')
    throw Error(`Missing optional engine ${engine}`);
  const directory = engine;
  cliCommand(['scaffold', engine, directory]);
  const next = structuredClone(project);
  next.assets[0].src = `${directory}/composition.json`;
  writeFileSync(join(consumer, 'project.json'), JSON.stringify(next));
  renders.push({
    engine,
    command: ['scenewire', 'render-check', 'project.json'],
    result: JSON.parse(cliCommand(['render-check', 'project.json'])),
  });
}
for (const p of report.packages) {
  p.nodeImport = p.exports ? 'PASS' : 'N/A';
  p.typecheck = p.exports ? 'PASS' : 'N/A';
  if (p.bin) p.binExecution = 'PASS';
}
report.consumer = {
  path: consumer,
  outsideCheckout: true,
  node: process.version,
  npm: command('npm', ['--version']).trim(),
  tarballs: report.packages.map((p) => p.tarball),
  chromium: process.env.SCENEWIRE_CHROMIUM_PATH ?? chromium,
  chromiumSource: process.env.SCENEWIRE_CHROMIUM_PATH
    ? 'SCENEWIRE_CHROMIUM_PATH'
    : 'Playwright-managed',
  ffmpeg: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split(
    '\n',
  )[0],
  imports: imports.trim(),
  typescript: 'PASS',
  bin: 'PASS',
  initialEngines,
  engines,
  optional,
  renders,
};
writeFileSync(
  join(artifacts, 'acceptance.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    consumer,
    packages: report.packages.length,
    Node: 'PASS',
    TS: 'PASS',
    bin: 'PASS',
    engines: 'PASS',
    render: renders.map((r) => ({ engine: r.engine, valid: r.result.valid })),
  }),
);
