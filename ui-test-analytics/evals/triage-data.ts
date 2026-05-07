import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { appendCsvRows, readCsvRows, type CsvRow } from '../pipeline/lib/csv';

export type AiVerdict = 'real_bug' | 'flaky' | 'test_issue' | 'environment_issue';
export type TrapType = 'false_positive' | 'false_negative' | 'observed_false_positive' | 'none';
export type LabelSource = 'designed' | 'observed';
export type LabelStatus = 'confirmed' | 'provisional';

export interface GroundTruthLabel {
  test_id: string;
  test_name: string;
  aliases?: string[];
  trap_type: TrapType;
  expected_verdict: AiVerdict;
  root_cause: string;
  is_app_bug: boolean;
  notes: string;
  source?: LabelSource;
  status?: LabelStatus;
  first_seen_run?: string;
  confidence_required?: number;
}

export interface TriageResult {
  run_id: string;
  test_case: string;
  ai_verdict: AiVerdict;
  confidence: number;
  estimated_root_cause: string;
  recommended_action: string;
  is_false_positive: boolean;
  is_false_negative: boolean;
}

export interface TriageEvalInput {
  run_id: string;
  test_case: string;
  test_id: string;
  trap_type: TrapType;
  label_source: LabelSource;
  label_status: LabelStatus;
  ai_verdict: AiVerdict;
  confidence: number;
  estimated_root_cause: string;
  recommended_action: string;
  is_false_positive: boolean;
  is_false_negative: boolean;
}

export interface TriageEvalExpected {
  test_id: string;
  expected_verdict: AiVerdict;
  trap_type: TrapType;
  label_source: LabelSource;
  label_status: LabelStatus;
  is_app_bug: boolean;
  root_cause: string;
}

export interface TriageEvalOutput {
  ai_verdict: AiVerdict;
  confidence: number;
  is_false_positive: boolean;
  is_false_negative: boolean;
  estimated_root_cause: string;
  recommended_action: string;
}

export interface TriageEvalCase {
  input: TriageEvalInput;
  expected: TriageEvalExpected;
}

export interface EvalMetrics {
  runId: string;
  evalDate: string;
  accuracy: number;
  fpDetectionRate: number;
  fnDetectionRate: number;
  totalCases: number;
  correct: number;
  incorrect: number;
  details: EvalDetail[];
}

export interface EvalDetail {
  test_id: string;
  test_case: string;
  trap_type: TrapType;
  label_source: LabelSource;
  label_status: LabelStatus;
  expected_verdict: AiVerdict;
  ai_verdict: AiVerdict;
  verdict_match: boolean;
  expected_false_positive: boolean;
  is_false_positive: boolean;
  false_positive_match: boolean;
  expected_false_negative: boolean;
  is_false_negative: boolean;
  false_negative_match: boolean;
  confidence: number;
}

export interface EvalUnmatchedCase {
  run_id: string;
  test_case: string;
  reason: 'no_label' | 'provisional_label';
  matched_label_id?: string;
  matched_label_source?: LabelSource;
  matched_label_status?: LabelStatus;
}

interface GroundTruthFile {
  labels: GroundTruthLabel[];
}

interface LabelIndex {
  confirmedByKey: Map<string, GroundTruthLabel>;
  provisionalByKey: Map<string, GroundTruthLabel>;
}

const EVAL_RESULTS_HEADER = [
  'run_id',
  'eval_date',
  'accuracy',
  'fp_detection_rate',
  'fn_detection_rate',
  'total_cases',
  'correct',
  'incorrect',
  'details_json',
];

export function defaultTriageResultsFile(): string {
  return process.env.TRIAGE_RESULTS_CSV ?? path.join(process.env.RESULTS_DIR ?? 'results', 'triage-results.csv');
}

export function defaultGroundTruthFile(): string {
  return process.env.GROUND_TRUTH_JSON ?? path.join('tests', 'ground-truth', 'ground-truth-labels.json');
}

