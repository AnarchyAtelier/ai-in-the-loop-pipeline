import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readCsvRows, type CsvRow } from '../lib/csv';

type DiffStatus = 'new_failure' | 'unresolved' | 'resolved' | 'still_passing';
type AiVerdict = 'real_bug' | 'flaky' | 'test_issue' | 'environment_issue' | '';
type Priority = 'high' | 'medium' | 'low' | 'info';
type ActionType =
  | 'real_bug_failure'
  | 'false_positive_review'
  | 'environment_check'
  | 'test_maintenance'
  | 'resolved'
  | 'stable'
  | 'watch';

interface CliOptions {
  diffResults?: string;
  triageResults?: string;
  output?: string;
  runId?: string;
}

interface DiffResult {
  rowIndex: number;
  runId: string;
  runDate: string;
  testCase: string;
  diffStatus: DiffStatus;
  previousErrorType: string;
  currentErrorType: string;
  consecutivePassCount: number;
}

interface TriageResult {
  runId: string;
  testCase: string;
  aiVerdict: AiVerdict;
  confidence: number;
  estimatedRootCause: string;
  recommendedAction: string;
  isFalsePositive: boolean;
  isFalseNegative: boolean;
}

interface Action {
  id: string;
  priority: Priority;
  type: ActionType;
  test_case: string;
  message: string;
  details: {
    diff_status: DiffStatus;
    ai_verdict: AiVerdict;
    confidence: number | null;
    error_type: string;
    failure_streak_count: number;
    consecutive_pass_count: number;
    estimated_root_cause: string;
    recommended_action: string;
  };
}

interface ActionSummary {
  run_id: string;
  generated_at: string;
  source_files: {
    diff_results: string;
    triage_results: string;
  };
  summary: {
    total_actions: number;
    high_priority: number;
    medium_priority: number;
    low_priority: number;
    info_priority: number;
    by_type: Record<ActionType, number>;
    by_verdict: Record<string, number>;
  };
  actions: Action[];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const resultsDir = process.env.RESULTS_DIR ?? 'results';
  const diffResultsFile =
    options.diffResults ?? process.env.DIFF_RESULTS_CSV ?? path.join(resultsDir, 'diff-results.csv');
  const triageResultsFile =
    options.triageResults ?? process.env.TRIAGE_RESULTS_CSV ?? path.join(resultsDir, 'triage-results.csv');
  const outputFile =
    options.output ?? process.env.ACTION_SUMMARY_JSON ?? path.join(resultsDir, 'action-summary.json');

  const diffResults = (await readCsvRows(diffResultsFile))
    .map(toDiffResult)
    .filter((row): row is DiffResult => row !== null);
  const triageResults = (await readCsvRows(triageResultsFile))
    .map(toTriageResult)
    .filter((row): row is TriageResult => row !== null);

  if (diffResults.length === 0) {
    const emptySummary = buildSummary({
      runId: options.runId ?? defaultRunId() ?? 'unknown',
      diffResultsFile,
      triageResultsFile,
      actions: [],
    });
    await writeJson(outputFile, emptySummary);
    console.log(`No diff rows found. Wrote empty action summary to ${path.resolve(outputFile)}.`);
    return;
  }

  const currentRunId = options.runId ?? defaultRunId() ?? latestRunId(diffResults);
  const currentDiffs = diffResults.filter((row) => row.runId === currentRunId);

  if (currentDiffs.length === 0) {
    throw new Error(`Run id '${currentRunId}' was not found in ${path.resolve(diffResultsFile)}.`);
  }

  const triageByTestCase = new Map(
    triageResults.filter((row) => row.runId === currentRunId).map((row) => [row.testCase, row]),
  );
  const failureStreaks = calculateFailureStreaks(diffResults, currentRunId);
  const actions = currentDiffs
    .map((diff) => buildAction(diff, triageByTestCase.get(diff.testCase), failureStreaks.get(diff.testCase) ?? 0))
    .filter((action): action is Action => action !== null)
    .sort(compareActions);
  const summary = buildSummary({
    runId: currentRunId,
    diffResultsFile,
    triageResultsFile,
    actions,
  });

  await writeJson(outputFile, summary);

