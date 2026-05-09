const SUMMARY_DATA_URL = './summary-data.js';
const SUMMARY_URLS = ['../build-artifacts/summary.json', './summary.json', './build-artifacts/summary.json'];

const GROUPS = [
  { id: 'article1', label: '記事1', runIds: ['pipeline-1', 'pipeline-2', 'pipeline-3', 'pipeline-4', 'pipeline-5'] },
  { id: 'article2', label: '記事2', runIds: ['pipeline-6', 'pipeline-7', 'pipeline-8', 'pipeline-9', 'pipeline-10'] },
  { id: 'prompt', label: 'B-3', runIds: ['pipeline-11', 'pipeline-12', 'pipeline-13'] },
];

const COLORS = {
  teal: '#0f766e',
  blue: '#2563eb',
  green: '#15803d',
  coral: '#e11d48',
  amber: '#d97706',
  violet: '#7c3aed',
  slate: '#64748b',
  sky: '#0284c7',
  gray: '#94a3b8',
};

const STATUS_LABELS = {
  passed: 'Passed',
  failed: 'Failed',
  error: 'Error',
};

const ERROR_TYPE_LABELS = {
  assertion: 'Assertion',
  server: 'Server',
  locator: 'Locator',
  timeout: 'Timeout',
  unknown: 'Unknown',
};

const VERDICT_LABELS = {
  real_bug: '実バグ',
  environment_issue: '環境問題',
  flaky: '不安定',
  test_issue: 'テスト問題',
};

const DIFF_STATUS_LABELS = {
  still_passing: '継続PASS',
  new_failure: '新規失敗',
  unresolved: '未解決',
  resolved: '解消',
};

const SUITE_LABELS = {
  '1a-whitebox': '1a 白箱',
  '1b-blackbox': '1b 黒箱',
  '1c-naive': '1c 素朴',
};

const BUCKET_LABELS = {
  improved: '改善',
  regressed: '後退',
  'still missed': '両方で外れ',
};

const state = {
  runs: [],
  charts: {},
  selectedRunId: '',
  generatedAt: '',
  summarySource: '',
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const summary = await loadSummary();
    state.runs = [...(summary.runs ?? [])].sort(compareRuns);
    state.selectedRunId = state.runs[0]?.run_id ?? '';
    state.generatedAt = summary.generated_at ?? '';
    setupRunSelect();
    updateStatus();
    renderAll();
  } catch (error) {
    setStatus('summary.json を読めません', true);
    renderEmptyShell(error);
  }
}

async function loadSummary() {
  if (window.__UI_TEST_ANALYTICS_SUMMARY__) {
    state.summarySource = 'summary-data.js';
    return window.__UI_TEST_ANALYTICS_SUMMARY__;
  }

  const errors = [];

  try {
    await loadSummaryDataScript();

    if (window.__UI_TEST_ANALYTICS_SUMMARY__) {
      state.summarySource = 'summary-data.js';
      return window.__UI_TEST_ANALYTICS_SUMMARY__;
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  for (const url of SUMMARY_URLS) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${url}: ${response.status} ${response.statusText}`);
      }

      state.summarySource = url;
      return response.json();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(errors.join(' / '));
}

function loadSummaryDataScript() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${SUMMARY_DATA_URL}?v=${Date.now()}`;
    script.onload = () => resolve(undefined);
    script.onerror = () => reject(new Error(`${SUMMARY_DATA_URL}: load failed`));
    document.head.append(script);
  });
}

function setupRunSelect() {
  const select = qs('#runSelect');
  select.replaceChildren();

  for (const run of state.runs) {
    const option = document.createElement('option');
    option.value = run.run_id;
    option.textContent = `${run.run_id}（${artifactLabel(run.artifact_dir)}）`;
    select.append(option);
  }

  select.value = state.selectedRunId;
  select.addEventListener('change', () => {
    state.selectedRunId = select.value;
    updateStatus();
    renderAll();
  });
}

