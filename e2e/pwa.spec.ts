import { expect, test } from '@playwright/test';
import { BASE_PATH } from '../playwright.config.js';
import { openBoard } from './app.js';

interface ManifestIcon {
  readonly src: string;
  readonly sizes?: string;
  readonly purpose?: string;
}

interface Manifest {
  readonly name: string;
  readonly scope: string;
  readonly start_url: string;
  readonly display: string;
  readonly icons: readonly ManifestIcon[];
}

/**
 * The build is served from a sub-path here for the same reason GitHub Pages
 * serves the site from one: every URL below is only correct if the base path
 * reached it, and a root-hosted build would pass these vacuously.
 */
test.describe('PWA under the deployed base path', () => {
  test('the manifest, its scope and start_url, and every icon resolve', async ({ page }) => {
    await page.goto(BASE_PATH);

    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).not.toBeNull();
    const manifestUrl = new URL(href as string, page.url());
    expect(manifestUrl.pathname.startsWith(BASE_PATH)).toBe(true);

    const response = await page.request.get(manifestUrl.href);
    expect(response.status()).toBe(200);
    const manifest = (await response.json()) as Manifest;

    expect(new URL(manifest.scope, manifestUrl).pathname).toBe(BASE_PATH);
    expect(new URL(manifest.start_url, manifestUrl).pathname).toBe(BASE_PATH);
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThan(0);
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);

    for (const icon of manifest.icons) {
      const iconUrl = new URL(icon.src, manifestUrl);
      expect(iconUrl.pathname.startsWith(BASE_PATH)).toBe(true);
      const iconResponse = await page.request.get(iconUrl.href);
      expect(iconResponse.status(), `${iconUrl.pathname} is missing`).toBe(200);
      expect(iconResponse.headers()['content-type']).toContain('image/png');
    }
  });

  test('every script and stylesheet the shell loads sits under the base path', async ({ page }) => {
    await page.goto(BASE_PATH);
    const urls = await page.evaluate(() => [
      ...[...document.querySelectorAll('script[src]')].map((el) => (el as HTMLScriptElement).src),
      ...[...document.querySelectorAll('link[href]')].map((el) => (el as HTMLLinkElement).href),
    ]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(new URL(url).pathname.startsWith(BASE_PATH), `${url} escapes the base path`).toBe(
        true,
      );
    }
  });

  test('the service worker registers, and claims the page, within its scope', async ({ page }) => {
    await openBoard(page);

    const registration = await page.evaluate(async () => {
      const ready = await navigator.serviceWorker.ready;
      return { scope: ready.scope, scriptURL: ready.active?.scriptURL ?? null };
    });
    expect(new URL(registration.scope).pathname).toBe(BASE_PATH);
    expect(registration.scriptURL).not.toBeNull();
    expect(new URL(registration.scriptURL as string).pathname).toBe(`${BASE_PATH}sw.js`);

    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
      .toBe(true);
  });
});
