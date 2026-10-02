import ts from 'typescript';
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  cpSync,
  rmSync,
} from 'node:fs';
import { join, relative } from 'node:path';
const directories = readdirSync('packages').map((name) => `packages/${name}`);
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(directory, entry.name))
      : /\.tsx?$/.test(entry.name)
        ? [join(directory, entry.name)]
        : [],
  );
}
const files = directories.flatMap((directory) =>
  sources(join(directory, 'src')),
);
const extension = (specifier) =>
  specifier === '.' || specifier === '..'
    ? specifier + '/index.js'
    : specifier.startsWith('.') && !/\.(?:js|mjs|cjs|json)$/.test(specifier)
      ? specifier.replace(/\.tsx?$/, '') + '.js'
      : specifier;
// All relative ESM edges are explicit .js in both emitted JS and declarations.
function rewrite(source) {
  return source.replace(
    /((?:from\s*|import\s*\(|import\s*)["'])(\.[^"']+)(["'])/g,
    (_, before, path, after) => before + extension(path) + after,
  );
}
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  process.cwd(),
);
const declarationRoot = '.build/declarations';
rmSync(declarationRoot, { recursive: true, force: true });
const program = ts.createProgram(files, {
  ...parsed.options,
  noEmit: false,
  declaration: true,
  emitDeclarationOnly: true,
  rootDir: '.',
  outDir: declarationRoot,
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (p) => p,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
  );
  process.exit(1);
}
program.emit(undefined, (path, source) => {
  mkdirSync(join(path, '..'), { recursive: true });
  const nodeTypes =
    /\b(?:Buffer|NodeJS)\b/.test(source) ||
    /\/(?:renderer-web|media-inspect)\//.test(path);
  writeFileSync(
    path,
    (nodeTypes ? '/// <reference types="node" />\n' : '') + rewrite(source),
  );
});
for (const directory of directories) {
  const dist = join(directory, 'dist');
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  cpSync(join(declarationRoot, directory, 'src'), dist, { recursive: true });
  for (const file of sources(join(directory, 'src'))) {
    const output = join(
      dist,
      relative(join(directory, 'src'), file).replace(/\.tsx?$/, '.js'),
    );
    mkdirSync(join(output, '..'), { recursive: true });
    const emitted = ts.transpileModule(readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        verbatimModuleSyntax: false,
      },
    });
    writeFileSync(output, rewrite(emitted.outputText));
  }
}
console.log(`Built ESM and declarations for ${directories.length} libraries`);
