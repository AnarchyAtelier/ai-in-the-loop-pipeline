import OpenAI from 'openai';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { appendCsvRows, readCsvRows, type CsvRow } from '../lib/csv';

type AiVerdict = 'real_bug' | 'flaky' | 'test_issue' | 'environment_issue';
type TestStatus = 'passed' | 'failed' | 'error' | 'skipped';

interface CliOptions {
  testResults?: string;
  diffResults?: string;
  output?: string;
  runId?: string;
  dryRun: boolean;
  includePassed: boolean;
}

interface TestResult {
  runId: string;
  runDate: string;
  testSuite: string;
  testCase: string;
  status: TestStatus;
  errorType: string;
  errorMessage: string;
  durationMs: number;
}

interface DiffResult {
  runId: string;
  testCase: string;
  diffStatus: string;
  previousErrorType: string;
  currentErrorType: string;
  consecutivePassCount: number;
}

interface TriageInputCase {
  run_id: string;
  run_date: string;
  test_suite: string;
  test_case: string;
  status: TestStatus;
  error_type: string;
  error_message: string;
  duration_ms: number;
  diff_status: string;
  previous_error_type: string;
  current_error_type: string;
  consecutive_pass_count: number;
}

interface TriageResult {
  test_case: string;
  ai_verdict: AiVerdict;
  confidence: number;
  estimated_root_cause: string;
  recommended_action: string;
  is_false_positive: boolean;
  is_false_negative: boolean;
}

const TRIAGE_HEADER = [
  'run_id',
  'test_case',
  'ai_verdict',
  'confidence',
  'estimated_root_cause',
  'recommended_action',
  'is_false_positive',
  'is_false_negative',
];

const TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'test_case',
          'ai_verdict',
          'confidence',
          'estimated_root_cause',
          'recommended_action',
          'is_false_positive',
          'is_false_negative',
        ],
        properties: {
          test_case: { type: 'string' },
          ai_verdict: {
            type: 'string',
            enum: ['real_bug', 'flaky', 'test_issue', 'environment_issue'],
          },
          confidence: { type: 'number' },
          estimated_root_cause: { type: 'string' },
          recommended_action: { type: 'string' },
          is_false_positive: { type: 'boolean' },
          is_false_negative: { type: 'boolean' },
        },
      },
    },
  },
} as const;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const resultsDir = process.env.RESULTS_DIR ?? 'results';
  const testResultsFile =
    options.testResults ?? process.env.TEST_RESULTS_CSV ?? path.join(resultsDir, 'test-results.csv');
  const diffResultsFile =
    options.diffResults ?? process.env.DIFF_RESULTS_CSV ?? path.join(resultsDir, 'diff-results.csv');
  const outputFile =
    options.output ?? process.env.TRIAGE_RESULTS_CSV ?? path.join(resultsDir, 'triage-results.csv');

  const testResults = (await readCsvRows(testResultsFile))
    .map(toTestResult)
    .filter((row): row is TestResult => row !== null);
  const diffResults = (await readCsvRowsIfExists(diffResultsFile))
    .map(toDiffResult)
    .filter((row): row is DiffResult => row !== null);

  if (testResults.length === 0) {
    await appendCsvRows(outputFile, TRIAGE_HEADER, []);
    console.log(`No test result rows found in ${path.resolve(testResultsFile)}. Wrote CSV header only.`);
    return;
  }

  const currentRunId = options.runId ?? defaultRunId() ?? latestRunId(testResults);
  const currentResults = testResults.filter((row) => row.runId === currentRunId);

  if (currentResults.length === 0) {
    throw new Error(`Run id '${currentRunId}' was not found in ${path.resolve(testResultsFile)}.`);
  }

  const diffByTestCase = new Map(
    diffResults.filter((row) => row.runId === currentRunId).map((row) => [row.testCase, row]),
  );
  const inputCases = currentResults
    .filter((row) => options.includePassed || isFailure(row))
    .map((row) => toTriageInputCase(row, diffByTestCase.get(row.testCase)));

  if (inputCases.length === 0) {
    await appendCsvRows(outputFile, TRIAGE_HEADER, []);
    console.log(`No failing test cases found for run '${currentRunId}'. Wrote CSV header only.`);
    return;
  }

  const triageResults = options.dryRun ? dryRunTriage(inputCases) : await aiTriage(inputCases);
  const triageByTestCase = new Map(triageResults.map((result) => [result.test_case, result]));
  const rows = inputCases.map((inputCase) => {
    const result = triageByTestCase.get(inputCase.test_case);

    if (!result) {
      throw new Error(`AI triage did not return a result for '${inputCase.test_case}'.`);
    }

    return [
      inputCase.run_id,
      inputCase.test_case,
      result.ai_verdict,
      normalizeConfidence(result.confidence).toFixed(2),
      result.estimated_root_cause,
      result.recommended_action,
      String(result.is_false_positive),
      String(result.is_false_negative),
    ];
  });

  await appendCsvRows(outputFile, TRIAGE_HEADER, rows);

  const summary = countBy(triageResults, (result) => result.ai_verdict);
  console.log(
    [
      `Triaged ${triageResults.length} test case(s) for run '${currentRunId}'.`,
      options.dryRun ? 'mode=dry-run' : `model=${modelName()}`,
      `real_bug=${summary.real_bug ?? 0}`,
      `flaky=${summary.flaky ?? 0}`,
      `test_issue=${summary.test_issue ?? 0}`,
      `environment_issue=${summary.environment_issue ?? 0}`,
      `output=${path.resolve(outputFile)}`,
    ].join(' '),
  );
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: process.env.TRIAGE_DRY_RUN === '1',
    includePassed: process.env.TRIAGE_INCLUDE_PASSED === '1',
  };

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

    if (arg === '--diff-results') {
      options.diffResults = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--diff-results=')) {
      options.diffResults = arg.slice('--diff-results='.length);
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

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--include-passed') {
      options.includePassed = true;
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

function defaultRunId(): string | undefined {
  const configured =
    process.env.EFFECTIVE_RUN_ID ??
    process.env.PIPELINE_RUN_ID ??
    process.env.BUILD_TAG ??
    process.env.BUILD_NUMBER;

  return configured && configured.trim() ? configured.trim() : undefined;
}

function latestRunId(testResults: TestResult[]): string {
  return [...testResults].sort((a, b) => {
    const dateDiff = parseDate(a.runDate) - parseDate(b.runDate);
    return dateDiff === 0 ? testResults.indexOf(a) - testResults.indexOf(b) : dateDiff;
  })[testResults.length - 1].runId;
}

function parseDate(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
    errorType: row.error_type?.trim() ?? '',
    errorMessage: row.error_message?.trim() ?? '',
    durationMs: Number(row.duration_ms ?? 0) || 0,
  };
}