function renderAll() {
  const run = selectedRun();
  if (!run) {
    renderEmptyShell();
    return;
  }

  renderTestLayer(run);
  renderAiLayer(run);
  renderEvalLayer(run);
  renderComparisonLayer();
}

function renderTestLayer(run) {
  renderMetricStrip('#testKpis', [
    { label: 'Passed', value: count(run.test_status, 'passed'), tone: 'ok' },
    { label: 'Failed', value: count(run.test_status, 'failed'), tone: 'fp' },
    { label: 'Error', value: count(run.test_status, 'error'), tone: 'fn' },
  ]);

  renderDoughnutChart('errorTypeChart', 'エラー種別', run.test_error_type ?? {}, [
    COLORS.coral,
    COLORS.amber,
    COLORS.violet,
    COLORS.blue,
    COLORS.gray,
  ], ERROR_TYPE_LABELS);
  renderSuiteStatusChart(run);
  renderStillPassingTable(run.top_still_passing ?? []);
}

function renderAiLayer(run) {
  const triageRows = run.triage_rows ?? [];
  const falsePositiveCount = triageRows.filter((row) => asBool(row.is_false_positive)).length;
  const falseNegativeCount = triageRows.filter((row) => asBool(row.is_false_negative)).length;

  renderMetricStrip('#metaFlagCards', [
    { label: '失敗ログ内FPフラグ', value: falsePositiveCount, tone: 'meta fp' },
    { label: '失敗ログ内FNフラグ', value: falseNegativeCount, tone: 'meta fn' },
    { label: 'AI判定件数', value: triageRows.length, tone: 'accuracy' },
  ]);

  renderConfidenceChart(triageRows);
  renderDoughnutChart('verdictChart', '分類', run.ai_verdict ?? {}, [
    COLORS.green,
    COLORS.amber,
    COLORS.blue,
    COLORS.violet,
    COLORS.gray,
  ], VERDICT_LABELS);
  renderTriageTable(triageRows);
}

function renderEvalLayer(run) {
  renderMetricStrip('#evalKpis', [
    { label: '失敗ログ内FNシグナル検知率', value: formatPercent(metric(run, 'fn_detection_rate')), tone: 'fn' },
    { label: '失敗ログ内FPシグナル検知率', value: formatPercent(metric(run, 'fp_detection_rate')), tone: 'fp' },
    { label: '分類一致率', value: formatPercent(metric(run, 'accuracy')), tone: 'accuracy' },
  ]);

  const details = run.eval_details ?? [];
  renderWrongVerdictTable(details.filter((row) => row.verdict_match === false));
  renderMetaMissTable(details.filter(isMetaMiss));
  renderFnCandidatesTable(run.false_negative_candidate_rows ?? []);
}

function renderComparisonLayer() {
  const beforeRuns = groupRuns('article1');
  const afterRuns = groupRuns('article2');
  const promptRuns = groupRuns('prompt');
  const before = computeGroupMetrics(beforeRuns);
  const after = computeGroupMetrics(afterRuns);
  const prompt = computeGroupMetrics(promptRuns);

  renderComparisonKpis(before, after, prompt);
  renderSuiteTrendChart([...beforeRuns, ...afterRuns]);
  renderMetaImprovementTable(compareMetaCases(beforeRuns, afterRuns));
  renderVerdictBucketTable(compareVerdictBuckets(beforeRuns, afterRuns));
}

function renderMetricStrip(selector, items) {
  const target = qs(selector);
  target.replaceChildren();

  for (const item of items) {
    const card = document.createElement('div');
    card.className = `metric-card ${item.tone ?? ''}`;

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = item.label;

    const value = document.createElement('div');
    value.className = 'value';
    value.textContent = String(item.value);

    card.append(label, value);
    target.append(card);
  }
}

