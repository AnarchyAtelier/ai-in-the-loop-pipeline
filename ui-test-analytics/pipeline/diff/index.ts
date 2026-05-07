import path from 'node:path';
import { appendCsvRows, readCsvRows, type CsvRow } from '../lib/csv';

type TestStatus = 'passed' | 'failed' | 'error' | 'skipped';
type DiffStatus = 'new_failure' | 'unresolved' | 'resolved' | 'still_passing';

interface CliOptions {
  input?: string;
  output?: string;
  runId?: string;
}

interface TestResult {
  index: number;
  runId: string;
  runDate: string;
  testSuite: string;
  testCase: string;
  status: TestStatus;
  errorType: string;
}

interface RunSnapshot {
  runId: string;
  runDate: string;
  dateMs: number;
  firstIndex: number;
  lastIndex: number;
  rows: TestResult[];
}

interface DiffResult {
  runId: string;
  runDate: string;
  testSuite: string;
  testCase: string;
  diffStatus: DiffStatus;
  previousErrorType: string;
  currentErrorType: string;
  consecutivePassCount: number;
}

const DIFF_HEADER = [
  'run_id',
  'run_date',
  'test_suite',
  'test_case',
  'diff_status',
  'previous_error_type',
  'current_error_type',
  'consecutive_pass_count',
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputFile =
    options.input ??
    process.env.TEST_RESULTS_CSV ??
    path.join(process.env.RESULTS_DIR ?? 'results', 'test-results.csv');
  const outputFile =
    options.output ??
    process.env.DIFF_RESULTS_CSV ??
    path.join(process.env.RESULTS_DIR ?? 'results', 'diff-results.csv');

  const csvRows = await readCsvRows(inputFile);
  const testResults = csvRows.map(toTestResult).filter((row): row is TestResult => row !== null);

  if (testResults.length === 0) {
    await appendCsvRows(outputFile, DIFF_HEADER, []);
    console.log(`No test result rows found in ${path.resolve(inputFile)}. Wrote CSV header only.`);
    return;
  }

  const snapshots = buildRunSnapshots(testResults);
  const currentRunId = options.runId ?? defaultRunId() ?? latestRunId(snapshots);
  const currentRun = snapshots.find((snapshot) => snapshot.runId === currentRunId);

  if (!currentRun) {
    throw new Error(`Run id '${currentRunId}' was not found in ${path.resolve(inputFile)}.`);
  }

  const previousRun = findPreviousRun(snapshots, currentRun);
  const diffRows = buildDiffRows(snapshots, currentRun, previousRun);

  await appendCsvRows(
    outputFile,
    DIFF_HEADER,
    diffRows.map((row) => [
      row.runId,
      row.runDate,
      row.testSuite,
      row.testCase,
      row.diffStatus,
      row.previousErrorType,
      row.currentErrorType,
      String(row.consecutivePassCount),
    ]),
  );

  const summary = countBy(diffRows, (row) => row.diffStatus);
  console.log(
    [
      `Compared run '${currentRun.runId}'`,
      previousRun ? `against '${previousRun.runId}'.` : 'without a previous run.',
      `rows=${diffRows.length}`,
      `new_failure=${summary.new_failure ?? 0}`,
      `unresolved=${summary.unresolved ?? 0}`,
      `resolved=${summary.resolved ?? 0}`,
      `still_passing=${summary.still_passing ?? 0}`,
      `output=${path.resolve(outputFile)}`,
    ].join(' '),
  );
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--input' || arg === '-i') {
      options.input = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--input=')) {
      options.input = arg.slice('--input='.length);
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

    options.input = arg;
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

function defaultRunId(): string | undefined {
  const configured =
    process.env.EFFECTIVE_RUN_ID ??
    process.env.PIPELINE_RUN_ID ??
    process.env.BUILD_TAG ??
    process.env.BUILD_NUMBER;

  return configured && configured.trim() ? configured.trim() : undefined;
}

function toTestResult(row: CsvRow, index: number): TestResult | null {
  const runId = row.run_id?.trim();
  const testCase = row.test_case?.trim();

  if (!runId || !testCase) {
    return null;
  }

  return {
    index,
    runId,
    runDate: row.run_date?.trim() ?? '',
    testSuite: row.test_suite?.trim() || '(unknown suite)',
    testCase,
    status: normalizeStatus(row.status),
    errorType: row.error_type?.trim() ?? '',
  };
}

function normalizeStatus(status: string | undefined): TestStatus {
  if (status === 'failed' || status === 'error' || status === 'skipped' || status === 'passed') {
    return status;
  }

  return 'passed';
}

function buildRunSnapshots(testResults: TestResult[]): RunSnapshot[] {
  const snapshotsByRunId = new Map<string, RunSnapshot>();

  for (const row of testResults) {
    const existing = snapshotsByRunId.get(row.runId);
    const dateMs = parseDate(row.runDate);

    if (existing) {
      existing.rows.push(row);
      existing.firstIndex = Math.min(existing.firstIndex, row.index);
      existing.lastIndex = Math.max(existing.lastIndex, row.index);

      if (dateMs >= existing.dateMs) {
        existing.runDate = row.runDate;
        existing.dateMs = dateMs;
      }
      continue;
    }

    snapshotsByRunId.set(row.runId, {
      runId: row.runId,
      runDate: row.runDate,
      dateMs,
      firstIndex: row.index,
      lastIndex: row.index,
      rows: [row],
    });
  }

  return [...snapshotsByRunId.values()].sort(compareRuns);
}

function parseDate(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareRuns(a: RunSnapshot, b: RunSnapshot): number {
  if (a.dateMs !== b.dateMs) {
    return a.dateMs - b.dateMs;
  }

  return a.lastIndex - b.lastIndex;
}

function latestRunId(snapshots: RunSnapshot[]): string {
  return snapshots[snapshots.length - 1].runId;
}

function findPreviousRun(snapshots: RunSnapshot[], currentRun: RunSnapshot): RunSnapshot | undefined {
  const currentIndex = snapshots.findIndex((snapshot) => snapshot.runId === currentRun.runId);

  if (currentIndex <= 0) {
    return undefined;
  }

  return snapshots[currentIndex - 1];
}

function buildDiffRows(
  snapshots: RunSnapshot[],
  currentRun: RunSnapshot,
  previousRun: RunSnapshot | undefined,
): DiffResult[] {
  const currentRows = latestRowsByTest(currentRun.rows);
  const previousRows = previousRun ? latestRowsByTest(previousRun.rows) : new Map<string, TestResult>();
  const suitePassStreaks = calculateSuitePassStreaks(snapshots, currentRun);
  const keys = new Set([...currentRows.keys(), ...previousRows.keys()]);
  const diffRows: DiffResult[] = [];

  for (const key of [...keys].sort()) {
    const current = currentRows.get(key);
    const previous = previousRows.get(key);
    const diffStatus = classifyDiff(previous, current);

    if (!diffStatus) {
      continue;
    }

    const suiteName = current?.testSuite ?? previous?.testSuite ?? '(unknown suite)';

    diffRows.push({
      runId: currentRun.runId,
      runDate: currentRun.runDate,
      testCase: current?.testCase ?? previous?.testCase ?? '(unknown test case)',
      testSuite: suiteName,
      diffStatus,
      previousErrorType: previous && isFailure(previous) ? previous.errorType : '',
      currentErrorType: current && isFailure(current) ? current.errorType : '',
      consecutivePassCount: suitePassStreaks.get(suiteName) ?? 0,
    });
  }

  return diffRows;
}

function latestRowsByTest(rows: TestResult[]): Map<string, TestResult> {
  const map = new Map<string, TestResult>();

  for (const row of rows) {
    map.set(testKey(row), row);
  }

  return map;
}

function testKey(row: TestResult): string {
  return `${row.testSuite}\u0000${row.testCase}`;
}

function classifyDiff(previous: TestResult | undefined, current: TestResult | undefined): DiffStatus | null {
  if (current && isFailure(current)) {
    return previous && isFailure(previous) ? 'unresolved' : 'new_failure';
  }

  if (previous && isFailure(previous)) {
    return 'resolved';
  }

  if (current) {
    return 'still_passing';
  }

  return null;
}

function isFailure(row: TestResult): boolean {
  return row.status === 'failed' || row.status === 'error';
}

function calculateSuitePassStreaks(
  snapshots: RunSnapshot[],
  currentRun: RunSnapshot,
): Map<string, number> {
  const snapshotsThroughCurrent = snapshots
    .filter((snapshot) => compareRuns(snapshot, currentRun) <= 0)
    .sort(compareRuns)
    .reverse();
  const currentSuites = new Set(currentRun.rows.map((row) => row.testSuite));
  const streaks = new Map<string, number>();

  for (const suiteName of currentSuites) {
    let streak = 0;

    for (const snapshot of snapshotsThroughCurrent) {
      const suiteRows = snapshot.rows.filter((row) => row.testSuite === suiteName);

      if (suiteRows.length === 0 || suiteRows.some(isFailure)) {
        break;
      }

      streak += 1;
    }

    streaks.set(suiteName, streak);
  }

  return streaks;
}

function countBy<T extends string>(rows: DiffResult[], keySelector: (row: DiffResult) => T): Partial<Record<T, number>> {
  const counts: Partial<Record<T, number>> = {};

  for (const row of rows) {
    const key = keySelector(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`diff failed: ${message}`);
  process.exitCode = 1;
});
