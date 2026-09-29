import type { Page, CDPSession } from 'playwright';
export type CaptureBackendId = 'playwright-element' | 'cdp-page';
export interface CaptureBackend {
  readonly id: CaptureBackendId;
  prepare(page: Page): Promise<void>;
  capture(page: Page, width: number, height: number): Promise<Buffer>;
  dispose?(): Promise<void>;
}
export function createCaptureBackend(
  id: CaptureBackendId,
  options: {
    timeoutMs?: number;
    optimizeForSpeed?: boolean;
    captureBeyondViewport?: boolean;
  } = {},
): CaptureBackend {
  if (id === 'playwright-element')
    return {
      id,
      async prepare() {},
      capture(page) {
        return page.locator('#stage').screenshot({
          type: 'png',
          animations: 'allow',
          timeout: options.timeoutMs ?? 5000,
        });
      },
    };
  if (id !== 'cdp-page') throw Error('Unknown capture backend');
  let session: CDPSession | undefined;
  let clip: { x: number; y: number; width: number; height: number } | null =
    null;
  return {
    id,
    async prepare(page) {
      session = await page.context().newCDPSession(page);
      clip = await page.locator('#stage').boundingBox();
      if (!clip) throw Error('Stage capture clip is unavailable');
    },
    async capture(_page, width, height) {
      if (!session || !clip) throw Error('Capture backend not prepared');
      if (clip.width !== width || clip.height !== height)
        throw Error('Stage capture dimensions differ');
      const response = await session.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: options.captureBeyondViewport ?? false,
        optimizeForSpeed: options.optimizeForSpeed ?? true,
        clip: { ...clip, scale: 1 },
      });
      return Buffer.from(response.data, 'base64');
    },
    async dispose() {
      await session?.detach().catch(() => {});
      session = undefined;
    },
  };
}