function renderComparisonKpis(before, after, prompt) {
  const target = qs('#comparisonKpis');
  target.replaceChildren();

  target.append(
    comparisonCard({
      label: '失敗ログ内FNシグナル検知率',
      value: deltaText(before.fnDetection, after.fnDetection),
      tone: 'fn primary',
      cells: metricCells(before.fnDetection, after.fnDetection),
    }),
    comparisonCard({
      label: '失敗ログ内FPシグナル検知率',
      value: deltaText(before.fpDetection, after.fpDetection),
      tone: 'fp',
      cells: metricCells(before.fpDetection, after.fpDetection),
    }),
    comparisonCard({
      label: '分類一致率',
      value: deltaText(before.accuracy, after.accuracy),
      tone: 'accuracy',
      cells: [
        ...metricCells(before.accuracy, after.accuracy),
        { label: 'B-3', value: formatPercent(prompt.accuracy) },
      ],
      note: 'ほぼ横ばい、LLMノイズ範囲',
    }),
  );
}

function comparisonCard({ label, value, tone, cells, note }) {
  const card = document.createElement('article');
  card.className = `compare-card ${tone ?? ''}`;

  const labelNode = document.createElement('div');
  labelNode.className = 'label';
  labelNode.textContent = label;

  const valueNode = document.createElement('div');
  valueNode.className = 'value';
  valueNode.textContent = value;

  const grid = document.createElement('div');
  grid.className = 'delta-grid';
  for (const cell of cells) {
    const node = document.createElement('div');
    node.className = 'delta-cell';

    const cellLabel = document.createElement('span');
    cellLabel.textContent = cell.label;

    const cellValue = document.createElement('strong');
    cellValue.textContent = cell.value;

    node.append(cellLabel, cellValue);
    grid.append(node);
  }

  card.append(labelNode, valueNode, grid);

  if (note) {
    const noteNode = document.createElement('span');
    noteNode.className = 'inline-note';
    noteNode.textContent = note;
    card.append(noteNode);
  }

  return card;
}

function metricCells(before, after) {
  return [
    { label: '1回目', value: formatPercent(before) },
    { label: '2回目', value: formatPercent(after) },
    { label: '差分', value: signedPercent(after - before) },
  ];
}

function renderDoughnutChart(canvasId, label, counts, colors, labelMap = {}) {
  const entries = Object.entries(counts).filter(([, value]) => Number(value) > 0);
  const labels = entries.length ? entries.map(([key]) => translate(key, labelMap)) : ['なし'];
  const data = entries.length ? entries.map(([, value]) => value) : [0];

  replaceChart(canvasId, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [
        {
          label,
          data,
          backgroundColor: colors,
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } },
      },
      cutout: '58%',
    },
  });
}

function renderSuiteStatusChart(run) {
  const suites = run.suite_breakdown ?? [];
  const labels = suites.map((suite) => translate(suite.suite_id, SUITE_LABELS));
  replaceChart('suiteStatusChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        dataset('Passed', suites.map((suite) => count(suite.test_status, 'passed')), COLORS.green),
        dataset('Failed', suites.map((suite) => count(suite.test_status, 'failed')), COLORS.coral),
        dataset('Error', suites.map((suite) => count(suite.test_status, 'error')), COLORS.amber),
      ],
    },
    options: stackedOptions(),
  });
}

function renderConfidenceChart(rows) {
  const bins = ['0.6', '0.7', '0.8', '0.9', '1.0'];
  const labels = ['60%台', '70%台', '80%台', '90%台', '100%'];
  const metaCounts = Object.fromEntries(bins.map((bin) => [bin, 0]));
  const verdictCounts = Object.fromEntries(bins.map((bin) => [bin, 0]));

  for (const row of rows) {
    const bin = confidenceBin(row.confidence);
    const hasMeta = asBool(row.is_false_positive) || asBool(row.is_false_negative);
    if (hasMeta) {
      metaCounts[bin] += 1;
    } else {
      verdictCounts[bin] += 1;
    }
  }

  replaceChart('confidenceChart', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        dataset('メタフラグあり', bins.map((bin) => metaCounts[bin]), COLORS.coral),
        dataset('分類のみ', bins.map((bin) => verdictCounts[bin]), COLORS.blue),
      ],
    },
    options: stackedOptions('自信度帯', 'AI判定件数'),
  });
}

