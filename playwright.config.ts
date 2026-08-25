import { defineConfig, devices } from '@playwright/test';

/**
 * The suite runs against `vite preview` serving a real `npm run build`, under
 * the same base path GitHub Pages serves the site from. Two things depend on
 * that and would pass vacuously against `npm run dev`: a service worker only
 * registers in a secure context (`localhost` is one, a LAN address is not),
 * and every scope, `start_url` and asset URL in the manifest is prefixed by
 * the base path only in a built bundle.
 */
export const BASE_PATH = '/mazeGame/';

const PORT = 4173;
const origin = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : '50%',
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  // A cold generate-and-paint at the largest grid size is seconds, not
  // milliseconds, on a shared runner.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // A fixed viewport and device pixel ratio keep the board's fitted
        // scale identical between runs, which the pixel-level tests need.
        viewport: { width: 800, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `${origin}${BASE_PATH}`,
    env: { VITE_BASE: BASE_PATH },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