export function defaultObservedLabelsFile(): string {
  return process.env.OBSERVED_LABELS_JSON ?? path.join('tests', 'ground-truth', 'observed-labels.json');
}

export function defaultEvalResultsFile(): string {
  return process.env.EVAL_RESULTS_CSV ?? path.join(process.env.RESULTS_DIR ?? 'results', 'eval-results.csv');
}

export function defaultEvalUnmatchedFile(): string {
  return process.env.EVAL_UNMATCHED_JSON ?? path.join(process.env.RESULTS_DIR ?? 'results', 'eval-unmatched.json');
}

export async function loadEvalCases(args: {
  triageResultsFile?: string;
  groundTruthFile?: string;
  observedLabelsFile?: string;
  runId?: string;
  includeProvisionalLabels?: boolean;
} = {}): Promise<TriageEvalCase[]> {
  const dataset = await loadEvalDataset(args);
  return dataset.cases;
}

export async function loadEvalDataset(args: {
  triageResultsFile?: string;
  groundTruthFile?: string;
  observedLabelsFile?: string;
  runId?: string;
  includeProvisionalLabels?: boolean;
} = {}): Promise<{ cases: TriageEvalCase[]; unmatched: EvalUnmatchedCase[] }> {
  const triageRows = await readCsvRows(args.triageResultsFile ?? defaultTriageResultsFile());
  const triageResults = triageRows.map(toTriageResult).filter((row): row is TriageResult => row !== null);
  const labels = await loadEvaluationLabels(
    args.groundTruthFile ?? defaultGroundTruthFile(),
    args.observedLabelsFile ?? defaultObservedLabelsFile(),
  );

  if (triageResults.length === 0) {
    return { cases: [], unmatched: [] };
  }

  const runId = args.runId ?? defaultRunId() ?? latestRunId(triageResults);
  const includeProvisionalLabels =
    args.includeProvisionalLabels ?? process.env.EVAL_INCLUDE_PROVISIONAL_LABELS === '1';
  const labelIndex = createLabelIndex(labels);
  const cases: TriageEvalCase[] = [];
  const unmatched: EvalUnmatchedCase[] = [];

  for (const result of triageResults.filter((row) => row.run_id === runId)) {
    const match = findGroundTruthLabel(result.test_case, labelIndex, includeProvisionalLabels);

    if (!match.label) {
      unmatched.push({
        run_id: result.run_id,
        test_case: result.test_case,
        reason: match.reason,
        matched_label_id: match.provisionalLabel?.test_id,
        matched_label_source: normalizeLabelSource(match.provisionalLabel),
        matched_label_status: normalizeLabelStatus(match.provisionalLabel),
      });
      continue;
    }

    const label = match.label;
    const labelSource = normalizeLabelSource(label) ?? 'designed';
    const labelStatus = normalizeLabelStatus(label) ?? 'confirmed';

    cases.push({
      input: {
        run_id: result.run_id,
        test_case: result.test_case,
        test_id: label.test_id,
        trap_type: label.trap_type,
        label_source: labelSource,
        label_status: labelStatus,
        ai_verdict: result.ai_verdict,
        confidence: result.confidence,
        estimated_root_cause: result.estimated_root_cause,
        recommended_action: result.recommended_action,
        is_false_positive: result.is_false_positive,
        is_false_negative: result.is_false_negative,
      },
      expected: {
        test_id: label.test_id,
        expected_verdict: label.expected_verdict,
        trap_type: label.trap_type,
        label_source: labelSource,
        label_status: labelStatus,
        is_app_bug: label.is_app_bug,
        root_cause: label.root_cause,
      },
    });
  }

  return { cases, unmatched };
}

export function runTriageEvalTask(input: TriageEvalInput): TriageEvalOutput {
  return {
    ai_verdict: input.ai_verdict,
    confidence: input.confidence,
    is_false_positive: input.is_false_positive,
    is_false_negative: input.is_false_negative,
    estimated_root_cause: input.estimated_root_cause,
    recommended_action: input.recommended_action,
  };
}

