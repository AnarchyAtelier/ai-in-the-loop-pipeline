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
  test_error_type: Record<string, number>;
  diff_status: Record<string, number>;
  ai_verdict: Record<string, number>;
  false_negative_by_trap: Record<string, number>;
  suite_breakdown: SuiteSummary[];
  eval_latest: CsvRow | null;
  eval_details: Record<string, unknown>[];
  triage_rows: CsvRow[];
  false_negative_candidate_rows: CsvRow[];
  top_still_passing: CsvRow[];
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
  const positionalArgs: string[] = [];

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

    positionalArgs.push(arg);
  }

  if (positionalArgs[0]) {
    options.artifactsRoot = positionalArgs[0];
  }

  if (positionalArgs[1]) {
    options.output = positionalArgs[1];
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
    test_error_type: countFailedErrorsByType(testResults),
    diff_status: countBy(diffResults, 'diff_status'),
    ai_verdict: countBy(triageResults, 'ai_verdict'),
    false_negative_by_trap: countBy(falseNegativeCandidates, 'matched_test_id'),
    suite_breakdown: summarizeSuites(testResults, diffResults, falseNegativeCandidates, triageResults),
    eval_latest: evalResults.at(-1) ?? null,
    eval_details: parseEvalDetails(evalResults.at(-1) ?? null).map(withEvalDisplayFields),
    triage_rows: triageResults.map(withDisplayFields),
    false_negative_candidate_rows: falseNegativeCandidates.map(withDisplayFields),
    top_still_passing: summarizeTopStillPassing(diffResults).map(withDisplayFields),
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

  if (testCase.startsWith('Phantom Brew 白箱フロー')) {
    return '1a-whitebox';
  }

  if (testCase.startsWith('Phantom Brew blackbox flows')) {
    return '1b-blackbox';
  }

  if (testCase.startsWith('Phantom Brew 黒箱フロー')) {
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

function countFailedErrorsByType(rows: CsvRow[]): Record<string, number> {
  const failedRows = rows.filter((row) => row.status === 'failed' || row.status === 'error');
  const counts: Record<string, number> = {};

  for (const row of failedRows) {
    const errorType = normalizeErrorType(row.error_type);
    counts[errorType] = (counts[errorType] ?? 0) + 1;
  }

  return counts;
}

function normalizeErrorType(errorType: string | undefined): string {
  const normalized = (errorType ?? '').trim().toLowerCase();

  if (!normalized) {
    return 'unknown';
  }

  if (normalized.includes('locator')) {
    return 'locator';
  }

  if (normalized.includes('assertion')) {
    return 'assertion';
  }

  if (normalized.includes('server')) {
    return 'server';
  }

  if (normalized.includes('timeout')) {
    return 'timeout';
  }

  return normalized;
}

function summarizeTopStillPassing(rows: CsvRow[], limit = 12): CsvRow[] {
  return rows
    .filter((row) => row.diff_status === 'still_passing')
    .sort((left, right) => numericValue(right.consecutive_pass_count) - numericValue(left.consecutive_pass_count))
    .slice(0, limit);
}

function numericValue(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseEvalDetails(evalLatest: CsvRow | null): Record<string, unknown>[] {
  if (!evalLatest?.details_json) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(evalLatest.details_json);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isRecord);
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const TEST_CASE_DISPLAY: Record<string, string> = {
  'Phantom Brew whitebox flows › menu supports browsing, filtering, search, and price sort':
    'Phantom Brew 白箱フロー › メニューで閲覧・絞り込み・検索・価格順ソートができる',
  'Phantom Brew whitebox flows › product detail recalculates total from size, options, and quantity':
    'Phantom Brew 白箱フロー › 商品詳細でサイズ・オプション・数量から合計金額を再計算する',
  'Phantom Brew whitebox flows › cart shows added item and supports quantity update and removal':
    'Phantom Brew 白箱フロー › カートで追加商品を確認し数量変更と削除ができる',
  'Phantom Brew whitebox flows › cart coupon applies a visible discount to the order total':
    'Phantom Brew 白箱フロー › カートでクーポンを適用すると注文合計に割引が反映される',
  'Phantom Brew whitebox flows › checkout places an order and lists it in order history':
    'Phantom Brew 白箱フロー › 注文後にステータスページと注文履歴へ反映される',
  'Phantom Brew blackbox flows › lets customers browse, filter, search, and sort menu items':
    'Phantom Brew 黒箱フロー › 利用者がメニュー閲覧・絞り込み・検索・並び替えを行える',
  'Phantom Brew blackbox flows › customizes a coffee item and carries the selection into the cart':
    'Phantom Brew 黒箱フロー › コーヒーをカスタマイズしてカートへ引き継げる',
  'Phantom Brew blackbox flows › applies a coupon and removes an item from the cart':
    'Phantom Brew 黒箱フロー › クーポン適用後に商品をカートから削除できる',
  'Phantom Brew blackbox flows › places an order and shows it in order history':
    'Phantom Brew 黒箱フロー › 注文を確定すると注文履歴に表示される',
};

const ROOT_CAUSE_DISPLAY: Record<string, string> = {
  'Optimistic UI update with 5% server-side rollback on stock check':
    '在庫確認時に5%の確率でサーバー側ロールバックが発生する楽観的UI更新',
  'SSE status transitions have random delays (3-30 seconds per stage)':
    'SSEのステータス遷移に各段階3〜30秒のランダム遅延がある',
  'A/B test: 50% chance of variant B (single column) which lacks .form-row wrapper':
    'A/Bテストで50%の確率で単一カラムのvariant Bになり、.form-rowラッパーが存在しない',
  "Locator strict mode violation: 'h1, .product-card' resolves to multiple elements":
    "Locator strict mode違反: 'h1, .product-card' が複数要素に解決される",
  'CSS staggered animation with pointer-events: none during animation':
    '段階的CSSアニメーション中は pointer-events: none になりクリックできない',
  'Cold start: first 5 requests have 3 second delay for DB pool warmup':
    'コールドスタート: DBプールウォームアップのため最初の5リクエストが3秒遅延する',
  'Tax rounded per-item instead of on total: Math.round(item * rate) summed vs Math.round(sum * rate)':
    '商品ごとに税額を丸めて合算しており、合計額に税率を掛けて丸める計算とズレる',
  'Client-side sort re-orders DOM elements visually but does not update href attributes':
    'クライアント側ソートがDOM要素の見た目だけを並べ替え、href属性を更新していない',
  'Coupon discount is displayed in UI but not subtracted from total calculation':
    'クーポン適用メッセージは表示されるが、割引額が合計金額から差し引かれていない',
  'Off-by-one: totalPages += 1 when total % perPage === 0, creating an empty last page':
    '境界値バグ: total % perPage === 0 のとき totalPages += 1 され、空の最終ページが作られる',
  'Race condition: requests within 100ms window are silently ignored on server side':
    '競合状態: 100ms以内の連続リクエストがサーバー側で黙って無視される',
  'No server-side email validation; relies solely on HTML5 type=email which Playwright bypasses':
    'サーバー側メール形式チェックがなく、PlaywrightがHTML5 type=emailの検証を迂回できる',
};

function withDisplayFields(row: CsvRow): CsvRow {
  const displayRow = { ...row };

  if (row.test_case) {
    displayRow.display_test_case = localizeTestCase(row.test_case);
  }

  if (row.matched_test_name) {
    displayRow.display_matched_test_name = localizeTestCase(row.matched_test_name);
  }

  if (row.root_cause) {
    displayRow.display_root_cause = localizeRootCause(row.root_cause);
  }

  if (row.estimated_root_cause) {
    displayRow.display_estimated_root_cause = localizeRootCause(row.estimated_root_cause);
  }

  if (row.recommended_action) {
    displayRow.display_recommended_action = localizeRecommendedAction(row);
  }

  return displayRow;
}

function withEvalDisplayFields(row: Record<string, unknown>): Record<string, unknown> {
  const displayRow = { ...row };

  if (typeof row.test_case === 'string') {
    displayRow.display_test_case = localizeTestCase(row.test_case);
  }

  if (typeof row.root_cause === 'string') {
    displayRow.display_root_cause = localizeRootCause(row.root_cause);
  }

  return displayRow;
}

function localizeTestCase(testCase: string): string {
  return TEST_CASE_DISPLAY[testCase] ?? testCase;
}

function localizeRootCause(rootCause: string): string {
  return ROOT_CAUSE_DISPLAY[rootCause] ?? rootCause;
}

function localizeRecommendedAction(row: CsvRow): string {
  if (row.matched_test_id) {
    return `この通過テストは ${row.matched_test_id} に対応しています。隠れたバグ条件を検証するオラクルアサーションを追加または実行してください。`;
  }

  if (row.is_false_negative === 'true') {
    return '実バグ候補として再現・修正する';
  }

  if (row.is_false_positive === 'true') {
    if (row.ai_verdict === 'flaky') {
      return '待機条件とリトライ条件を安定化する';
    }

    if (row.ai_verdict === 'test_issue') {
      return 'テスト実装・セレクタを見直す';
    }

    if (row.ai_verdict === 'environment_issue') {
      return '環境・サーバ応答を確認する';
    }

    return '偽陽性として扱い、再発条件を切り分ける';
  }

  if (row.ai_verdict === 'real_bug') {
    return 'アプリ挙動を調査して修正する';
  }

  if (row.ai_verdict === 'environment_issue') {
    return '環境・ネットワーク・サーバ負荷を確認する';
  }

  if (row.ai_verdict === 'flaky') {
    return '待機条件と実行タイミングを安定化する';
  }

  if (row.ai_verdict === 'test_issue') {
    return 'テストコードとセレクタを修正する';
  }

  return row.recommended_action;
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
