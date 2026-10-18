import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
test('production base, keyboard demo, responsive layout and navigation', async ({
  page,
  browser,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'actual-browser-version',
    description: browser.version(),
  });
  const failed: string[] = [];
  page.on('pageerror', (error) => failed.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400)
      failed.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('./');
  await expect(
    page.getByRole('heading', {
      name: 'Motion Engineering for Coding Agents.',
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page.locator('script[type="module"]').getAttribute('src'),
  ).toMatch(/^\/SceneWireJS\/assets\//);
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeFocused();
  const edit = page.getByRole('button', { name: 'Edit Scene B' });
  for (
    let i = 0;
    i < 40 &&
    !(await edit.evaluate((element) => element === document.activeElement));
    i++
  )
    await page.keyboard.press('Tab');
  await expect(edit).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Reset baseline' }),
  ).toBeVisible();
  await expect(page.locator('.scene-bottom strong')).toHaveText([
    'REUSE',
    'REBUILD',
    'REUSE',
  ]);
  await expect(page.locator('.scene-bottom span')).toHaveText([
    'Review → RETAIN',
    'Review → INVALIDATE',
    'Review → RETAIN',
  ]);
  await expect(page.locator('.explain')).toContainText(
    'B’s authored recipe changed',
  );
  await page.getByRole('button', { name: 'Reset baseline' }).click();
  await expect(page.locator('.scene-bottom strong')).toHaveText([
    'FRESH',
    'FRESH',
    'FRESH',
  ]);
  await page.getByRole('link', { name: 'Quick Start', exact: true }).click();
  expect(new URL(page.url()).hash).toBe('#quick-start');
  await expect(page.locator('#quick-start')).toContainText(
    '@scenewirejs/cli@1.3.0',
  );
  await expect(
    page.getByRole('link', { name: 'Read the docs' }),
  ).toHaveAttribute(
    'href',
    'https://github.com/winhok/SceneWireJS/blob/main/README.md',
  );
  await expect(page.locator('#quick-start')).toContainText(
    'init my-video --yes --skills',
  );
  await expect(page.locator('#quick-start')).not.toContainText(
    'scaffold web-dom',
  );
  const manifestResponse = await page.request.get('demos/manifest.json');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.examples.map((entry: { id: string }) => entry.id)).toEqual([
    'dom',
    'react',
    'three',
  ]);
  await expect(page.locator('#real-demos video')).toHaveCount(3);
  for (const id of ['dom', 'react', 'three']) {
    const video = page.locator(`#real-demos video[src$="/${id}.mp4"]`);
    await video.scrollIntoViewIfNeeded();
    await expect
      .poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState))
      .toBeGreaterThanOrEqual(1);
    const expected = manifest.examples.find(
      (entry: { id: string }) => entry.id === id,
    );
    expect(
      await video.evaluate((node: HTMLVideoElement) => node.videoWidth),
    ).toBe(expected.width);
    expect(
      await video.evaluate((node: HTMLVideoElement) => node.videoHeight),
    ).toBe(expected.height);
    expect(
      await video.evaluate((node: HTMLVideoElement) => node.duration),
    ).toBeCloseTo(expected.durationSeconds, 1);
    await video.evaluate(async (node: HTMLVideoElement) => {
      await node.play();
    });
    await expect
      .poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime))
      .toBeGreaterThan(0);
    await video.evaluate((node: HTMLVideoElement) => node.pause());
    const source = await page.request.get(`source/${id}.zip`);
    expect(source.ok()).toBe(true);
    const sourceBytes = await source.body();
    expect(sourceBytes.subarray(0, 2).toString()).toBe('PK');
    expect(createHash('sha256').update(sourceBytes).digest('hex')).toBe(
      expected.sourceZipSha256,
    );
  }
  await expect(page.locator('#demo .demo-note')).toContainText(
    'not a live renderer',
  );
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy Quick Start' }).click();
  await expect(page.getByRole('status')).toHaveText('Commands copied.');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('init my-video --yes --skills');
  expect(copied).toContain('final-media-qc video.mp4');
  if (testInfo.project.name === 'mobile')
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).scrollBehavior,
      ),
    ).toBe('auto');
  expect(failed).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('website.png'),
    fullPage: true,
  });
});