function renderSuiteTrendChart(runs) {
  const labels = runs.map((run) => run.run_id);
  const suites = ['1a-whitebox', '1b-blackbox', '1c-naive'];
  const statuses = [
    ['passed', COLORS.green],
    ['failed', COLORS.coral],
    ['error', COLORS.amber],
  ];
  const datasets = [];

  for (const suiteId of suites) {
    for (const [status, color] of statuses) {
      datasets.push({
        label: `${translate(suiteId, SUITE_LABELS)} ${translate(status, STATUS_LABELS)}`,
        data: runs.map((run) => {
          const suite = (run.suite_breakdown ?? []).find((item) => item.suite_id === suiteId);
          return count(suite?.test_status, status);
        }),
        borderColor: color,
        backgroundColor: color,
        borderDash: status === 'passed' ? [] : status === 'failed' ? [6, 4] : [2, 4],
        tension: 0.25,
      });
    }
  }

  replaceChart('suiteTrendChart', {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } },
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
}

function renderStillPassingTable(rows) {
  renderTable('#stillPassingTable', rows, [
    column('テストケース', (row) => displayValue(row, 'test_case'), caseCell),
    column('スイート', 'test_suite'),
    column('連続PASS', 'consecutive_pass_count'),
    column('差分状態', 'diff_status', (value) => badge(translate(value, DIFF_STATUS_LABELS), 'warn')),
  ], '継続PASSなし');
}

function renderTriageTable(rows) {
  renderTable('#triageTable', rows, [
    column('テストケース', (row) => displayValue(row, 'test_case'), caseCell),
    column('分類', 'ai_verdict', (value) => badge(translate(value, VERDICT_LABELS), 'verdict')),
    column('確信度', 'confidence', (value) => Number(value).toFixed(2)),
    column('FP', 'is_false_positive', flagCell),
    column('FN', 'is_false_negative', flagCell),
    column('対応方針', (row) => row, actionCell),
  ], 'AI判定なし', (row) => {
    return asBool(row.is_false_positive) || asBool(row.is_false_negative) ? 'meta-row' : '';
  });
}

function renderWrongVerdictTable(rows) {
  renderTable('#wrongVerdictTable', rows, [
    column('ID', 'test_id', badgeCell('warn')),
    column('テストケース', (row) => displayValue(row, 'test_case'), caseCell),
    column('期待', 'expected_verdict', (value) => translate(value, VERDICT_LABELS)),
    column('AI', 'ai_verdict', (value) => translate(value, VERDICT_LABELS)),
    column('確信度', 'confidence', (value) => Number(value).toFixed(2)),
  ], '分類ミスマッチなし');
}

function renderMetaMissTable(rows) {
  renderTable('#metaMissTable', rows, [
    column('ID', 'test_id', badgeCell('warn')),
    column('テストケース', (row) => displayValue(row, 'test_case'), caseCell),
    column('期待FP', 'expected_false_positive', flagCell),
    column('AI FP', 'is_false_positive', flagCell),
    column('期待FN', 'expected_false_negative', flagCell),
    column('AI FN', 'is_false_negative', flagCell),
  ], 'メタフラグ取りこぼしなし', () => 'missed-row');
}

function renderFnCandidatesTable(rows) {
  renderTable('#fnCandidatesTable', rows, [
    column('対応ID', 'matched_test_id', badgeCell('warn')),
    column('通過テスト', (row) => displayValue(row, 'test_case'), caseCell),
    column('罠', (row) => displayValue(row, 'matched_test_name'), caseCell),
    column('原因', (row) => displayValue(row, 'root_cause')),
  ], '構造分析候補なし');
}