export function calculateEvalMetrics(cases: TriageEvalCase[], evalDate = new Date().toISOString()): EvalMetrics {
  const details = cases.map(toEvalDetail);
  const correct = details.filter((detail) => detail.verdict_match).length;
  const falsePositiveDetails = details.filter((detail) => isExpectedFalsePositive(detail.trap_type));
  const falseNegativeDetails = details.filter((detail) => isExpectedFalseNegative(detail.trap_type));

  return {
    runId: cases[0]?.input.run_id ?? defaultRunId() ?? 'unknown',
    evalDate,
    accuracy: rate(correct, details.length),
    fpDetectionRate: rate(
      falsePositiveDetails.filter((detail) => detail.false_positive_match).length,
      falsePositiveDetails.length,
    ),
    fnDetectionRate: rate(
      falseNegativeDetails.filter((detail) => detail.false_negative_match).length,
      falseNegativeDetails.length,
    ),
    totalCases: details.length,
    correct,
    incorrect: details.length - correct,
    details,
  };
}

export async function appendEvalMetrics(outputFile: string, metrics: EvalMetrics) {
  await appendCsvRows(outputFile, EVAL_RESULTS_HEADER, [
    [
      metrics.runId,
      metrics.evalDate,
      formatRate(metrics.accuracy),
      formatRate(metrics.fpDetectionRate),
      formatRate(metrics.fnDetectionRate),
      String(metrics.totalCases),
      String(metrics.correct),
      String(metrics.incorrect),
      JSON.stringify(metrics.details),
    ],
  ]);
}