  console.log(
    [
      `Generated ${actions.length} action suggestion(s) for run '${currentRunId}'.`,
      `high=${summary.summary.high_priority}`,
      `medium=${summary.summary.medium_priority}`,
      `low=${summary.summary.low_priority}`,
      `info=${summary.summary.info_priority}`,
      `output=${path.resolve(outputFile)}`,
    ].join(' '),
  );
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--diff-results') {
      options.diffResults = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--diff-results=')) {
      options.diffResults = arg.slice('--diff-results='.length);
      continue;
    }

    if (arg === '--triage-results') {
      options.triageResults = requireValue(args, ++index, arg);
      continue;
    }

    if (arg.startsWith('--triage-results=')) {
      options.triageResults = arg.slice('--triage-results='.length);
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

function defaultRunId(): string | undefined {
  const configured =
    process.env.EFFECTIVE_RUN_ID ??
    process.env.PIPELINE_RUN_ID ??
    process.env.BUILD_TAG ??
    process.env.BUILD_NUMBER;

  return configured && configured.trim() ? configured.trim() : undefined;
}

function toDiffResult(row: CsvRow, rowIndex: number): DiffResult | null {
  const runId = row.run_id?.trim();
  const testCase = row.test_case?.trim();

  if (!runId || !testCase) {
    return null;
  }

  return {
    rowIndex,
    runId,
    runDate: row.run_date?.trim() ?? '',
    testCase,
    diffStatus: normalizeDiffStatus(row.diff_status),
    previousErrorType: row.previous_error_type?.trim() ?? '',
    currentErrorType: row.current_error_type?.trim() ?? '',
    consecutivePassCount: Number(row.consecutive_pass_count ?? 0) || 0,
  };
}

function toTriageResult(row: CsvRow): TriageResult | null {
  const runId = row.run_id?.trim();
  const testCase = row.test_case?.trim();

  if (!runId || !testCase) {
    return null;
  }

  return {
    runId,
    testCase,
    aiVerdict: normalizeAiVerdict(row.ai_verdict),
    confidence: normalizeConfidence(Number(row.confidence ?? 0)),
    estimatedRootCause: row.estimated_root_cause?.trim() ?? '',
    recommendedAction: row.recommended_action?.trim() ?? '',
    isFalsePositive: row.is_false_positive === 'true',
    isFalseNegative: row.is_false_negative === 'true',
  };
}

function normalizeDiffStatus(value: string | undefined): DiffStatus {
  if (value === 'new_failure' || value === 'unresolved' || value === 'resolved' || value === 'still_passing') {
    return value;
  }

  return 'still_passing';
}

function normalizeAiVerdict(value: string | undefined): AiVerdict {
  if (value === 'real_bug' || value === 'flaky' || value === 'test_issue' || value === 'environment_issue') {
    return value;
  }

  return '';
}

function latestRunId(diffResults: DiffResult[]): string {
  return [...diffResults].sort(compareDiffRows)[diffResults.length - 1].runId;
}

function compareDiffRows(a: DiffResult, b: DiffResult): number {
  const dateDiff = parseDate(a.runDate) - parseDate(b.runDate);

  if (dateDiff !== 0) {
    return dateDiff;
  }

  return a.rowIndex - b.rowIndex;
}

function parseDate(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calculateFailureStreaks(diffResults: DiffResult[], currentRunId: string): Map<string, number> {
  const sortedRows = [...diffResults].sort(compareDiffRows);
  const currentRowIndex = findLastRunRowIndex(sortedRows, currentRunId);
  const rowsThroughCurrent = currentRowIndex >= 0 ? sortedRows.slice(0, currentRowIndex + 1) : sortedRows;
  const currentTestCases = new Set(
    rowsThroughCurrent.filter((row) => row.runId === currentRunId).map((row) => row.testCase),
  );
  const streaks = new Map<string, number>();

  for (const testCase of currentTestCases) {
    let streak = 0;

    for (let index = rowsThroughCurrent.length - 1; index >= 0; index -= 1) {
      const row = rowsThroughCurrent[index];

      if (row.testCase !== testCase) {
        continue;
      }

      if (row.diffStatus === 'new_failure' || row.diffStatus === 'unresolved') {
        streak += 1;
        continue;
      }

      break;
    }

    streaks.set(testCase, streak);
  }

  return streaks;
}

function findLastRunRowIndex(rows: DiffResult[], runId: string): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index].runId === runId) {
      return index;
    }
  }

  return -1;
}

