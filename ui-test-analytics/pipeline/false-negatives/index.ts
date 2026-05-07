import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { appendCsvRows, readCsvRows, type CsvRow } from '../lib/csv';

type TestStatus = 'passed' | 'failed' | 'error' | 'skipped';
type AiVerdict = 'real_bug' | 'flaky' | 'test_issue' | 'environment_issue';
type TrapType = 'false_positive' | 'false_negative' | 'observed_false_positive' | 'none';

interface CliOptions {
  testResults?: string;
  groundTruth?: string;
  output?: string;
  runId?: string;
}

interface TestResult {
  runId: string;
  runDate: string;
  testSuite: string;
  testCase: string;
  status: TestStatus;
}

interface GroundTruthLabel {
  test_id: string;
  test_name: string;
  aliases?: string[];
  trap_type: TrapType;
  expected_verdict: AiVerdict;
  root_cause: string;
  is_app_bug: boolean;
  notes: string;
  source?: 'designed' | 'observed';
  status?: 'confirmed' | 'provisional';
}

interface GroundTruthFile {
  labels: GroundTruthLabel[];
}

interface FalseNegativeCandidate {
  runId: string;
  runDate: string;
  testSuite: string;
  testCase: string;
  status: TestStatus;
  matchedTestId: string;
  matchedTestName: string;
  expectedVerdict: AiVerdict;
  rootCause: string;
  detectionSource: string;
  recommendedAction: string;
}

const OUTPUT_HEADER = [
  'run_id',
  'run_date',
  'test_suite',
  'test_case',
  'status',
  'matched_test_id',
  'matched_test_name',
  'expected_verdict',
  'root_cause',
  'detection_source',
  'recommended_action',
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const resultsDir = process.env.RESULTS_DIR ?? 'results';
  const testResultsFile =
    options.testResults ?? process.env.TEST_RESULTS_CSV ?? path.join(resultsDir, 'test-results.csv');
  const groundTruthFile =
    options.groundTruth ?? process.env.GROUND_TRUTH_JSON ?? path.join('tests', 'ground-truth', 'ground-truth-labels.json');
  const outputFile =
    options.output ??
    process.env.FALSE_NEGATIVE_CANDIDATES_CSV ??
    path.join(resultsDir, 'false-negative-candidates.csv');

  const testResults = (await readCsvRows(testResultsFile))
    .map(toTestResult)
    .filter((row): row is TestResult => row !== null);

  if (testResults.length === 0) {
    await appendCsvRows(outputFile, OUTPUT_HEADER, []);
    console.log(`No test result rows found in ${path.resolve(testResultsFile)}. Wrote CSV header only.`);
    return;
  }

  const labels = await loadFalseNegativeLabels(groundTruthFile);
  const labelsByKey = buildLabelIndex(labels);
  const currentRunId = options.runId ?? defaultRunId() ?? latestRunId(testResults);
  const candidates = testResults
    .filter((row) => row.runId === currentRunId && row.status === 'passed')
    .map((row) => toFalseNegativeCandidate(row, labelsByKey.get(normalize(row.testCase))))
    .filter((row): row is FalseNegativeCandidate => row !== null);

  await appendCsvRows(
    outputFile,
    OUTPUT_HEADER,
    candidates.map((candidate) => [
      candidate.runId,
      candidate.runDate,
      candidate.testSuite,
      candidate.testCase,
      candidate.status,
      candidate.matchedTestId,
      candidate.matchedTestName,
      candidate.expectedVerdict,
      candidate.rootCause,
      candidate.detectionSource,
      candidate.recommendedAction,
    ]),
  );

  console.log(
    [
      `Found ${candidates.length} false-negative candidate(s) for run '${currentRunId}'.`,
      `labels=${labels.length}`,
      `output=${path.resolve(outputFile)}`,
    ].join(' '),
  );
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--test-results') {
      options.testResults = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--test-results=')) {
      options.testResults = arg.slice('--test-results='.length);
      continue;
    }

    if (arg === '--ground-truth') {
      options.groundTruth = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--ground-truth=')) {
      options.groundTruth = arg.slice('--ground-truth='.length);
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

function toTestResult(row: CsvRow): TestResult | null {
  const runId = row.run_id?.trim();
  const testCase = row.test_case?.trim();

  if (!runId || !testCase) {
    return null;
  }

  return {
    runId,
    runDate: row.run_date?.trim() ?? '',
    testSuite: row.test_suite?.trim() || '(unknown suite)',
    testCase,
    status: normalizeStatus(row.status),
  };
}

function normalizeStatus(status: string | undefined): TestStatus {
  if (status === 'failed' || status === 'error' || status === 'skipped' || status === 'passed') {
    return status;
  }

  return 'passed';
}

async function loadFalseNegativeLabels(filePath: string): Promise<GroundTruthLabel[]> {
  const file = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(file) as GroundTruthFile;

  if (!Array.isArray(parsed.labels)) {
    return [];
  }

  return parsed.labels.filter(
    (label) =>
      label.trap_type === 'false_negative' &&
      label.expected_verdict === 'real_bug' &&
      label.is_app_bug &&
      label.source !== 'observed' &&
      label.status !== 'provisional',
  );
}

function buildLabelIndex(labels: GroundTruthLabel[]): Map<string, GroundTruthLabel> {
  const labelsByKey = new Map<string, GroundTruthLabel>();

  for (const label of labels) {
    const keys = [label.test_id, label.test_name, ...(label.aliases ?? [])].map(normalize).filter(Boolean);

    for (const key of keys) {
      if (!labelsByKey.has(key)) {
        labelsByKey.set(key, label);
      }
    }
  }

  return labelsByKey;
}

function toFalseNegativeCandidate(
  testResult: TestResult,
  label: GroundTruthLabel | undefined,
): FalseNegativeCandidate | null {
  if (!label) {
    return null;
  }

  return {
    runId: testResult.runId,
    runDate: testResult.runDate,
    testSuite: testResult.testSuite,
    testCase: testResult.testCase,
    status: testResult.status,
    matchedTestId: label.test_id,
    matchedTestName: label.test_name,
    expectedVerdict: label.expected_verdict,
    rootCause: label.root_cause,
    detectionSource: 'ground_truth_alias_passed_test',
    recommendedAction: `Current test passed but matches ${label.test_id}. Add or run an oracle assertion that verifies the hidden bug condition.`,
  };
}

function latestRunId(testResults: TestResult[]): string {
  return testResults[testResults.length - 1].runId;
}

function defaultRunId(): string | undefined {
  const configured =
    process.env.EFFECTIVE_RUN_ID ??
    process.env.PIPELINE_RUN_ID ??
    process.env.BUILD_TAG ??
    process.env.BUILD_NUMBER;

  return configured && configured.trim() ? configured.trim() : undefined;
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/[›>|:：]/g, ' ').replace(/\s+/g, ' ');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`false-negative scan failed: ${message}`);
  process.exitCode = 1;
});