function renderMetaImprovementTable(rows) {
  renderTable('#metaImprovementTable', rows, [
    column('種別', 'type', badgeCell('ok')),
    column('ID', 'test_id'),
    column('テストケース', (row) => displayValue(row, 'test_case'), caseCell),
    column('1回目', 'before'),
    column('2回目', 'after'),
  ], '改善ケース なし', (row) => row.rowClass ?? '');
}

function renderVerdictBucketTable(rows) {
  renderTable('#verdictBucketTable', rows, [
    column('区分', 'bucket', (value) => bucketBadge(value)),
    column('ID', 'test_id'),
    column('テストケース', (row) => displayValue(row, 'test_case'), caseCell),
    column('1回目', 'before'),
    column('2回目', 'after'),
  ], '差分なし', (row) => row.rowClass ?? '');
}

function renderTable(selector, rows, columns, emptyText, rowClassFn = () => '') {
  const table = qs(selector);
  table.replaceChildren();

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const col of columns) {
    const th = document.createElement('th');
    th.textContent = col.label;
    headRow.append(th);
  }
  thead.append(headRow);

  const tbody = document.createElement('tbody');
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = columns.length;
    td.className = 'muted';
    td.textContent = emptyText;
    tr.append(td);
    tbody.append(tr);
  } else {
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.className = rowClassFn(row);

      for (const col of columns) {
        const td = document.createElement('td');
        const rawValue = typeof col.key === 'function' ? col.key(row) : row[col.key];
        td.append(toNode(col.format ? col.format(rawValue, row) : rawValue));
        tr.append(td);
      }

      tbody.append(tr);
    }
  }

  table.append(thead, tbody);
}

function column(label, key, format) {
  return { label, key, format };
}

function caseCell(value) {
  const span = document.createElement('span');
  span.className = 'case-name';
  span.textContent = value ?? '';
  return span;
}

function flagCell(value) {
  return badge(asBool(value) ? 'あり' : 'なし', asBool(value) ? 'true' : 'false');
}

function actionCell(row) {
  const span = document.createElement('span');
  span.className = 'case-name';
  span.textContent = row.display_recommended_action ?? summarizeAction(row);
  span.title = row.recommended_action ?? '';
  return span;
}

function badgeCell(tone) {
  return (value) => badge(value ?? '', tone);
}

function bucketBadge(value) {
  const tone = value === 'improved' ? 'ok' : value === 'regressed' ? 'true' : 'warn';
  return badge(translate(value, BUCKET_LABELS), tone);
}

function badge(value, tone) {
  const span = document.createElement('span');
  span.className = `badge ${tone ?? ''}`;
  span.textContent = String(value);
  return span;
}

function toNode(value) {
  if (value instanceof Node) {
    return value;
  }

  return document.createTextNode(value === undefined || value === null ? '' : String(value));
}

function selectedRun() {
  return state.runs.find((run) => run.run_id === state.selectedRunId);
}

function groupRuns(groupId) {
  const group = GROUPS.find((item) => item.id === groupId);
  const runIds = new Set(group?.runIds ?? []);
  return state.runs.filter((run) => runIds.has(run.run_id));
}

function computeGroupMetrics(runs) {
  const details = runs.flatMap((run) => run.eval_details ?? []);
  if (!details.length) {
    return { accuracy: 0, fpDetection: 0, fnDetection: 0 };
  }

  const fpExpected = details.filter((row) => row.expected_false_positive === true);
  const fnExpected = details.filter((row) => row.expected_false_negative === true);

  return {
    accuracy: ratio(details.filter((row) => row.verdict_match === true).length, details.length),
    fpDetection: ratio(fpExpected.filter((row) => row.is_false_positive === true).length, fpExpected.length),
    fnDetection: ratio(fnExpected.filter((row) => row.is_false_negative === true).length, fnExpected.length),
  };
}

