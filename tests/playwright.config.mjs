import { defineConfig, devices } from '@playwright/test';

// Tests run against the app served as plain static files. The config
// starts a throwaway static server automatically, so a reviewer only
// needs: `npm install && npx playwright install chromium && npm test`.
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8123',
    ...devices['Pixel 5'],          // test on an emulated phone, as agents use it
    acceptDownloads: true,
  },
  webServer: {
    command: 'python -m http.server 8123',
    cwd: '..',                      // serve the app root (one level up from /tests)
    port: 8123,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
