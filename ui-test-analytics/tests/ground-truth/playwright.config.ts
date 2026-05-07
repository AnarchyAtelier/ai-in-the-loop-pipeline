import { defineConfig } from '@playwright/test';
import path from 'node:path';

const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';
const appDir = path.resolve(__dirname, '../../phantom-brew');
const junitOutput =
  process.env.PLAYWRIGHT_JUNIT_OUTPUT_NAME ?? path.resolve(__dirname, '../../results/test-result-ground-truth.xml');
const startCommand =
  process.platform === 'win32'
    ? 'cmd /c "set TS_NODE_TRANSPILE_ONLY=true&& npm run dev"'
    : 'TS_NODE_TRANSPILE_ONLY=true npm run dev';

export default defineConfig({
  testDir: './specs',
  timeout: 30000,
  retries: 0,
  workers: 1, // 順次実行（FP-4のレート制限テストに影響しないように）
  use: {
    baseURL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: [
    ['list'],
    ['junit', { outputFile: junitOutput }],
  ],
  webServer:
    process.env.PLAYWRIGHT_SKIP_WEBSERVER === '1'
      ? undefined
      : {
          command: startCommand,
          cwd: appDir,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          url: `${baseURL}/menu`,
        },
});