function toDiffResult(row: CsvRow): DiffResult | null {
  const runId = row.run_id?.trim();
  const testCase = row.test_case?.trim();

  if (!runId || !testCase) {
    return null;
  }

  return {
    runId,
    testCase,
    diffStatus: row.diff_status?.trim() ?? '',
    previousErrorType: row.previous_error_type?.trim() ?? '',
    currentErrorType: row.current_error_type?.trim() ?? '',
    consecutivePassCount: Number(row.consecutive_pass_count ?? 0) || 0,
  };
}

function normalizeStatus(status: string | undefined): TestStatus {
  if (status === 'failed' || status === 'error' || status === 'skipped' || status === 'passed') {
    return status;
  }

  return 'passed';
}

function isFailure(row: TestResult): boolean {
  return row.status === 'failed' || row.status === 'error';
}

function toTriageInputCase(testResult: TestResult, diffResult: DiffResult | undefined): TriageInputCase {
  return {
    run_id: testResult.runId,
    run_date: testResult.runDate,
    test_suite: testResult.testSuite,
    test_case: testResult.testCase,
    status: testResult.status,
    error_type: testResult.errorType,
    error_message: testResult.errorMessage,
    duration_ms: testResult.durationMs,
    diff_status: diffResult?.diffStatus ?? '',
    previous_error_type: diffResult?.previousErrorType ?? '',
    current_error_type: diffResult?.currentErrorType ?? testResult.errorType,
    consecutive_pass_count: diffResult?.consecutivePassCount ?? 0,
  };
}

async function aiTriage(inputCases: TriageInputCase[]): Promise<TriageResult[]> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required unless --dry-run or TRIAGE_DRY_RUN=1 is used.');
  }

  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: modelName(),
    instructions: triageInstructions(),
    input: JSON.stringify({ test_cases: inputCases }, null, 2),
    max_output_tokens: Math.max(1200, inputCases.length * 320),
    store: false,
    text: {
      format: {
        type: 'json_schema',
        name: 'triage_results',
        strict: true,
        schema: TRIAGE_SCHEMA,
      },
    },
  });

  return parseTriageResponse(response.output_text);
}

function modelName(): string {
  return process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini';
}

function triageInstructions(): string {
  return [
    'You triage Playwright UI test results for a CI pipeline.',
    'Use only the supplied test result and diff context.',
    'Return one result object for every input test_case.',
    '',
    'Verdict definitions:',
    '- real_bug: the failure likely exposes a real application defect.',
    '- flaky: nondeterministic timing, animation, async update, random delay, transient UI, or race behavior is the primary explanation.',
    '- test_issue: the test is too brittle, uses a bad selector, asserts the wrong thing, or over-specifies implementation details.',
    '- environment_issue: CI/server startup, network, dependency, rate limiting, 429, ECONNREFUSED, 500/503 infrastructure, or configuration is the primary explanation.',
    '',
    'is_false_positive should be true when a current failure is probably not an app bug.',
    'is_false_negative should be true when evidence suggests a real app bug that weaker tests could miss, especially edge-case validation, calculation, ordering, pagination, coupon, or concurrency defects.',
    'Keep root causes and actions concrete and short.',
  ].join('\n');
}