function buildAction(
  diff: DiffResult,
  triage: TriageResult | undefined,
  failureStreakCount: number,
): Action | null {
  const verdict = triage?.aiVerdict ?? '';
  const confidence = triage?.confidence ?? 0;
  const errorType = diff.currentErrorType || diff.previousErrorType || 'unknown error';
  const details = {
    diff_status: diff.diffStatus,
    ai_verdict: verdict,
    confidence: triage ? confidence : null,
    error_type: errorType,
    failure_streak_count: failureStreakCount,
    consecutive_pass_count: diff.consecutivePassCount,
    estimated_root_cause: triage?.estimatedRootCause ?? '',
    recommended_action: triage?.recommendedAction ?? '',
  };

  if (diff.diffStatus === 'resolved') {
    const stableNote =
      diff.consecutivePassCount >= 5
        ? `安定化しています（連続PASS ${diff.consecutivePassCount}回）。`
        : `連続PASS ${diff.consecutivePassCount}回。`;

    return {
      id: actionId(diff, 'resolved'),
      priority: 'low',
      type: 'resolved',
      test_case: diff.testCase,
      message: `${diff.testCase} が改善済み。${stableNote}`,
      details,
    };
  }

  if (diff.diffStatus === 'still_passing') {
    if (diff.consecutivePassCount < 5) {
      return null;
    }

    return {
      id: actionId(diff, 'stable'),
      priority: 'info',
      type: 'stable',
      test_case: diff.testCase,
      message: `${diff.testCase} は連続PASS ${diff.consecutivePassCount}回。安定化しています。`,
      details,
    };
  }

  if (triage?.isFalsePositive) {
    const message =
      verdict === 'environment_issue'
        ? `${diff.testCase} は偽陽性の可能性あり（確信度: ${formatConfidence(confidence)}）。環境要因を確認。`
        : `${diff.testCase} は偽陽性の可能性あり（確信度: ${formatConfidence(confidence)}）。テスト条件と待機条件を確認。`;

    return {
      id: actionId(diff, verdict === 'environment_issue' ? 'environment' : 'false-positive'),
      priority: diff.diffStatus === 'unresolved' ? 'medium' : 'low',
      type: verdict === 'environment_issue' ? 'environment_check' : 'false_positive_review',
      test_case: diff.testCase,
      message,
      details,
    };
  }

  if (verdict === 'test_issue') {
    return {
      id: actionId(diff, 'test-maintenance'),
      priority: 'medium',
      type: 'test_maintenance',
      test_case: diff.testCase,
      message: `${diff.testCase} はテスト実装の問題の可能性あり（確信度: ${formatConfidence(confidence)}）。セレクタとアサーションを見直し。`,
      details,
    };
  }

  if (verdict === 'real_bug' || triage?.isFalseNegative) {
    return {
      id: actionId(diff, 'real-bug'),
      priority: 'high',
      type: 'real_bug_failure',
      test_case: diff.testCase,
      message: `${diff.testCase} の ${errorType} が ${Math.max(failureStreakCount, 1)}回連続。最優先で対処。`,
      details,
    };
  }

  return {
    id: actionId(diff, 'watch'),
    priority: diff.diffStatus === 'unresolved' ? 'medium' : 'low',
    type: 'watch',
    test_case: diff.testCase,
    message: `${diff.testCase} の ${errorType} を確認。差分状態: ${diff.diffStatus}。`,
    details,
  };
}

function actionId(diff: DiffResult, suffix: string): string {
  return `${diff.runId}:${diff.testCase}:${suffix}`.replace(/\s+/g, '_');
}

function formatConfidence(confidence: number): string {
  return normalizeConfidence(confidence).toFixed(2);
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function compareActions(a: Action, b: Action): number {
  const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);

  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  return a.test_case.localeCompare(b.test_case);
}

function priorityRank(priority: Priority): number {
  switch (priority) {
    case 'high':
      return 0;
    case 'medium':
      return 1;
    case 'low':
      return 2;
    case 'info':
      return 3;
  }
}

function buildSummary(args: {
  runId: string;
  diffResultsFile: string;
  triageResultsFile: string;
  actions: Action[];
}): ActionSummary {
  return {
    run_id: args.runId,
    generated_at: new Date().toISOString(),
    source_files: {
      diff_results: path.resolve(args.diffResultsFile),
      triage_results: path.resolve(args.triageResultsFile),
    },
    summary: {
      total_actions: args.actions.length,
      high_priority: args.actions.filter((action) => action.priority === 'high').length,
      medium_priority: args.actions.filter((action) => action.priority === 'medium').length,
      low_priority: args.actions.filter((action) => action.priority === 'low').length,
      info_priority: args.actions.filter((action) => action.priority === 'info').length,
      by_type: countActions(args.actions, (action) => action.type),
      by_verdict: countActions(args.actions, (action) => action.details.ai_verdict || 'untriaged'),
    },
    actions: args.actions,
  };
}

function countActions<T extends string>(actions: Action[], keySelector: (action: Action) => T): Record<T, number> {
  const counts = {} as Record<T, number>;

  for (const action of actions) {
    const key = keySelector(action);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

async function writeJson(outputFile: string, value: unknown) {
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`advisor failed: ${message}`);
  process.exitCode = 1;
});
