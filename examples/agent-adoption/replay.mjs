import { writeFileSync } from 'node:fs';
import {
  cp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  lstat,
  realpath,
} from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const [example, output, ...extra] = process.argv.slice(2);
if (!['dom', 'react', 'three'].includes(example) || !output || extra.length)
  throw Error(
    'Usage: node examples/agent-adoption/replay.mjs dom|react|three <new-directory-outside-checkout>',
  );
const root = dirname(fileURLToPath(import.meta.url));
const source = resolve(root, example),
  destination = resolve(output);
const checkout = resolve(root, '../..');
function isWithin(parent, child) {
  const local = relative(parent, child);
  return (
    local === '' ||
    (local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local))
  );
}
if (isWithin(checkout, destination))
  throw Error('Choose a new destination outside the checkout');
try {
  await lstat(destination);
  throw Error('Destination already exists; replay never overwrites');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
let ancestor = dirname(destination);
for (;;) {
  try {
    await lstat(ancestor);
    break;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = dirname(ancestor);
    if (parent === ancestor) throw error;
    ancestor = parent;
  }
}
const physicalDestination = resolve(
  await realpath(ancestor),
  relative(ancestor, destination),
);
if (isWithin(await realpath(checkout), physicalDestination))
  throw Error('Choose a new destination outside the checkout');
await cp(source, destination, {
  recursive: true,
  errorOnExist: true,
  force: false,
});
await mkdir(resolve(destination, 'checks'));
const commands = [];
function run(label, command, args, timeout = 240000) {
  const invocation =
    process.platform === 'win32' && ['npm', 'npx'].includes(command)
      ? {
          command: 'cmd.exe',
          args: ['/d', '/s', '/c', [command, ...args].join(' ')],
        }
      : { command, args };
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: destination,
    encoding: 'utf8',
    timeout,
    maxBuffer: 16 * 2 ** 20,
    env: { ...process.env, NODE_PATH: '' },
  });
  const record = {
    label,
    command: command === process.execPath ? 'node' : command,
    args,
    cwd: '.',
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message,
  };
  commands.push(record);
  const log = resolve(destination, 'checks/commands.json');
  // Strip local user paths from the portable command log; source and media bytes are untouched.
  const safe = JSON.stringify(commands, null, 2)
    .split(destination)
    .join('[replay]');
  writeFileSync(log, safe + '\n');
  if (result.status !== 0)
    throw Error(
      `${label} failed: ${record.stderr.slice(-1500) || record.error || record.stdout.slice(-1500)}`,
    );
  return result.stdout;
}
run('install', 'npm', ['ci']);
run('browser', 'npx', ['--no-install', 'playwright', 'install', 'chromium']);
const cli = ['node_modules/@scenewirejs/cli/dist/scenewire.js'];
run('doctor', process.execPath, [...cli, 'doctor', '--json']);
const project = JSON.parse(
  await readFile(resolve(destination, 'project.json'), 'utf8'),
);
const frames = Math.max(
  ...project.scenes.map((scene) => scene.startFrame + scene.durationFrames),
);
const selected = [
  ...new Set([
    0,
    ...project.scenes.flatMap((s) => [
      s.startFrame,
      s.startFrame + s.durationFrames - 1,
    ]),
    Math.floor(frames / 2),
    frames - 1,
  ]),
]
  .sort((a, b) => a - b)
  .join(',');
run('render-check', process.execPath, [
  ...cli,
  'render-check',
  'project.json',
  '--frames',
  selected,
]);
run(
  'render',
  process.execPath,
  [
    ...cli,
    'render',
    'project.json',
    '--output',
    'video.mp4',
    '--profile',
    'deterministic-export',
  ],
  600000,
);
const qc = JSON.parse(
  run('final-media-qc', process.execPath, [
    ...cli,
    'final-media-qc',
    'video.mp4',
  ]),
);
const probe = JSON.parse(
  run('ffprobe', 'ffprobe', [
    '-v',
    'error',
    '-count_frames',
    '-show_streams',
    '-show_format',
    '-of',
    'json',
    'video.mp4',
  ]),
);
const video = probe.streams.find((stream) => stream.codec_type === 'video');
if (
  video.width !== project.canvas.width ||
  video.height !== project.canvas.height ||
  Number(video.nb_read_frames) !== frames ||
  video.avg_frame_rate !== `${project.fps}/1` ||
  Math.abs(Number(video.duration) - frames / project.fps) > 1 / project.fps ||
  video.codec_name !== 'h264'
)
  throw Error('Actual media differs from the project contract');
if (probe.streams.some((stream) => stream.codec_type === 'audio'))
  throw Error('Examples are intentionally silent');
run('full-decode', 'ffmpeg', [
  '-v',
  'error',
  '-xerror',
  '-i',
  'video.mp4',
  '-f',
  'null',
  '-',
]);
run('contact-sheet', process.execPath, [
  ...cli,
  'contact-sheet',
  'project.json',
  '--frames',
  selected,
  '--output',
  'checks/contact-sheet.svg',
]);
run('capture', process.execPath, [
  ...cli,
  'capture',
  'project.json',
  '--frame',
  String(Math.floor(frames / 2)),
  '--output',
  'checks/capture.png',
]);
run('poster', 'ffmpeg', [
  '-v',
  'error',
  '-ss',
  '2',
  '-i',
  'video.mp4',
  '-frames:v',
  '1',
  'poster.png',
]);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = {};
async function index(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isSymbolicLink())
      throw Error('Example source must not use symlinks');
    if (entry.isDirectory()) await index(path);
    else
      sourceHashes[relative(source, path).split('\\').join('/')] = hash(
        await readFile(path),
      );
  }
}
await index(source);
const bytes = await readFile(resolve(destination, 'video.mp4'));
const record = {
  example,
  result: 'PASS_FRESH_SOURCE_COPY_NPM_CI_RENDER_FULL_DECODE',
  cliVersion: JSON.parse(
    await readFile(
      resolve(destination, 'node_modules/@scenewirejs/cli/package.json'),
      'utf8',
    ),
  ).version,
  node: process.version,
  sourceSha256: sourceHashes,
  sourceFiles: Object.keys(sourceHashes).length,
  sha256: hash(bytes),
  bytes: bytes.length,
  width: video.width,
  height: video.height,
  fps: project.fps,
  frames,
  durationSeconds: Number(video.duration),
  codec: video.codec_name,
  pixelFormat: video.pix_fmt,
  audio: 'INTENTIONALLY_SILENT',
  fullDecode: 'PASS',
  qc,
  selectedFrames: selected,
  commands: commands.map(({ stdout, stderr, error, ...rest }) => {
    void stdout;
    void stderr;
    void error;
    return rest;
  }),
  sampleVisualReview: 'PENDING',
  continuousHumanPlayback: 'NOT_PERFORMED',
  creativeQualification: 'NO_GO',
  formalHoldout: 'NOT_CONSUMED',
  recordedAt: new Date().toISOString(),
};
await writeFile(
  resolve(destination, 'checks/validation.json'),
  JSON.stringify(record, null, 2) + '\n',
);
console.log(
  JSON.stringify({
    example,
    result: record.result,
    sha256: record.sha256,
    bytes: record.bytes,
    frames,
    durationSeconds: record.durationSeconds,
  }),
);