function compareMetaCases(beforeRuns, afterRuns) {
  const before = collectMetaCases(beforeRuns);
  const after = collectMetaCases(afterRuns);
  const rows = [];

  for (const [key, beforeCase] of before.entries()) {
    const afterCase = after.get(key);
    if (!afterCase) {
      continue;
    }

    if (beforeCase.misses > 0 && hitRate(afterCase) > hitRate(beforeCase)) {
      rows.push({
        type: beforeCase.type,
        test_id: beforeCase.test_id,
        test_case: beforeCase.test_case,
        before: `${beforeCase.hits}/${beforeCase.total}`,
        after: `${afterCase.hits}/${afterCase.total}`,
        rowClass: 'improved-row',
      });
    }
  }

  return rows.sort((left, right) => left.type.localeCompare(right.type) || left.test_id.localeCompare(right.test_id));
}

function collectMetaCases(runs) {
  const cases = new Map();

  for (const detail of runs.flatMap((run) => run.eval_details ?? [])) {
    const expectedFp = detail.expected_false_positive === true;
    const expectedFn = detail.expected_false_negative === true;
    if (!expectedFp && !expectedFn) {
      continue;
    }

    const key = `${detail.test_id}|${detail.test_case}`;
    const entry = cases.get(key) ?? {
      type: expectedFn ? 'FN' : 'FP',
      test_id: detail.test_id ?? '',
      test_case: detail.display_test_case ?? detail.test_case ?? '',
      total: 0,
      hits: 0,
      misses: 0,
    };

    entry.total += 1;
    const hit = expectedFn ? detail.is_false_negative === true : detail.is_false_positive === true;
    if (hit) {
      entry.hits += 1;
    } else {
      entry.misses += 1;
    }
    cases.set(key, entry);
  }

  return cases;
}

function compareVerdictBuckets(beforeRuns, afterRuns) {
  const before = collectVerdictCases(beforeRuns);
  const after = collectVerdictCases(afterRuns);
  const rows = [];

  for (const [key, beforeCase] of before.entries()) {
    const afterCase = after.get(key);
    if (!afterCase) {
      continue;
    }

    const beforeRate = hitRate(beforeCase, 'correct');
    const afterRate = hitRate(afterCase, 'correct');

    if (beforeCase.incorrect > 0 && afterRate > beforeRate) {
      rows.push(verdictBucketRow('improved', beforeCase, afterCase, 'improved-row'));
    } else if (afterRate < beforeRate) {
      rows.push(verdictBucketRow('regressed', beforeCase, afterCase, 'regressed-row'));
    } else if (beforeCase.incorrect > 0 && afterCase.incorrect > 0) {
      rows.push(verdictBucketRow('still missed', beforeCase, afterCase, 'missed-row'));
    }
  }

  return rows.sort((left, right) => left.bucket.localeCompare(right.bucket) || left.test_id.localeCompare(right.test_id));
}

function collectVerdictCases(runs) {
  const cases = new Map();

  for (const detail of runs.flatMap((run) => run.eval_details ?? [])) {
    const key = `${detail.test_id}|${detail.test_case}`;
    const entry = cases.get(key) ?? {
      test_id: detail.test_id ?? '',
      test_case: detail.display_test_case ?? detail.test_case ?? '',
      total: 0,
      correct: 0,
      incorrect: 0,
    };

    entry.total += 1;
    if (detail.verdict_match === true) {
      entry.correct += 1;
    } else {
      entry.incorrect += 1;
    }
    cases.set(key, entry);
  }

  return cases;
}

function verdictBucketRow(bucket, beforeCase, afterCase, rowClass) {
  return {
    bucket,
    test_id: beforeCase.test_id,
    test_case: beforeCase.test_case,
    before: `${beforeCase.correct}/${beforeCase.total}`,
    after: `${afterCase.correct}/${afterCase.total}`,
    rowClass,
  };
}

function hitRate(caseSummary, hitKey = 'hits') {
  return ratio(Number(caseSummary[hitKey] ?? 0), Number(caseSummary.total ?? 0));
}

function isMetaMiss(row) {
  return (
    (row.expected_false_positive === true && row.is_false_positive !== true) ||
    (row.expected_false_negative === true && row.is_false_negative !== true)
  );
}

