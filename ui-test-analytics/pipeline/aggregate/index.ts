import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readCsvRows, type CsvRow } from '../lib/csv';

interface CliOptions {
  output?: string;
  runId?: string;
}

interface DashboardSummary {
  run_id: string;
  generated_at: string;
  source_files: Record<string, string>;
  counts: {
    test_results: number;
    diff_results: number;
    triage_results: number;
    false_negative_candidates: number;
    eval_results: number;
    action_suggestions: number;
  };
  test_status: Record<string, number>;
  diff_status: Record<string, number>;
  ai_verdict: Record<string, number>;
  false_negative_by_trap: Record<string, number>;
  eval_latest: CsvRow | null;
  action_summary: unknown;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const resultsDir = process.env.RESULTS_DIR ?? 'results';
  const outputFile = options.output ?? process.env.DASHBOARD_SUMMARY_JSON ?? path.join(resultsDir, 'dashboard-summary.json');
  const runId = options.runId ?? defaultRunId();
  const files = {
    test_results: process.env.TEST_RESULTS_CSV ?? path.join(resultsDir, 'test-results.csv'),
    diff_results: process.env.DIFF_RESULTS_CSV ?? path.join(resultsDir, 'diff-results.csv'),
    false_negative_candidates:
      process.env.FALSE_NEGATIVE_CANDIDATES_CSV ?? path.join(resultsDir, 'false-negative-candidates.csv'),
    triage_results: process.env.TRIAGE_RESULTS_CSV ?? path.join(resultsDir, 'triage-results.csv'),
    eval_results: process.env.EVAL_RESULTS_CSV ?? path.join(resultsDir, 'eval-results.csv'),
    action_summary: process.env.ACTION_SUMMARY_JSON ?? path.join(resultsDir, 'action-summary.json'),
  };

  const [testResults, diffResults, falseNegativeCandidates, triageResults, evalResults, actionSummary] = await Promise.all([
    readCsvRowsIfExists(files.test_results),
    readCsvRowsIfExists(files.diff_results),
    readCsvRowsIfExists(files.false_negative_candidates),
    readCsvRowsIfExists(files.triage_results),
    readCsvRowsIfExists(files.eval_results),
    readJsonIfExists(files.action_summary),
  ]);
  const effectiveRunId =
    runId ?? latestRunId(testResults, diffResults, falseNegativeCandidates, triageResults, evalResults) ?? 'unknown';
  const currentTestResults = filterByRun(testResults, effectiveRunId);
  const currentDiffResults = filterByRun(diffResults, effectiveRunId);
  const currentFalseNegativeCandidates = filterByRun(falseNegativeCandidates, effectiveRunId);
  const currentTriageResults = filterByRun(triageResults, effectiveRunId);
  const currentEvalResults = filterByRun(evalResults, effectiveRunId);
  const dashboardSummary: DashboardSummary = {
    run_id: effectiveRunId,
    generated_at: new Date().toISOString(),
    source_files: Object.fromEntries(Object.entries(files).map(([key, value]) => [key, path.resolve(value)])),
    counts: {
      test_results: currentTestResults.length,
      diff_results: currentDiffResults.length,
      false_negative_candidates: currentFalseNegativeCandidates.length,
      triage_results: currentTriageResults.length,
      eval_results: currentEvalResults.length,
      action_suggestions: countActionSuggestions(actionSummary),
    },
    test_status: countBy(currentTestResults, 'status'),
    diff_status: countBy(currentDiffResults, 'diff_status'),
    ai_verdict: countBy(currentTriageResults, 'ai_verdict'),
    false_negative_by_trap: countBy(currentFalseNegativeCandidates, 'matched_test_id'),
    eval_latest: currentEvalResults.at(-1) ?? null,
    action_summary: actionSummary,
  };

  await writeJson(outputFile, dashboardSummary);
  console.log(`Aggregated pipeline outputs for run '${effectiveRunId}' into ${path.resolve(outputFile)}.`);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--output' || arg === '-o') {
      options.output = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
      continue;
    }

    if (arg === '--run-id') {
      options.runId = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--run-id=')) {
      options.runId = arg.slice('--run-id='.length);
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

async function readCsvRowsIfExists(filePath: string): Promise<CsvRow[]> {
  try {
    await access(filePath);
    return await readCsvRows(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function readJsonIfExists(filePath: string): Promise<unknown> {
  try {
    const content = await readFile(filePath, 'utf8');
    return JSON.parse(content) as unknown;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

function defaultRunId(): string | undefined {
  const configured =
    process.env.EFFECTIVE_RUN_ID ??
    process.env.PIPELINE_RUN_ID ??
    process.env.BUILD_TAG ??
    process.env.BUILD_NUMBER;

  return configured && configured.trim() ? configured.trim() : undefined;
}

function latestRunId(...rowGroups: CsvRow[][]): string | undefined {
  const rows = rowGroups.flat().filter((row) => row.run_id);
  return rows.at(-1)?.run_id;
}

function filterByRun(rows: CsvRow[], runId: string): CsvRow[] {
  return rows.filter((row) => row.run_id === runId);
}

function countBy(rows: CsvRow[], key: string): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const row of rows) {
    const value = row[key] || '(empty)';
    counts[value] = (counts[value] ?? 0) + 1;
  }

  return counts;
}

function countActionSuggestions(actionSummary: unknown): number {
  if (!isObject(actionSummary)) {
    return 0;
  }

  const actions = actionSummary.actions;
  return Array.isArray(actions) ? actions.length : 0;
}

async function writeJson(outputFile: string, value: unknown) {
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`aggregate failed: ${message}`);
  process.exitCode = 1;
});
