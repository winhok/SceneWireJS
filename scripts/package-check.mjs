import ts from 'typescript';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
const root = process.cwd();
const releaseVersion = JSON.parse(
  readFileSync('packages/schema/package.json', 'utf8'),
).version;
const packages = readdirSync('packages').map((name) => `packages/${name}`);
const entries = packages.map((directory) => {
  const metadata = JSON.parse(
    readFileSync(`${directory}/package.json`, 'utf8'),
  );
  if (
    metadata.private === true ||
    metadata.version !== releaseVersion ||
    metadata.engines?.node !== '>=22.12.0' ||
    metadata.publishConfig?.access !== 'public' ||
    JSON.stringify(metadata.files) !== JSON.stringify(['dist/'])
  )
    throw Error(`Invalid publishable metadata: ${directory}`);
  for (const targets of Object.values(metadata.exports))
    for (const target of Object.values(targets))
      if (
        !target.startsWith('./dist/') ||
        !existsSync(resolve(directory, target))
      )
        throw Error(`Missing built export: ${directory} ${target}`);
  const entry = resolve(directory, 'src/index.ts');
  if (!entry.startsWith(resolve(directory) + '/') || !existsSync(entry))
    throw Error(`Missing package export: ${directory}`);
  return { name: metadata.name, entry };
});
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  root,
).options;
const program = ts.createProgram(
  entries.map(({ entry }) => entry),
  options,
);
const checker = program.getTypeChecker();
const exports = Object.fromEntries(
  entries.map(({ name, entry }) => {
    const source = program.getSourceFile(entry);
    if (!source?.symbol)
      throw Error(`Unresolved public entry: ${relative(root, entry)}`);
    return [
      name,
      checker
        .getExportsOfModule(source.symbol)
        .map((symbol) => symbol.name)
        .sort(),
    ];
  }),
);
// Public contract is an intentional product document, independent of qualification fixtures.
const expected = JSON.parse(readFileSync('docs/package-contract.json', 'utf8'));
for (const [name, names] of Object.entries(expected.packages))
  if (JSON.stringify(exports[name]) !== JSON.stringify(names))
    throw Error(`Public export drift in ${name}: review the public contract`);
for (const [name, subpaths] of Object.entries(expected.subpaths ?? {})) {
  const directory = packages.find(
    (path) =>
      JSON.parse(readFileSync(`${path}/package.json`, 'utf8')).name === name,
  );
  if (
    !directory ||
    JSON.stringify(
      Object.keys(
        JSON.parse(readFileSync(`${directory}/package.json`, 'utf8')).exports,
      ).sort(),
    ) !== JSON.stringify([...subpaths].sort())
  )
    throw Error(`Public subpath drift: ${name}`);
}
for (const path of ['package.json', 'apps/editor/package.json'])
  if (JSON.parse(readFileSync(path, 'utf8')).private !== true)
    throw Error(`Application must stay private: ${path}`);
const cli = JSON.parse(readFileSync('apps/cli/package.json', 'utf8'));
if (
  cli.private === true ||
  cli.version !== releaseVersion ||
  cli.engines?.node !== '>=22.12.0' ||
  cli.publishConfig?.access !== 'public'
)
  throw Error('Invalid CLI publish metadata');
const cliSource = ts.createSourceFile(
  'scenewire.js',
  readFileSync('apps/cli/dist/scenewire.js', 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
function checkImports(node) {
  const id = ts.isImportDeclaration(node)
    ? node.moduleSpecifier
    : ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ? node.arguments[0]
      : undefined;
  if (
    id &&
    ts.isStringLiteral(id) &&
    !id.text.startsWith('node:') &&
    !id.text.startsWith('.')
  ) {
    const name = id.text
      .split('/')
      .slice(0, id.text.startsWith('@') ? 2 : 1)
      .join('/');
    if (!cli.dependencies[name])
      throw Error(`Undeclared CLI runtime dependency: ${name}`);
  }
  ts.forEachChild(node, checkImports);
}
checkImports(cliSource);
if (!existsSync(resolve('apps/cli', cli.bin.scenewire)))
  throw Error('Build CLI before package checks');
console.log(
  JSON.stringify({
    packages: entries.length,
    publicExports: 'matches public contract',
    cliBin: 'present',
    distribution:
      'publishable ESM/declarations; tarball/consumer checks are a separate gate',
  }),
);
