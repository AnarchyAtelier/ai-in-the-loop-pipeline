import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

type CsvRow = Record<string, string>;

interface CliOptions {
  artifactsRoot: string;
  output?: string;
}

interface RunSummary {
  artifact_dir: string;
  run_id: string;
  counts: {
    test_results: number;
    diff_results: number;
    false_negative_candidates: number;
    triage_results: number;
    eval_results: number;
  };
  test_status: Record<string, number>;
  diff_status: Record<string, number>;
  ai_verdict: Record<string, number>;
  false_negative_by_trap: Record<string, number>;
  suite_breakdown: SuiteSummary[];
  eval_latest: CsvRow | null;
}

interface SuiteSummary {
  suite_id: string;
  counts: {
    test_results: number;
    diff_results: number;
    false_negative_candidates: number;
    triage_results: number;
  };
  test_status: Record<string, number>;
  diff_status: Record<string, number>;
  ai_verdict: Record<string, number>;
  false_negative_by_trap: Record<string, number>;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const artifactsRoot = path.resolve(options.artifactsRoot);
  const outputFile = options.output ?? path.join(artifactsRoot, 'summary.json');
  const artifactDirs = await listArtifactDirs(artifactsRoot);
  const runs: RunSummary[] = [];

  for (const artifactDir of artifactDirs) {
    const summary = await summarizeArtifactDir(artifactsRoot, artifactDir);

    if (summary) {
      runs.push(summary);
    }
  }

  const summary = {
    generated_at: new Date().toISOString(),
    artifacts_root: artifactsRoot,
    runs,
  };

  await writeFile(outputFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${runs.length} run summary record(s) to ${path.resolve(outputFile)}.`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    artifactsRoot: 'build-artifacts',
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--artifacts-root') {
      options.artifactsRoot = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--artifacts-root=')) {
      options.artifactsRoot = arg.slice('--artifacts-root='.length);
      continue;
    }

    if (arg === '--output' || arg === '-o') {
      options.output = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function requireValue(args: string[], index: number, optionName: string): string {
  const value = args[index];
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${optionName}.`);
  }

  return value;
}

async function listArtifactDirs(artifactsRoot: string): Promise<string[]> {
  const entries = await readdir(artifactsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^\d+(st|nd|rd|th)$/.test(name))
    .sort(compareArtifactDir);
}

function compareArtifactDir(left: string, right: string): number {
  return Number.parseInt(left, 10) - Number.parseInt(right, 10);
}

async function summarizeArtifactDir(artifactsRoot: string, artifactDir: string): Promise<RunSummary | null> {
  const dirPath = path.join(artifactsRoot, artifactDir);
  const testResults = await readCsvIfExists(path.join(dirPath, 'test-results.csv'));
  const diffResults = await readCsvIfExists(path.join(dirPath, 'diff-results.csv'));
  const falseNegativeCandidates = await readCsvIfExists(path.join(dirPath, 'false-negative-candidates.csv'));
  const triageResults = await readCsvIfExists(path.join(dirPath, 'triage-results.csv'));
  const evalResults = await readCsvIfExists(path.join(dirPath, 'eval-results.csv'));
  const runId = latestRunId(testResults, diffResults, falseNegativeCandidates, triageResults, evalResults);

  if (!runId) {
    return null;
  }

  return {
    artifact_dir: artifactDir,
    run_id: runId,
    counts: {
      test_results: testResults.length,
      diff_results: diffResults.length,
      false_negative_candidates: falseNegativeCandidates.length,
      triage_results: triageResults.length,
      eval_results: evalResults.length,
    },
    test_status: countBy(testResults, 'status'),
    diff_status: countBy(diffResults, 'diff_status'),
    ai_verdict: countBy(triageResults, 'ai_verdict'),
    false_negative_by_trap: countBy(falseNegativeCandidates, 'matched_test_id'),
    suite_breakdown: summarizeSuites(testResults, diffResults, falseNegativeCandidates, triageResults),
    eval_latest: evalResults.at(-1) ?? null,
  };
}

function summarizeSuites(
  testResults: CsvRow[],
  diffResults: CsvRow[],
  falseNegativeCandidates: CsvRow[],
  triageResults: CsvRow[],
): SuiteSummary[] {
  const suiteIds = new Set<string>();

  for (const rows of [testResults, diffResults, falseNegativeCandidates, triageResults]) {
    for (const row of rows) {
      suiteIds.add(inferSuiteId(row));
    }
  }

  return Array.from(suiteIds)
    .sort(compareSuiteId)
    .map((suiteId) => {
      const suiteTestResults = testResults.filter((row) => inferSuiteId(row) === suiteId);
      const suiteDiffResults = diffResults.filter((row) => inferSuiteId(row) === suiteId);
      const suiteFalseNegativeCandidates = falseNegativeCandidates.filter((row) => inferSuiteId(row) === suiteId);
      const suiteTriageResults = triageResults.filter((row) => inferSuiteId(row) === suiteId);

      return {
        suite_id: suiteId,
        counts: {
          test_results: suiteTestResults.length,
          diff_results: suiteDiffResults.length,
          false_negative_candidates: suiteFalseNegativeCandidates.length,
          triage_results: suiteTriageResults.length,
        },
        test_status: countBy(suiteTestResults, 'status'),
        diff_status: countBy(suiteDiffResults, 'diff_status'),
        ai_verdict: countBy(suiteTriageResults, 'ai_verdict'),
        false_negative_by_trap: countBy(suiteFalseNegativeCandidates, 'matched_test_id'),
      };
    });
}

function inferSuiteId(row: CsvRow): string {
  const testCase = row.test_case ?? '';

  if (testCase.startsWith('Phantom Brew whitebox flows')) {
    return '1a-whitebox';
  }

  if (testCase.startsWith('Phantom Brew blackbox flows')) {
    return '1b-blackbox';
  }

  return '1c-naive';
}

function compareSuiteId(left: string, right: string): number {
  const order = ['1a-whitebox', '1b-blackbox', '1c-naive'];
  const leftIndex = order.indexOf(left);
  const rightIndex = order.indexOf(right);

  if (leftIndex === -1 && rightIndex === -1) {
    return left.localeCompare(right);
  }

  if (leftIndex === -1) {
    return 1;
  }

  if (rightIndex === -1) {
    return -1;
  }

  return leftIndex - rightIndex;
}

async function readCsvIfExists(filePath: string): Promise<CsvRow[]> {
  try {
    const rows = parseCsv(await readFile(filePath, 'utf8'));

    if (rows.length === 0) {
      return [];
    }

    const [header, ...dataRows] = rows;
    return dataRows
      .filter((row) => row.some((value) => value.trim() !== ''))
      .map((row) => Object.fromEntries(header.map((key, index) => [key, row[index] ?? ''])));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

function latestRunId(...rowGroups: CsvRow[][]): string | undefined {
  return rowGroups.flat().find((row) => row.run_id)?.run_id;
}

function countBy(rows: CsvRow[], key: string): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const row of rows) {
    const value = row[key] || '(empty)';
    counts[value] = (counts[value] ?? 0) + 1;
  }

  return counts;
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const nextChar = content[index + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        value += '"';
        index += 1;
        continue;
      }

      if (char === '"') {
        inQuotes = false;
        continue;
      }

      value += char;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(value);
      value = '';
      continue;
    }

    if (char === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      continue;
    }

    if (char === '\r') {
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`artifact summary failed: ${message}`);
  process.exitCode = 1;
});