export async function writeEvalUnmatched(outputFile: string, unmatched: EvalUnmatchedCase[]) {
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(
    outputFile,
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        total_unmatched: unmatched.length,
        unmatched,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

export function isExpectedFalsePositive(trapType: TrapType): boolean {
  return trapType === 'false_positive' || trapType === 'observed_false_positive';
}

export function isExpectedFalseNegative(trapType: TrapType): boolean {
  return trapType === 'false_negative';
}

function toEvalDetail(evalCase: TriageEvalCase): EvalDetail {
  const expectedFalsePositive = isExpectedFalsePositive(evalCase.expected.trap_type);
  const expectedFalseNegative = isExpectedFalseNegative(evalCase.expected.trap_type);

  return {
    test_id: evalCase.expected.test_id,
    test_case: evalCase.input.test_case,
    trap_type: evalCase.expected.trap_type,
    label_source: evalCase.expected.label_source,
    label_status: evalCase.expected.label_status,
    expected_verdict: evalCase.expected.expected_verdict,
    ai_verdict: evalCase.input.ai_verdict,
    verdict_match: evalCase.input.ai_verdict === evalCase.expected.expected_verdict,
    expected_false_positive: expectedFalsePositive,
    is_false_positive: evalCase.input.is_false_positive,
    false_positive_match: !expectedFalsePositive || evalCase.input.is_false_positive,
    expected_false_negative: expectedFalseNegative,
    is_false_negative: evalCase.input.is_false_negative,
    false_negative_match: !expectedFalseNegative || evalCase.input.is_false_negative,
    confidence: evalCase.input.confidence,
  };
}

async function loadEvaluationLabels(groundTruthFile: string, observedLabelsFile: string): Promise<GroundTruthLabel[]> {
  const designedLabels = await loadLabelsFile(groundTruthFile, 'designed');
  const observedLabels = await loadOptionalLabelsFile(observedLabelsFile, 'observed');
  return [...designedLabels, ...observedLabels];
}

async function loadLabelsFile(filePath: string, defaultSource: LabelSource): Promise<GroundTruthLabel[]> {
  const file = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(file) as GroundTruthFile;
  return normalizeLabels(parsed.labels, defaultSource);
}

async function loadOptionalLabelsFile(filePath: string, defaultSource: LabelSource): Promise<GroundTruthLabel[]> {
  try {
    return await loadLabelsFile(filePath, defaultSource);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

function normalizeLabels(labels: GroundTruthLabel[] | undefined, defaultSource: LabelSource): GroundTruthLabel[] {
  if (!Array.isArray(labels)) {
    return [];
  }

  return labels.map((label) => ({
    ...label,
    source: label.source ?? defaultSource,
    status: label.status ?? 'confirmed',
    aliases: Array.isArray(label.aliases) ? label.aliases : [],
  }));
}

function toTriageResult(row: CsvRow): TriageResult | null {
  const runId = row.run_id?.trim();
  const testCase = row.test_case?.trim();
  const verdict = normalizeAiVerdict(row.ai_verdict);

  if (!runId || !testCase || !verdict) {
    return null;
  }

  return {
    run_id: runId,
    test_case: testCase,
    ai_verdict: verdict,
    confidence: normalizeConfidence(Number(row.confidence ?? 0)),
    estimated_root_cause: row.estimated_root_cause?.trim() ?? '',
    recommended_action: row.recommended_action?.trim() ?? '',
    is_false_positive: row.is_false_positive === 'true',
    is_false_negative: row.is_false_negative === 'true',
  };
}

function createLabelIndex(labels: GroundTruthLabel[]): LabelIndex {
  const confirmedByKey = new Map<string, GroundTruthLabel>();
  const provisionalByKey = new Map<string, GroundTruthLabel>();

  for (const label of labels) {
    const targetMap = normalizeLabelStatus(label) === 'provisional' ? provisionalByKey : confirmedByKey;

    for (const key of labelKeys(label)) {
      if (!targetMap.has(key)) {
        targetMap.set(key, label);
      }
    }
  }

  return { confirmedByKey, provisionalByKey };
}

function labelKeys(label: GroundTruthLabel): string[] {
  return [label.test_id, label.test_name, ...(label.aliases ?? [])].map(normalize).filter(Boolean);
}

function findGroundTruthLabel(
  testCase: string,
  labelIndex: LabelIndex,
  includeProvisionalLabels: boolean,
): {
  label?: GroundTruthLabel;
  reason: EvalUnmatchedCase['reason'];
  provisionalLabel?: GroundTruthLabel;
} {
  const normalizedTestCase = normalize(testCase);
  const confirmedLabel = labelIndex.confirmedByKey.get(normalizedTestCase);

  if (confirmedLabel) {
    return { label: confirmedLabel, reason: 'no_label' };
  }

  const provisionalLabel = labelIndex.provisionalByKey.get(normalizedTestCase);

  if (provisionalLabel && includeProvisionalLabels) {
    return { label: provisionalLabel, reason: 'provisional_label', provisionalLabel };
  }

  if (provisionalLabel) {
    return { reason: 'provisional_label', provisionalLabel };
  }

  return { reason: 'no_label' };
}

function latestRunId(results: TriageResult[]): string {
  return results[results.length - 1].run_id;
}

function defaultRunId(): string | undefined {
  const configured =
    process.env.EFFECTIVE_RUN_ID ??
    process.env.PIPELINE_RUN_ID ??
    process.env.BUILD_TAG ??
    process.env.BUILD_NUMBER;

  return configured && configured.trim() ? configured.trim() : undefined;
}

function normalizeAiVerdict(value: string | undefined): AiVerdict | '' {
  if (value === 'real_bug' || value === 'flaky' || value === 'test_issue' || value === 'environment_issue') {
    return value;
  }

  return '';
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/[›>|:：]/g, ' ').replace(/\s+/g, ' ');
}

function normalizeLabelSource(label: GroundTruthLabel | undefined): LabelSource | undefined {
  if (!label) {
    return undefined;
  }

  return label.source === 'observed' ? 'observed' : 'designed';
}

function normalizeLabelStatus(label: GroundTruthLabel | undefined): LabelStatus | undefined {
  if (!label) {
    return undefined;
  }

  return label.status === 'provisional' ? 'provisional' : 'confirmed';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function rate(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

function formatRate(value: number): string {
  return value.toFixed(4);
}
