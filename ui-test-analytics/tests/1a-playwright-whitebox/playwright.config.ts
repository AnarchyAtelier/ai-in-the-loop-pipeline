import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const appDir = path.resolve(__dirname, '../../phantom-brew');
const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';
const junitOutput =
  process.env.PLAYWRIGHT_JUNIT_OUTPUT_NAME ?? path.resolve(__dirname, '../../results/test-result-whitebox.xml');

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  retries: 0,
  reporter: [
    ['list'],
    ['junit', { outputFile: junitOutput }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer:
    process.env.PLAYWRIGHT_SKIP_WEBSERVER === '1'
      ? undefined
      : {
          command: 'npm run dev',
          cwd: appDir,
          env: {
            TS_NODE_FILES: 'true',
            TS_NODE_TRANSPILE_ONLY: 'true',
          },
          url: `${baseURL}/menu`,
          timeout: 120_000,
          reuseExistingServer: !process.env.CI,
        },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
