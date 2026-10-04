import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createEngineRegistry } from '@scenewirejs/director-core';
import {
  compositionManifestSchema,
  resolveCompositionParameters,
  isVisualTrack,
} from '@scenewirejs/schema';
import type {
  WebRenderOptions,
  CompositionBuild,
  RenderError,
} from '../contracts';
import type { ResourceHost, ResourceStore } from '../resources';
import { localPath } from '../sandbox/paths';
import { mime } from '../sandbox/mime';
import { html, clockScript } from '../sandbox/policy';
import { bundle } from '../bundle/bundler';
import { filesIn } from '../bundle/source-tree';
import {
  dependencyIdentity,
  consumerDependencyIdentity,
  resolvedPackage,
} from '../bundle/dependencies';
import { cache } from '../bundle/cache';
import { sourceHash, instanceHash } from '../bundle/identity';
const sourceDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
export async function prepareResources(
  options: WebRenderOptions,
  resourceHost: ResourceHost,
  resources: ResourceStore,
  engines: Map<string, string>,
  builds: CompositionBuild[],
  diagnostic: (error: unknown, composition?: string) => RenderError,
) {
  const { project, projectRoot } = options,
    workspace = options.workspaceRoot ?? process.cwd();
  const runtime = await realpath(sourceDirectory);
  const runtimeExtension = extname(fileURLToPath(import.meta.url));
  const runtimeResolver = createRequire(import.meta.url);
  const runtimeRoots = [
    runtime,
    ...(await Promise.all(
      ['@scenewirejs/web-runtime', '@scenewirejs/renderer-core'].map(async (id) => {
        const { root, metadata } = await resolvedPackage(runtimeResolver, id);
        return dirname(join(root, metadata.exports!['.']!.import!));
      }),
    )),
  ];
  await resourceHost.prepare();
  const origin = resourceHost.origin;
  const buildStart = performance.now();
  const visual = project.tracks
    .filter(isVisualTrack)
    .filter((t) => !t.muted)
    .flatMap((t) => t.clips);
  const clips = visual.filter((c) => c.component === 'ForeignComposition');
  const videos = visual.filter((c) => c.component === 'Video');
  const mediaUrls: Record<string, string> = {};
  for (const assetId of new Set(videos.map((c) => c.props.assetId))) {
    const asset = project.assets.find((a) => a.id === assetId)!;
    if (asset.type !== 'video') throw diagnostic('video.asset.type', assetId);
    try {
      const path = await localPath(projectRoot, asset.src);
      const url = '/media/' + encodeURIComponent(asset.id) + extname(path);
      resources.set(url, {
        kind: 'file',
        path,
        size: (await stat(path)).size,
        mime: mime[extname(path)] ?? 'application/octet-stream',
      });
      mediaUrls[asset.id] = origin + url;
    } catch (error) {
      throw diagnostic(error, assetId);
    }
  }
  const resolver = createRequire(join(workspace, 'package.json'));
  const dependencyIds = ['react', 'react-dom', 'pixi.js', 'three'].filter(
    (id) => {
      try {
        resolver.resolve(id);
        return true;
      } catch {
        return false;
      }
    },
  );
  const registry = createEngineRegistry({
    rendererIds: ['canvas', 'web'],
    dependencyIds,
  });
  const trees = new Map<
    string,
    Promise<readonly (readonly [string, Buffer])[]>
  >();
  const scan = (root: string) => {
    let pending = trees.get(root);
    if (!pending) {
      pending = filesIn(root).then((files) =>
        Promise.all(
          files.map(
            async (file) =>
              [relative(root, file), await readFile(file)] as const,
          ),
        ),
      );
      trees.set(root, pending);
    }
    return pending;
  };
  const lock = clips.length
    ? await Promise.all([
        consumerDependencyIdentity(workspace, dependencyIds),
        dependencyIdentity(runtime, [
          '@scenewirejs/web-runtime',
          '@scenewirejs/renderer-core',
        ]),
        dependencyIdentity(runtime, [
          '@scenewirejs/compiler',
          '@scenewirejs/runtime',
          '@scenewirejs/renderer-canvas',
          '@scenewirejs/domain-developer',
          '@scenewirejs/domain-education',
          '@scenewirejs/domain-editorial',
          'mediabunny',
          'vite',
        ]),
      ]).then((identities) => identities.join('\n'))
    : '';
  const runtimeFiles = clips.length
    ? (
        await Promise.all(
          runtimeRoots.map(async (root, index) =>
            (await scan(root)).map(
              ([path, bytes]) =>
                [
                  `runtime-${index}/${path}`,
                  createHash('sha256').update(bytes).digest('hex'),
                ] as const,
            ),
          ),
        )
      ).flat()
    : [];
  const sources = new Map<string, string>();
  let gpuRequired = false;
  for (const clip of clips) {
    const asset = project.assets.find((a) => a.id === clip.props.assetId)!;
    if (asset.type !== 'composition') continue;
    try {
      if (asset.rendererId !== 'web')
        throw Error(`Unknown renderer: ${asset.rendererId}`);
      const manifestFile = await localPath(projectRoot, asset.src),
        root = dirname(manifestFile);
      const manifest = compositionManifestSchema.parse(
        JSON.parse(await readFile(manifestFile, 'utf8')),
      );
      if (manifest.renderer !== asset.rendererId)
        throw Error('Manifest renderer mismatch');
      const engineBundleStart = performance.now();
      const engineId =
        manifest.schemaVersion === 2
          ? (manifest.engine ?? 'web-dom')
          : 'web-dom';
      engines.set(asset.id, engineId);
      const engine = registry.getEngine(engineId);
      if (
        !engine ||
        engine.rendererId !== manifest.renderer ||
        engine.availability !== 'available'
      )
        throw Error(`Unavailable or incompatible engine: ${engineId}`);
      gpuRequired ||= !!engine.requiresGpu;
      const entry = await localPath(root, manifest.entry);
      const init = {
        compositionId: asset.id,
        parameters: resolveCompositionParameters(
          manifest,
          clip.props.parameters,
        ),
        width: project.canvas.width,
        height: project.canvas.height,
        fps: project.fps,
        seed: project.seed ?? 0,
      };
      const sourceFiles = await scan(root);
      const identity = sourceHash({
        manifest,
        engine: engineId,
        lock,
        sources: sourceFiles.map(([path, bytes]) => [
          path,
          createHash('sha256').update(bytes).digest('hex'),
        ]),
        runtime: runtimeFiles,
      });
      let pending = cache.get(identity);
      if (!pending) {
        pending = bundle(
          'composition.js',
          `import composition from ${JSON.stringify(entry)};import {mountComposition} from ${JSON.stringify(join(runtime, 'browser' + runtimeExtension))};const init=globalThis.__sceneWireInit;delete globalThis.__sceneWireInit;mountComposition(composition,init).catch(e=>console.error(String(e)));`,
          workspace,
          root,
          runtimeRoots,
          join(runtime, 'browser' + runtimeExtension),
        );
        if (cache.size >= 16) cache.delete(cache.keys().next().value!);
        cache.set(identity, pending);
        void pending.catch(() => {
          if (cache.get(identity) === pending) cache.delete(identity);
        });
      }
      const files = await pending;
      const bundleHash = createHash('sha256');
      for (const [path, bytes] of [...files].sort(([a], [b]) =>
        a.localeCompare(b),
      ))
        bundleHash.update(path).update(bytes);
      builds.push({
        engine: engineId,
        bundleMs: performance.now() - engineBundleStart,
        compositionId: asset.id,
        sourceHash: identity,
        instanceHash: instanceHash(identity, init),
        bundleHash: bundleHash.digest('hex'),
      });
      const base = `/composition/${encodeURIComponent(clip.id)}/`;
      for (const [path, bytes] of files) resources.set(base + path, bytes);
      resources.set(base + 'clock.js', Buffer.from(clockScript));
      resources.set(
        base + 'init.js',
        Buffer.from(`globalThis.__sceneWireInit=${JSON.stringify(init)};`),
      );
      for (const [path, bytes] of sourceFiles)
        if (!/\.(tsx?|jsx?|json|css)$/.test(path))
          resources.set(base + path, bytes);
      resources.set(
        base + 'index.html',
        Buffer.from(
          html(
            '<div id="root"></div>',
            [
              origin + base + 'clock.js',
              origin + base + 'init.js',
              origin + base + 'composition.js',
            ],
            [...files.keys()]
              .filter((path) => path.endsWith('.css'))
              .map((path) => origin + base + path),
            `default-src 'none'; script-src ${origin}; style-src 'unsafe-inline' ${origin}; img-src ${origin} data: blob:; font-src ${origin} data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`,
          ),
        ),
      );
      sources.set(clip.id, base + 'index.html');
    } catch (error) {
      throw diagnostic(error, asset.id);
    }
  }
  const host = await bundle(
    'host.js',
    `import {mountHost} from ${JSON.stringify(join(runtime, 'host' + runtimeExtension))};mountHost(${JSON.stringify(project)},${JSON.stringify(mediaUrls)}).catch(e=>console.error(String(e)));`,
    workspace,
  );
  for (const [path, bytes] of host) resources.set('/' + path, bytes);
  const videoLayers = videos
    .map(
      (clip) =>
        `<canvas class="video-layer" data-clip="${clip.id.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}" width="1" height="1" style="position:absolute;inset:0;display:none;z-index:${clip.props.placement === 'foreground' ? 2 : 0}"></canvas>`,
    )
    .join('');
  const iframes = clips
    .map(
      (clip) =>
        `<iframe sandbox="allow-scripts" name="composition-${encodeURIComponent(clip.id)}" data-clip="${clip.id.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}" src="${sources.get(clip.id)}" style="position:absolute;inset:0;width:100%;height:100%;border:0;z-index:${clip.props.placement === 'foreground' ? 2 : 0}"></iframe>`,
    )
    .join('');
  resources.set(
    '/index.html',
    Buffer.from(
      html(
        `<div id="stage" style="position:relative;width:${project.canvas.width}px;height:${project.canvas.height}px;background:${project.canvas.background}"><canvas width="${project.canvas.width}" height="${project.canvas.height}" style="position:absolute;inset:0;z-index:1"></canvas>${videoLayers}${iframes}${clips.length || videos.length ? `<canvas class="subtitle-layer" width="${project.canvas.width}" height="${project.canvas.height}" style="position:absolute;inset:0;z-index:3;pointer-events:none"></canvas>` : ''}</div>`,
        [origin + '/host.js'],
        [],
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; frame-src 'self'; img-src data:; font-src 'self'; connect-src 'self'; base-uri 'none'",
      ),
    ),
  );
  return { gpuRequired, bundleMs: performance.now() - buildStart };
}
