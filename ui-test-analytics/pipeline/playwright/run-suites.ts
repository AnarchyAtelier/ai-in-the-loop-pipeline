import { mkdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

interface Suite {
  id: string;
  name: string;
  cwd: string;
  junitOutput: string;
}

const resultsDir = path.resolve(process.env.RESULTS_DIR ?? 'results');
const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';

const suites: Suite[] = [
  {
    id: 'whitebox',
    name: '1a Playwright whitebox',
    cwd: path.resolve('tests/1a-playwright-whitebox'),
    junitOutput: path.join(resultsDir, 'test-result-whitebox.xml'),
  },
  {
    id: 'blackbox',
    name: '1b Playwright blackbox',
    cwd: path.resolve('tests/1b-playwright-blackbox'),
    junitOutput: path.join(resultsDir, 'test-result-blackbox.xml'),
  },
  {
    id: 'naive',
    name: '1c Playwright naive',
    cwd: path.resolve('tests/1c-playwright-naive'),
    junitOutput: path.join(resultsDir, 'test-result-naive.xml'),
  },
  {
    id: 'ground-truth',
    name: 'Ground Truth Playwright',
    cwd: path.resolve('tests/ground-truth'),
    junitOutput: path.join(resultsDir, 'test-result-ground-truth.xml'),
  },
];

async function main() {
  await mkdir(resultsDir, { recursive: true });

  if (process.env.PLAYWRIGHT_SKIP_WEBSERVER === '1') {
    await waitForApp(`${baseURL}/menu`);
  }

  const selectedSuiteIds = selectedSuites();
  const selectedSuitesToRun = suites.filter((suite) => selectedSuiteIds.has(suite.id));
  const failures: string[] = [];
  const missingReports: string[] = [];

  for (const suite of selectedSuitesToRun) {
    console.log(`\n=== Running ${suite.name} ===`);
    const exitCode = await runSuite(suite);
    const reportExists = await fileExists(suite.junitOutput);

    if (exitCode !== 0) {
      failures.push(`${suite.id} exited with code ${exitCode}`);
    }

    if (!reportExists) {
      missingReports.push(`${suite.id} did not write ${suite.junitOutput}`);
    }
  }

  if (missingReports.length > 0) {
    for (const missingReport of missingReports) {
      console.error(`- ${missingReport}`);
    }
    throw new Error('One or more Playwright suites did not produce JUnit XML.');
  }

  if (failures.length > 0) {
    console.warn('\nPlaywright suites reported failures. Continuing so the analytics pipeline can parse the JUnit XML.');
    for (const failure of failures) {
      console.warn(`- ${failure}`);
    }
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.size > 0;
  } catch {
    return false;
  }
}

function selectedSuites(): Set<string> {
  const configured = process.env.E2E_SUITES;

  if (!configured) {
    return new Set(suites.map((suite) => suite.id));
  }

  const selected = new Set(
    configured
      .split(',')
      .map((suite) => suite.trim())
      .filter(Boolean),
  );
  const knownSuiteIds = new Set(suites.map((suite) => suite.id));
  const unknownSuiteIds = [...selected].filter((suiteId) => !knownSuiteIds.has(suiteId));

  if (unknownSuiteIds.length > 0) {
    throw new Error(`Unknown E2E suite id(s): ${unknownSuiteIds.join(', ')}.`);
  }

  if (selected.size === 0) {
    throw new Error('E2E_SUITES did not contain any suite ids.');
  }

  return selected;
}

function runSuite(suite: Suite): Promise<number> {
  const useShell = process.platform === 'win32';
  const child = spawn(useShell ? 'npm run test' : 'npm', useShell ? [] : ['run', 'test'], {
    cwd: suite.cwd,
    env: {
      ...process.env,
      BASE_URL: baseURL,
      PLAYWRIGHT_JUNIT_OUTPUT_NAME: suite.junitOutput,
      TS_NODE_TRANSPILE_ONLY: 'true',
    },
    stdio: 'inherit',
    shell: useShell,
  });

  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function waitForApp(url: string) {
  const timeoutMs = Number(process.env.E2E_APP_WAIT_TIMEOUT_MS ?? 120_000);
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);

      if (response.ok || response.status < 500) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for Phantom Brew at ${url}.${suffix}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`test:e2e failed: ${message}`);
  process.exitCode = 1;
});