function parseTriageResponse(outputText: string): TriageResult[] {
  const parsed = JSON.parse(outputText) as unknown;

  if (!isObject(parsed) || !Array.isArray(parsed.results)) {
    throw new Error('AI response did not match the expected triage_results shape.');
  }

  return parsed.results.map(validateTriageResult);
}

function validateTriageResult(value: unknown): TriageResult {
  if (!isObject(value)) {
    throw new Error('AI response contained a non-object triage result.');
  }

  const aiVerdict = value.ai_verdict;

  if (!isAiVerdict(aiVerdict)) {
    throw new Error(`AI response contained an invalid ai_verdict: ${String(aiVerdict)}`);
  }

  return {
    test_case: stringValue(value.test_case, 'test_case'),
    ai_verdict: aiVerdict,
    confidence: normalizeConfidence(numberValue(value.confidence, 'confidence')),
    estimated_root_cause: stringValue(value.estimated_root_cause, 'estimated_root_cause'),
    recommended_action: stringValue(value.recommended_action, 'recommended_action'),
    is_false_positive: booleanValue(value.is_false_positive, 'is_false_positive'),
    is_false_negative: booleanValue(value.is_false_negative, 'is_false_negative'),
  };
}

function dryRunTriage(inputCases: TriageInputCase[]): TriageResult[] {
  return inputCases.map((inputCase) => {
    const text = `${inputCase.test_case} ${inputCase.error_type} ${inputCase.error_message}`.toLowerCase();
    const isKnownRealBug =
      /税|tax|coupon|クーポン|リンク先|sort|ソート|pagination|ページネーション|数量|race|メール|email|validation|バリデーション/.test(
        text,
      );
    const isEnvironment =
      /econnrefused|(^|[^0-9])5(?:00|03)([^0-9]|$)|429|rate limit|too many requests|cold start|server startup/.test(
        text,
      );
    const isFlaky = /timeout|timed out|exceeded|sse|animation|animated|race|random|flaky|wait/.test(text);
    const isSelectorIssue = /locator|selector|element not found|strict mode|form-row/.test(text);

    if (isKnownRealBug) {
      return {
        test_case: inputCase.test_case,
        ai_verdict: 'real_bug',
        confidence: 0.82,
        estimated_root_cause: 'The failure matches an edge-case application defect rather than a transient test failure.',
        recommended_action: 'Reproduce the scenario manually, fix the application logic, then keep this test as regression coverage.',
        is_false_positive: false,
        is_false_negative: true,
      };
    }

    if (isEnvironment) {
      return {
        test_case: inputCase.test_case,
        ai_verdict: 'environment_issue',
        confidence: 0.78,
        estimated_root_cause: 'The error points to server availability, rate limiting, or CI environment instability.',
        recommended_action: 'Check service startup, network readiness, rate limits, and Jenkins environment before changing app code.',
        is_false_positive: true,
        is_false_negative: false,
      };
    }

    if (isFlaky) {
      return {
        test_case: inputCase.test_case,
        ai_verdict: 'flaky',
        confidence: 0.72,
        estimated_root_cause: 'The failure appears timing-dependent or nondeterministic.',
        recommended_action: 'Replace fixed waits with observable readiness signals and rerun the test to confirm stability.',
        is_false_positive: true,
        is_false_negative: false,
      };
    }

    if (isSelectorIssue) {
      return {
        test_case: inputCase.test_case,
        ai_verdict: 'test_issue',
        confidence: 0.7,
        estimated_root_cause: 'The failure is likely caused by a brittle locator or implementation-coupled selector.',
        recommended_action: 'Rewrite the test around user-visible roles, labels, or stable test ids.',
        is_false_positive: true,
        is_false_negative: false,
      };
    }

    return {
      test_case: inputCase.test_case,
      ai_verdict: 'test_issue',
      confidence: 0.55,
      estimated_root_cause: 'There is not enough evidence to distinguish an app defect from a test design issue.',
      recommended_action: 'Inspect the failing page state and add a more specific assertion or diagnostic artifact.',
      is_false_positive: true,
      is_false_negative: false,
    };
  });
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function stringValue(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`AI response field '${fieldName}' must be a string.`);
  }

  return value;
}

function numberValue(value: unknown, fieldName: string): number {
  if (typeof value !== 'number') {
    throw new Error(`AI response field '${fieldName}' must be a number.`);
  }

  return value;
}

function booleanValue(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`AI response field '${fieldName}' must be a boolean.`);
  }

  return value;
}

function isAiVerdict(value: unknown): value is AiVerdict {
  return (
    value === 'real_bug' ||
    value === 'flaky' ||
    value === 'test_issue' ||
    value === 'environment_issue'
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function countBy<T extends string>(
  rows: TriageResult[],
  keySelector: (row: TriageResult) => T,
): Partial<Record<T, number>> {
  const counts: Partial<Record<T, number>> = {};

  for (const row of rows) {
    const key = keySelector(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`triage failed: ${message}`);
  process.exitCode = 1;
});