function dataset(label, data, color) {
  return {
    label,
    data,
    backgroundColor: color,
    borderColor: color,
    borderWidth: 1,
  };
}

function stackedOptions(xTitle, yTitle) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } },
    },
    scales: {
      x: {
        stacked: true,
        title: { display: Boolean(xTitle), text: xTitle },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        ticks: { precision: 0 },
        title: { display: Boolean(yTitle), text: yTitle },
      },
    },
  };
}

function replaceChart(canvasId, config) {
  if (state.charts[canvasId]) {
    state.charts[canvasId].destroy();
  }

  state.charts[canvasId] = new Chart(qs(`#${canvasId}`), config);
}

function confidenceBin(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) {
    return '0.6';
  }

  const rounded = Math.min(1, Math.max(0.6, Math.round(confidence * 10) / 10));
  return rounded.toFixed(1);
}

function count(counts, key) {
  return Number(counts?.[key] ?? 0);
}

function metric(run, key) {
  const value = Number(run.eval_latest?.[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function deltaText(before, after) {
  return signedPercent(after - before);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return '0%';
  }

  return `${Math.round(value * 100)}%`;
}

function signedPercent(value) {
  if (!Number.isFinite(value)) {
    return '+0pt';
  }

  const rounded = Math.round(value * 100);
  return `${rounded >= 0 ? '+' : ''}${rounded}pt`;
}

function asBool(value) {
  return value === true || value === 'true';
}

function compareRuns(left, right) {
  return runNumber(left.run_id) - runNumber(right.run_id);
}

function runNumber(runId) {
  const match = String(runId ?? '').match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function formatDate(value) {
  if (!value) {
    return '';
  }

  return new Date(value).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function artifactLabel(artifactDir) {
  const match = String(artifactDir ?? '').match(/^(\d+)/);
  return match ? `${match[1]}回目` : artifactDir;
}

function setStatus(text, isError = false) {
  const status = qs('#dataStatus');
  status.textContent = text;
  status.classList.toggle('error', isError);
}

function updateStatus() {
  const source = state.summarySource ? ` / ${state.summarySource}` : '';
  setStatus(`表示 ${state.selectedRunId} / 生成 ${formatDate(state.generatedAt)}${source}`);
}

function renderEmptyShell(error) {
  renderMetricStrip('#testKpis', [
    { label: 'Passed', value: 0 },
    { label: 'Failed', value: 0 },
    { label: 'Error', value: 0 },
  ]);
  renderMetricStrip('#metaFlagCards', [
    { label: '失敗ログ内FPフラグ', value: 0, tone: 'meta fp' },
    { label: '失敗ログ内FNフラグ', value: 0, tone: 'meta fn' },
    { label: 'AI判定件数', value: 0 },
  ]);
  renderMetricStrip('#evalKpis', [
    { label: '失敗ログ内FNシグナル検知率', value: '0%', tone: 'fn' },
    { label: '失敗ログ内FPシグナル検知率', value: '0%', tone: 'fp' },
    { label: '分類一致率', value: '0%', tone: 'accuracy' },
  ]);

  for (const table of [
    '#stillPassingTable',
    '#triageTable',
    '#wrongVerdictTable',
    '#metaMissTable',
    '#fnCandidatesTable',
    '#metaImprovementTable',
    '#verdictBucketTable',
  ]) {
    renderTable(table, [], [column(error ? String(error.message ?? error) : 'データなし', () => '')], 'データなし');
  }
}

function translate(value, labels) {
  return labels[value] ?? value ?? '';
}

function displayValue(row, key) {
  return row[`display_${key}`] ?? row[key] ?? '';
}

function summarizeAction(row) {
  if (asBool(row.is_false_negative)) {
    return '実バグ候補として再現・修正する';
  }

  if (asBool(row.is_false_positive)) {
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

  return '原因を確認して対応を決める';
}

function qs(selector) {
  return document.querySelector(selector);
}
