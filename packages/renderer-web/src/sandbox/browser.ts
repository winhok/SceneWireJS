import type {} from '../host-bridge';
import { chromium, type Browser, type Page } from 'playwright';
import { performance } from 'node:perf_hooks';
import {
  RenderError,
  type RenderDiagnostic,
  type WebRenderOptions,
} from '../contracts';
import type { ResourceHost, ResourceStore } from '../resources';
export async function prepareBrowser(
  options: WebRenderOptions,
  gpuRequired: boolean,
  resources: ResourceStore,
  resourceHost: ResourceHost,
  diagnostics: RenderDiagnostic[],
  diagnostic: (error: unknown, composition?: string) => RenderError,
  compositionFor: (url: string) => string,
  isDisposed: () => boolean,
  onBrowser: (browser: Browser) => void,
  onPage: (page: Page) => void,
) {
  const project = options.project,
    origin = resourceHost.origin;
  const launchStart = performance.now();
  const browser = await chromium
    .launch({
      executablePath:
        options.executablePath ?? process.env.SCENEWIRE_CHROMIUM_PATH,
      headless: true,
      chromiumSandbox: true,
      // The owner of an AbortSignal must complete encoder/session cleanup.
      // Playwright's SIGINT handler otherwise calls process.exit(130).
      handleSIGINT: !options.signal,
      handleSIGTERM: !options.signal,
      args:
        options.profile === 'preview'
          ? ['--disable-partial-raster']
          : gpuRequired
            ? [
                '--use-gl=angle',
                '--use-angle=swiftshader',
                '--enable-unsafe-swiftshader',
                // Keep DOM/SVG rasterization on the CPU even when WebGL is needed.
                '--disable-gpu-rasterization',
                '--disable-partial-raster',
              ]
            : ['--disable-gpu', '--disable-partial-raster'],
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("Executable doesn't exist") ||
        message.includes('executable doesn')
      )
        throw diagnostic(
          'Chromium is unavailable. Run npx playwright install chromium, or set SCENEWIRE_CHROMIUM_PATH to a compatible Chromium executable.',
        );
      throw error;
    });
  onBrowser(browser);
  const browserLaunchMs = performance.now() - launchStart;
  if (isDisposed()) {
    await browser.close();
    throw Error('Render cancelled');
  }
  const context = await browser.newContext({
    viewport: {
      width: project.canvas.width,
      height: project.canvas.height,
    },
    deviceScaleFactor: 1,
    timezoneId: 'UTC',
    locale: 'en-US',
    reducedMotion: 'reduce',
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const frame = route.request().frame(),
      name = frame.name(),
      allowedPrefix = name.startsWith('composition-')
        ? '/composition/' + name.slice('composition-'.length) + '/'
        : (frame.url().match(/\/composition\/[^/]+\//)?.[0] ??
          (route.request().isNavigationRequest()
            ? url.pathname.match(/^\/composition\/[^/]+\//)?.[0]
            : undefined));
    const bytes =
      url.origin === origin &&
      !url.search &&
      (!frame.parentFrame() ||
        (allowedPrefix && url.pathname.startsWith(allowedPrefix)))
        ? resources.get(url.pathname)
        : undefined;
    if (!bytes) {
      diagnostics.push(
        diagnostic(
          `Network violation or missing asset: ${url.origin}${url.pathname}`,
          compositionFor(route.request().frame().url()),
        ).diagnostic,
      );
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue({
      headers: {
        ...route.request().headers(),
        'x-scenewire-resource': resourceHost.token,
      },
    });
  });
  const page = await context.newPage();
  onPage(page);
  let rejectFailure: (error: RenderError) => void = () => {};
  const failure = new Promise<never>((_, reject) => {
    rejectFailure = reject;
  });
  void failure.catch(() => {});
  const record = (error: RenderError) => {
    diagnostics.push(error.diagnostic);
    rejectFailure(error);
  };
  page.on('pageerror', (error) => record(diagnostic(error)));
  page.on('console', (message) => {
    if (message.type() === 'error')
      record(
        diagnostic(message.text(), compositionFor(message.location().url)),
      );
  });
  await Promise.race([
    page
      .goto(origin + '/index.html')
      .then(() => page!.waitForFunction(() => window.sceneWireReady?.())),
    failure,
  ]);
  if (diagnostics.length) throw new RenderError(diagnostics[0]!);

  return { browserLaunchMs, browserVersion: browser.version(), page };
}
