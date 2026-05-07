import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';
const appDir = path.resolve(__dirname, '../../phantom-brew');
const junitOutput =
  process.env.PLAYWRIGHT_JUNIT_OUTPUT_NAME ?? path.resolve(__dirname, '../../results/test-result-naive.xml');
const startCommand =
  process.platform === 'win32'
    ? 'cmd /c "set TS_NODE_TRANSPILE_ONLY=true&& npm run dev"'
    : 'TS_NODE_TRANSPILE_ONLY=true npm run dev';

export default defineConfig({
  testDir: './tests',
  timeout: 15000, // 初心者は短めに設定しがち
  retries: 0,
  workers: 3, // 並列実行（FP-4を踏みやすくなる）
  use: {
    baseURL,
    headless: true,
    screenshot: 'only-on-failure',
  },
  reporter: [
    ['list'],
    ['junit', { outputFile: junitOutput }],
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
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
