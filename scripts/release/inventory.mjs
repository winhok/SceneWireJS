export const repository = 'winhok/SceneWireJS';
export const environment = 'npm-production';
export const npmVersion = '12.2.0';
export const packages = Object.freeze(
  [
    'audio',
    'cli',
    'compiler',
    'director-core',
    'domain-developer',
    'domain-editorial',
    'domain-education',
    'editor-core',
    'media',
    'media-inspect',
    'patch',
    'production-core',
    'reference-core',
    'renderer-canvas',
    'renderer-core',
    'renderer-web',
    'runtime',
    'schema',
    'time',
    'web-runtime',
  ].map((name) => `@scenewirejs/${name}`),
);
