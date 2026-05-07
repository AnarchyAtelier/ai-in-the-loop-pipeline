import { useState, useEffect, useRef } from "react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, ResponsiveContainer, Legend, Tooltip
} from "recharts";

// ── Storage keys ───────────────────────────────────────────────────────
const IDX_KEY     = "llmeval:index";
const RPT_PFX     = "llmeval:report:";
const AGG_KEY     = "llmeval:aggregate";
const CTX_IDX_KEY = "llmeval:ctx:index";
const CTX_PFX     = "llmeval:ctx:file:";
const APIKEY_KEY  = "llmeval:apikey";
const MODEL_KEY   = "llmeval:model";

// ── Helpers ────────────────────────────────────────────────────────────
async function stGet(key) {
  try { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : null; }
  catch { return null; }
}
async function stSet(key, val) { await window.storage.set(key, JSON.stringify(val)); }
async function stDel(key)      { try { await window.storage.delete(key); } catch {} }

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = e => resolve(e.target.result);
    r.onerror = reject;
    r.readAsText(file, "utf-8");
  });
}

async function callOpenAI(apiKey, model, system, userMsg) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      temperature: 0.2,
      messages: [
        { role: "system",  content: system },
        { role: "user",    content: userMsg }
      ]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(`OpenAI: ${data.error.message}`);
  return data.choices[0].message.content;
}

async function buildContextSection() {
  const idx = (await stGet(CTX_IDX_KEY)) || [];
  if (idx.length === 0) return "";
  let out = "\n\n---\n# 評価コンテキスト\n以下の情報を参照して評価の精度を高めること。\n\n";
  for (const f of idx) {
    const content = await stGet(CTX_PFX + f.id);
    if (!content) continue;
    const label = f.type === "config" ? "Promptfoo設定ファイル" : "仕様書";
    out += `## [${label}] ${f.name}\n\`\`\`\n${content.slice(0, 20000)}\n\`\`\`\n\n`;
  }
  return out;
}

// ── Prompts ────────────────────────────────────────────────────────────
const RADAR_AXES = ["Promptfoo", "静的検査", "JUnit", "Jacoco", "PIT"];

const EVAL_SYSTEM_BASE = `あなたはLLMモデル比較の評価アナリストです。GitHubアーティファクトのマークダウンデータ（およびコンテキストが提供されている場合はそれ）を分析し、JSONのみを返してください。前置き・後置き・コードブロック記法は不要です。

スキーマ（厳密に従うこと）:
{
  "label": "ラベル（例: gpt-5.4 vs gpt-5.4-mini / spec-constrained）",
  "compared_models": ["model_a名", "model_b名"],
  "bundle": "バンドル名",
  "prompt_style": "スタイル名",
  "suite_count": 数値,
  "quantitative": {
    "summary": "数値データの要約（3文以内）",
    "overall_winner": "優位なモデル名またはtie",
    "metrics": [
      {"name": "指標名", "model_a": "値", "model_b": "値", "winner": "モデル名またはtie"}
    ]
  },
  "qualitative": {
    "summary": "定性評価の要約（5文以内）。コンテキストがある場合は仕様への適合状況を含めること",
    "model_a_strengths": ["強み1", "強み2"],
    "model_b_strengths": ["強み1", "強み2"],
    "risks": ["注意点1", "注意点2"],
    "recommendation": "推奨事項（2文以内）",
    "spec_coverage_note": "仕様書がある場合：仕様項目のうちテストで網羅されている範囲のコメント。なければnull"
  },
  "radar": {
    "model_a": {
      "Promptfoo": "0〜100の整数（promptfoo score の全suite平均）",
      "静的検査": "0〜100の整数（コンテキストがある場合は仕様への構造準拠度を、ない場合はverdict分布: pass=100/review=60/fail=0の加重平均）",
      "JUnit": "0〜100の整数（avg test pass rate）",
      "Jacoco": "0〜100の整数（avg coverage line）",
      "PIT": "0〜100の整数（avg mutation score、not_applicable除外）"
    },
    "model_b": {
      "Promptfoo": 数値,
      "静的検査": 数値,
      "JUnit": 数値,
      "Jacoco": 数値,
      "PIT": 数値
    }
  }
}

radarの値はすべて0〜100の整数。データが存在しない軸は0とすること。`;

const AGG_SYSTEM = `あなたはLLMモデル比較の評価アナリストです。複数の比較レポートを横断的に分析し、日本語マークダウンで総合評価レポートを作成してください。定量・定性の両面から結論を導いてください。コンテキストがある場合は仕様への全体的な適合状況も含めてください。`;

// ── Main App ───────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]                       = useState("input");
  const [input, setInput]                   = useState("");
  const [loading, setLoading]               = useState(false);
  const [index, setIndex]                   = useState([]);
  const [selectedId, setSelectedId]         = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);
  const [chartLogId, setChartLogId]         = useState(null);
  const [chartReport, setChartReport]       = useState(null);
  const [aggregate, setAggregate]           = useState("");
  const [aggregating, setAggregating]       = useState(false);
  const [exporting, setExporting]           = useState(false);
  const [toast, setToast]                   = useState(null);
  const [apiKey, setApiKey]                 = useState("");
  const [model, setModel]                   = useState("gpt-4o");
  const [ctxFiles, setCtxFiles]             = useState([]);

  useEffect(() => {
    stGet(IDX_KEY).then(v  => { if (v) setIndex(v); });
    stGet(AGG_KEY).then(v  => { if (v) setAggregate(v); });
    stGet(APIKEY_KEY).then(v => { if (v) setApiKey(v); });
    stGet(MODEL_KEY).then(v  => { if (v) setModel(v); });
    stGet(CTX_IDX_KEY).then(v => { if (v) setCtxFiles(v); });
  }, []);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  };

  const saveIndex = async (newIdx) => {
    await stSet(IDX_KEY, newIdx);
    setIndex(newIdx);
  };

  const requireKey = () => {
    if (!apiKey) {
      showToast("コンテキストタブでAPIキーを設定してください", "error");
      setTab("context");
      return false;
    }
    return true;
  };

  const handleEvaluate = async () => {
    if (!input.trim() || loading) return;
    if (!requireKey()) return;
    setLoading(true);
    try {
      const ctxSection = await buildContextSection();
      const system = EVAL_SYSTEM_BASE + ctxSection;
      const raw    = await callOpenAI(apiKey, model, system, input);
      const clean  = raw.replace(/```json|```/g, "").trim();
      const ev     = JSON.parse(clean);
      const id     = `r_${Date.now()}`;
      const report = { id, label: ev.label, createdAt: new Date().toISOString(), evaluation: ev, rawInput: input };
      await stSet(RPT_PFX + id, report);
      const newIdx = [...index, { id, label: ev.label, createdAt: report.createdAt }];
      await saveIndex(newIdx);
      setInput("");
      setSelectedId(id);
      setSelectedReport(report);
      setTab("logs");
      showToast("評価を保存しました");
    } catch (e) {
      showToast("エラー: " + e.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const loadReport = async (id) => {
    setSelectedId(id);
    setSelectedReport(await stGet(RPT_PFX + id));
  };

  const loadChartReport = async (id) => {
    setChartLogId(id);
    setChartReport(await stGet(RPT_PFX + id));
  };

  const deleteReport = async (id) => {
    if (!confirm("このログを削除しますか？")) return;
    await stDel(RPT_PFX + id);
    const newIdx = index.filter(i => i.id !== id);
    await saveIndex(newIdx);
    if (selectedId === id)  { setSelectedId(null);  setSelectedReport(null); }
    if (chartLogId === id)  { setChartLogId(null);  setChartReport(null); }
    showToast("削除しました");
  };

  const handleAggregate = async () => {
    if (index.length === 0 || aggregating) return;
    if (!requireKey()) return;
    setAggregating(true);
    try {
      const all = [];
      for (const idx of index) {
        const r = await stGet(RPT_PFX + idx.id);
        if (r) all.push(r);
      }
      const summaries = all.map((r, i) =>
        `### [${i + 1}] ${r.label}\n\`\`\`json\n${JSON.stringify(r.evaluation, null, 2)}\n\`\`\``
      ).join("\n\n");
      const ctxSection = await buildContextSection();
      const system = AGG_SYSTEM + ctxSection;
      const result = await callOpenAI(apiKey, model, system,
        `以下は${all.length}件のLLM比較評価です。横断的に分析してください。\n\n${summaries}`
      );
      setAggregate(result);
      await stSet(AGG_KEY, result);
      setTab("aggregate");
      showToast("全体集計が完了しました");
    } catch (e) {
      showToast("エラー: " + e.message, "error");
    } finally {
      setAggregating(false);
    }
  };

  const handleExport = async () => {
    if (index.length === 0 || exporting) return;
    setExporting(true);
    try {
      let md = `# LLM モデル比較評価ログ\n\nエクスポート日時: ${new Date().toLocaleString("ja-JP")}  \n総件数: ${index.length}\n\n---\n\n`;
      for (const [i, idx] of index.entries()) {
        const r = await stGet(RPT_PFX + idx.id);
        if (!r) continue;
        const ev = r.evaluation;
        const mA = ev.compared_models?.[0] || "Model A";
        const mB = ev.compared_models?.[1] || "Model B";
        md += `## [${i + 1}] ${r.label}\n\n`;
        md += `**記録日時:** ${new Date(r.createdAt).toLocaleString("ja-JP")}  \n`;
        md += `**バンドル:** ${ev.bundle || "-"}  **スタイル:** ${ev.prompt_style || "-"}  **スイート数:** ${ev.suite_count || "-"}\n\n`;
        md += `### 定量評価\n\n${ev.quantitative?.summary || ""}\n\n`;
        md += `**総合優位モデル:** ${ev.quantitative?.overall_winner || "-"}\n\n`;
        if (ev.quantitative?.metrics?.length) {
          md += `| 指標 | ${mA} | ${mB} | 優位 |\n|---|---|---|---|\n`;
          ev.quantitative.metrics.forEach(m => {
            md += `| ${m.name} | ${m.model_a} | ${m.model_b} | ${m.winner} |\n`;
          });
          md += `\n`;
        }
        if (ev.radar) {
          md += `### レーダーチャートスコア\n\n| 工程 | ${mA} | ${mB} |\n|---|---|---|\n`;
          RADAR_AXES.forEach(ax => {
            md += `| ${ax} | ${ev.radar.model_a?.[ax] ?? "-"} | ${ev.radar.model_b?.[ax] ?? "-"} |\n`;
          });
          md += `\n`;
        }
        md += `### 定性評価\n\n${ev.qualitative?.summary || ""}\n\n`;
        if (ev.qualitative?.spec_coverage_note) {
          md += `**仕様カバレッジ:** ${ev.qualitative.spec_coverage_note}\n\n`;
        }
        md += `**${mA} の強み:** ${ev.qualitative?.model_a_strengths?.join("、") || "-"}\n\n`;
        md += `**${mB} の強み:** ${ev.qualitative?.model_b_strengths?.join("、") || "-"}\n\n`;
        md += `**注意点:** ${ev.qualitative?.risks?.join("、") || "-"}\n\n`;
        md += `**推奨:** ${ev.qualitative?.recommendation || "-"}\n\n---\n\n`;
      }
      if (aggregate) md += `## 全体集計分析\n\n${aggregate}\n`;
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url  = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), {
        href: url,
        download: `llm-comparison-${new Date().toISOString().slice(0, 10)}.md`
      }).click();
      URL.revokeObjectURL(url);
      showToast("エクスポートしました");
    } catch (e) {
      showToast("エクスポートエラー: " + e.message, "error");
    } finally {
      setExporting(false);
    }
  };

  const C = {
    bg: "#0d1117", panel: "#161b22", border: "#30363d",
    accent: "#2563eb", text: "#e6edf3", muted: "#8b949e",
    card: "#1c2128", green: "#22c55e", purple: "#a855f7",
    yellow: "#eab308",
  };

  const tabBtn = (t, label, badge) => (
    <button key={t} onClick={() => setTab(t)} style={{
      padding: "7px 18px", display: "flex", alignItems: "center", gap: "6px",
      background: tab === t ? C.accent : "transparent",
      color: tab === t ? "white" : C.muted,
      border: `1px solid ${tab === t ? C.accent : C.border}`,
      borderRadius: "6px", cursor: "pointer",
      fontSize: "13px", fontFamily: "inherit", transition: "all 0.15s",
    }}>
      {label}
      {badge != null && (
        <span style={{ background: tab === t ? "rgba(255,255,255,0.25)" : C.card, borderRadius: "10px", padding: "0 7px", fontSize: "10px", color: tab === t ? "white" : C.muted }}>
          {badge}
        </span>
      )}
    </button>
  );

  const hasKey = !!apiKey;

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "'JetBrains Mono','Fira Code',monospace", fontSize: "13px" }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600;700&display=swap" rel="stylesheet" />

      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999, background: toast.type === "error" ? "#7f1d1d" : "#14532d", color: "white", padding: "10px 20px", borderRadius: "8px", border: `1px solid ${toast.type === "error" ? "#ef4444" : C.green}`, fontSize: "13px", fontFamily: "inherit" }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", background: C.panel }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ color: C.accent, fontWeight: 700, fontSize: "15px" }}>LLM Eval</span>
          <span style={{ color: C.muted, fontSize: "15px" }}>/ comparison tool</span>
          <span style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "2px 10px", fontSize: "11px", color: C.muted }}>{index.length} logs</span>
          {!hasKey && (
            <span style={{ background: "#422006", border: "1px solid #92400e", borderRadius: "12px", padding: "2px 10px", fontSize: "11px", color: "#fcd34d", cursor: "pointer" }} onClick={() => setTab("context")}>
              API Key 未設定
            </span>
          )}
          {hasKey && ctxFiles.length > 0 && (
            <span style={{ background: "#14532d", border: "1px solid #166534", borderRadius: "12px", padding: "2px 10px", fontSize: "11px", color: C.green }}>
              ctx: {ctxFiles.length} files
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={handleAggregate} disabled={index.length === 0 || aggregating}
            style={{ padding: "7px 16px", background: index.length === 0 ? C.border : "#581c87", color: index.length === 0 ? C.muted : "#d8b4fe", border: "1px solid #6b21a8", borderRadius: "6px", cursor: index.length === 0 ? "not-allowed" : "pointer", fontSize: "12px", fontFamily: "inherit" }}>
            {aggregating ? "集計中..." : "全体集計"}
          </button>
          <button onClick={handleExport} disabled={index.length === 0 || exporting}
            style={{ padding: "7px 16px", background: index.length === 0 ? C.border : "#14532d", color: index.length === 0 ? C.muted : C.green, border: `1px solid ${index.length === 0 ? C.border : "#166534"}`, borderRadius: "6px", cursor: index.length === 0 ? "not-allowed" : "pointer", fontSize: "12px", fontFamily: "inherit" }}>
            {exporting ? "..." : "MD エクスポート"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ padding: "12px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: "6px", background: C.panel, flexWrap: "wrap" }}>
        {tabBtn("input", "入力")}
        {tabBtn("logs",  "ログ一覧", index.length)}
        {tabBtn("chart", "チャート")}
        {tabBtn("context", "コンテキスト", ctxFiles.length || undefined)}
        {aggregate && tabBtn("aggregate", "全体集計")}
      </div>

      <div style={{ padding: "20px 24px" }}>

        {/* ── INPUT TAB ── */}
        {tab === "input" && (
          <div style={{ maxWidth: "860px", margin: "0 auto" }}>
            {!hasKey && (
              <div onClick={() => setTab("context")} style={{ background: "#422006", border: "1px solid #92400e", borderRadius: "8px", padding: "12px 16px", marginBottom: "16px", color: "#fde68a", fontSize: "12px", cursor: "pointer" }}>
                OpenAI API Key が未設定です。コンテキストタブで設定してください。
              </div>
            )}
            <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "24px" }}>
              <div style={{ color: C.muted, fontSize: "12px", marginBottom: "16px", lineHeight: "1.7" }}>
                GitHub アーティファクトから Promptfoo 比較結果のマークダウンを貼り付けてください。
                {ctxFiles.length > 0 && (
                  <span style={{ color: C.green }}> コンテキストファイル ({ctxFiles.length}件) を参照して評価します。</span>
                )}
              </div>
              <textarea
                value={input} onChange={e => setInput(e.target.value)}
                style={{ width: "100%", height: "320px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "14px", color: C.text, fontSize: "12px", fontFamily: "inherit", resize: "vertical", outline: "none", lineHeight: "1.6", boxSizing: "border-box" }}
                placeholder={"# Promptfoo Model Comparison\n\n- bundle: `spec`\n- prompt_style: `constrained`\n- compared_models: `gpt-x vs gpt-y`\n\n## Per Run\n| model | suite | ..."}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "14px" }}>
                <span style={{ color: C.muted, fontSize: "11px" }}>{input.length} chars · model: {model}</span>
                <button onClick={handleEvaluate} disabled={!input.trim() || loading}
                  style={{ padding: "9px 28px", background: loading || !input.trim() ? C.border : C.accent, color: loading || !input.trim() ? C.muted : "white", border: "none", borderRadius: "6px", cursor: loading || !input.trim() ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, fontFamily: "inherit" }}>
                  {loading ? "評価中..." : "評価を実行"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── LOGS TAB ── */}
        {tab === "logs" && (
          <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
            <LogList index={index} selectedId={selectedId} onSelect={loadReport} onDelete={deleteReport} C={C} />
            <div style={{ flex: 1 }}>
              {!selectedReport
                ? <EmptyState msg="左のリストからログを選択してください" C={C} />
                : <ReportDetail report={selectedReport} C={C} />
              }
            </div>
          </div>
        )}

        {/* ── CHART TAB ── */}
        {tab === "chart" && (
          <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
            <LogList index={index} selectedId={chartLogId} onSelect={loadChartReport} onDelete={deleteReport} C={C} accentColor={C.purple} accentBorder="#7c3aed" />
            <div style={{ flex: 1 }}>
              {!chartReport
                ? <EmptyState msg="左からログを選択するとレーダーチャートが表示されます" C={C} />
                : <RadarPanel report={chartReport} C={C} showToast={showToast} />
              }
            </div>
          </div>
        )}

        {/* ── CONTEXT TAB ── */}
        {tab === "context" && (
          <ContextTab
            C={C}
            apiKey={apiKey} setApiKey={setApiKey}
            model={model}  setModel={setModel}
            ctxFiles={ctxFiles} setCtxFiles={setCtxFiles}
            showToast={showToast}
          />
        )}

        {/* ── AGGREGATE TAB ── */}
        {tab === "aggregate" && aggregate && (
          <div style={{ maxWidth: "860px", margin: "0 auto", background: C.panel, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "28px" }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: C.accent, marginBottom: "16px" }}>全体集計分析 — {index.length} 件</div>
            <div style={{ whiteSpace: "pre-wrap", lineHeight: "1.8", color: C.text, fontSize: "13px" }}>{aggregate}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Context Tab ────────────────────────────────────────────────────────
function ContextTab({ C, apiKey, setApiKey, model, setModel, ctxFiles, setCtxFiles, showToast }) {
  const [showKey, setShowKey] = useState(false);
  const [keyInput, setKeyInput] = useState(apiKey);
  const [modelInput, setModelInput] = useState(model);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);

  const saveApiKey = async () => {
    await stSet(APIKEY_KEY, keyInput);
    setApiKey(keyInput);
    showToast("API Key を保存しました");
  };

  const saveModel = async () => {
    await stSet(MODEL_KEY, modelInput);
    setModel(modelInput);
    showToast(`モデルを ${modelInput} に設定しました`);
  };

  const handleFiles = async (files) => {
    const added = [];
    for (const file of Array.from(files)) {
      try {
        const content = await readFile(file);
        const id  = `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const ext = file.name.split(".").pop().toLowerCase();
        const type = ["yaml", "yml"].includes(ext) ? "config" : "spec";
        const entry = { id, name: file.name, type, size: file.size, createdAt: new Date().toISOString() };
        await stSet(CTX_PFX + id, content);
        added.push(entry);
      } catch { showToast(`${file.name} の読み込みに失敗しました`, "error"); }
    }
    if (added.length === 0) return;
    const updated = [...ctxFiles, ...added];
    await stSet(CTX_IDX_KEY, updated);
    setCtxFiles(updated);
    showToast(`${added.length}件 追加しました`);
  };

  const toggleType = async (id) => {
    const updated = ctxFiles.map(f => f.id === id ? { ...f, type: f.type === "config" ? "spec" : "config" } : f);
    await stSet(CTX_IDX_KEY, updated);
    setCtxFiles(updated);
  };

  const removeFile = async (id) => {
    await stDel(CTX_PFX + id);
    const updated = ctxFiles.filter(f => f.id !== id);
    await stSet(CTX_IDX_KEY, updated);
    setCtxFiles(updated);
    showToast("削除しました");
  };

  const totalSize = ctxFiles.reduce((s, f) => s + (f.size || 0), 0);

  return (
    <div style={{ maxWidth: "860px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px" }}>

      {/* API 設定 */}
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "24px" }}>
        <SectionTitle C={C}>API 設定</SectionTitle>
        <div style={{ color: C.muted, fontSize: "11px", marginBottom: "16px", lineHeight: "1.6", background: "#1c2128", border: "1px solid #30363d", borderRadius: "6px", padding: "10px 14px" }}>
          API Key はブラウザのストレージに保存されます。個人・ローカル環境での使用を推奨します。
        </div>

        <div style={{ marginBottom: "14px" }}>
          <div style={{ fontSize: "11px", color: C.muted, marginBottom: "6px" }}>OpenAI API Key</div>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type={showKey ? "text" : "password"}
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder="sk-..."
              style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "8px 12px", color: C.text, fontSize: "13px", fontFamily: "inherit", outline: "none" }}
            />
            <button onClick={() => setShowKey(v => !v)}
              style={{ padding: "8px 14px", background: C.card, border: `1px solid ${C.border}`, borderRadius: "6px", color: C.muted, cursor: "pointer", fontSize: "12px", fontFamily: "inherit" }}>
              {showKey ? "隠す" : "表示"}
            </button>
            <button onClick={saveApiKey}
              style={{ padding: "8px 18px", background: C.accent, border: "none", borderRadius: "6px", color: "white", cursor: "pointer", fontSize: "12px", fontFamily: "inherit", fontWeight: 600 }}>
              保存
            </button>
          </div>
        </div>

        <div>
          <div style={{ fontSize: "11px", color: C.muted, marginBottom: "6px" }}>分析モデル</div>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              value={modelInput}
              onChange={e => setModelInput(e.target.value)}
              placeholder="gpt-4o"
              style={{ width: "220px", background: C.bg, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "8px 12px", color: C.text, fontSize: "13px", fontFamily: "inherit", outline: "none" }}
            />
            <button onClick={saveModel}
              style={{ padding: "8px 18px", background: C.card, border: `1px solid ${C.border}`, borderRadius: "6px", color: C.muted, cursor: "pointer", fontSize: "12px", fontFamily: "inherit" }}>
              適用
            </button>
            {["gpt-4o", "gpt-4o-mini", "gpt-4.1"].map(m => (
              <button key={m} onClick={() => { setModelInput(m); stSet(MODEL_KEY, m); setModel(m); }}
                style={{ padding: "8px 12px", background: modelInput === m ? "#1e3a5f" : C.card, border: `1px solid ${modelInput === m ? "#1d4ed8" : C.border}`, borderRadius: "6px", color: modelInput === m ? "#7dd3fc" : C.muted, cursor: "pointer", fontSize: "11px", fontFamily: "inherit" }}>
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* コンテキストファイル */}
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <SectionTitle C={C}>コンテキストファイル</SectionTitle>
          <span style={{ fontSize: "11px", color: C.muted }}>{ctxFiles.length} files · {(totalSize / 1024).toFixed(1)} KB</span>
        </div>
        <div style={{ fontSize: "11px", color: C.muted, marginBottom: "14px" }}>
          promptfooconfig.yaml や仕様書（MD/TXT）をアップロードすると、評価の精度が向上します。ファイルはブラウザのストレージに永続保存されます。
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => fileRef.current?.click()}
          style={{ border: `2px dashed ${dragging ? C.accent : C.border}`, borderRadius: "8px", padding: "28px", textAlign: "center", cursor: "pointer", marginBottom: "16px", transition: "border 0.15s", background: dragging ? "#1e3a5f22" : "transparent" }}
        >
          <input ref={fileRef} type="file" multiple accept=".yaml,.yml,.md,.txt,.json" style={{ display: "none" }}
            onChange={e => handleFiles(e.target.files)} />
          <div style={{ color: C.muted, fontSize: "12px" }}>
            ドロップ、またはクリックしてファイルを選択
          </div>
          <div style={{ color: C.muted, fontSize: "11px", marginTop: "6px" }}>
            .yaml / .yml / .md / .txt / .json
          </div>
        </div>

        {/* File list */}
        {ctxFiles.length > 0 && (
          <div>
            {ctxFiles.map(f => (
              <div key={f.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: C.card, border: `1px solid ${C.border}`, borderRadius: "6px", marginBottom: "6px" }}>
                <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "10px", fontWeight: 600, background: f.type === "config" ? "#422006" : "#1e3a5f", color: f.type === "config" ? "#fcd34d" : "#7dd3fc", border: `1px solid ${f.type === "config" ? "#92400e" : "#1d4ed8"}`, cursor: "pointer", whiteSpace: "nowrap" }}
                  onClick={() => toggleType(f.id)}>
                  {f.type === "config" ? "config" : "spec"}
                </span>
                <span style={{ flex: 1, fontSize: "12px", color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                <span style={{ fontSize: "10px", color: C.muted, whiteSpace: "nowrap" }}>{(f.size / 1024).toFixed(1)} KB</span>
                <button onClick={() => removeFile(f.id)}
                  style={{ padding: "2px 8px", background: "transparent", color: "#f87171", border: "1px solid #7f1d1d", borderRadius: "4px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit" }}>
                  削除
                </button>
              </div>
            ))}
            <div style={{ fontSize: "11px", color: C.muted, marginTop: "8px" }}>
              バッジをクリックすると config / spec を切り替えられます。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared components ──────────────────────────────────────────────────
function LogList({ index, selectedId, onSelect, onDelete, C, accentColor, accentBorder }) {
  const ac  = accentColor  || C.accent;
  const acb = accentBorder || C.accent;
  return (
    <div style={{ width: "260px", flexShrink: 0 }}>
      {index.length === 0
        ? <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "24px", textAlign: "center", color: C.muted }}>ログがありません</div>
        : index.map((item, i) => (
          <div key={item.id} onClick={() => onSelect(item.id)}
            style={{ background: selectedId === item.id ? C.card : C.panel, border: `1px solid ${selectedId === item.id ? ac : C.border}`, borderRadius: "8px", padding: "12px", marginBottom: "8px", cursor: "pointer", transition: "border 0.15s" }}>
            <div style={{ fontSize: "11px", color: C.muted, marginBottom: "4px" }}>[{String(i + 1).padStart(2, "0")}]</div>
            <div style={{ fontSize: "12px", color: C.text, fontWeight: 600, lineHeight: "1.4", marginBottom: "6px" }}>{item.label}</div>
            <div style={{ fontSize: "10px", color: C.muted }}>{new Date(item.createdAt).toLocaleString("ja-JP")}</div>
            <button onClick={e => { e.stopPropagation(); onDelete(item.id); }}
              style={{ marginTop: "8px", padding: "2px 8px", background: "transparent", color: "#f87171", border: "1px solid #7f1d1d", borderRadius: "4px", cursor: "pointer", fontSize: "10px", fontFamily: "inherit" }}>
              削除
            </button>
          </div>
        ))
      }
    </div>
  );
}

function EmptyState({ msg, C }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "60px", textAlign: "center", color: C.muted }}>
      {msg}
    </div>
  );
}

function SectionTitle({ children, C }) {
  return (
    <div style={{ fontSize: "12px", fontWeight: 700, color: "#7dd3fc", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
      <span style={{ display: "inline-block", width: "3px", height: "14px", background: "#2563eb", borderRadius: "2px" }} />
      {children}
    </div>
  );
}

// ── Radar Panel ────────────────────────────────────────────────────────
function RadarPanel({ report, C, showToast }) {
  const radarRef  = useRef(null);
  const ev        = report.evaluation;
  const mA        = ev.compared_models?.[0] || "Model A";
  const mB        = ev.compared_models?.[1] || "Model B";
  const radarData = ev.radar;

  const chartData = radarData
    ? RADAR_AXES.map(ax => ({ axis: ax, [mA]: radarData.model_a?.[ax] ?? 0, [mB]: radarData.model_b?.[ax] ?? 0 }))
    : null;

  const handleScreenshot = () => {
    const svgEl = radarRef.current?.querySelector("svg");
    if (!svgEl) { showToast("チャートが見つかりません", "error"); return; }
    const rect = svgEl.getBoundingClientRect();
    const W = Math.round(rect.width) || 560;
    const H = Math.round(rect.height) || 420;
    const clone = svgEl.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width",  W);
    clone.setAttribute("height", H);
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", "100%"); bg.setAttribute("height", "100%"); bg.setAttribute("fill", "#161b22");
    clone.insertBefore(bg, clone.firstChild);
    const titleEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
    titleEl.setAttribute("x", W / 2); titleEl.setAttribute("y", 16);
    titleEl.setAttribute("text-anchor", "middle"); titleEl.setAttribute("fill", "#8b949e");
    titleEl.setAttribute("font-size", "11"); titleEl.setAttribute("font-family", "monospace");
    titleEl.textContent = report.label;
    clone.insertBefore(titleEl, clone.firstChild.nextSibling);
    const svgStr = new XMLSerializer().serializeToString(clone);
    const scale  = 2;
    const canvas = document.createElement("canvas");
    canvas.width  = W * scale; canvas.height = H * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale); ctx.fillStyle = "#161b22"; ctx.fillRect(0, 0, W, H);
    const img  = new Image();
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    img.onload = () => {
      ctx.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url);
      canvas.toBlob(pngBlob => {
        const dl = URL.createObjectURL(pngBlob);
        Object.assign(document.createElement("a"), { href: dl, download: `radar_${report.label.replace(/[\s\/]/g, "_")}_${Date.now()}.png` }).click();
        URL.revokeObjectURL(dl);
        showToast("PNG を保存しました");
      }, "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); showToast("PNG 変換エラー", "error"); };
    img.src = url;
  };

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
        <div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: C.text, marginBottom: "4px" }}>{report.label}</div>
          <div style={{ fontSize: "11px", color: C.muted }}>{new Date(report.createdAt).toLocaleString("ja-JP")}</div>
        </div>
        <button onClick={handleScreenshot} disabled={!radarData}
          style={{ padding: "8px 18px", background: radarData ? "#1e3a5f" : C.border, color: radarData ? "#7dd3fc" : C.muted, border: `1px solid ${radarData ? "#1d4ed8" : C.border}`, borderRadius: "6px", cursor: radarData ? "pointer" : "not-allowed", fontSize: "12px", fontFamily: "inherit" }}>
          PNG 保存
        </button>
      </div>

      {!radarData ? (
        <div style={{ background: "#422006", border: "1px solid #92400e", borderRadius: "8px", padding: "16px", color: "#fde68a", fontSize: "12px" }}>
          このログにはレーダーデータがありません。入力タブから再評価すると5軸スコアが追加されます。
        </div>
      ) : (
        <>
          <div ref={radarRef} style={{ width: "100%", height: "400px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={chartData} margin={{ top: 24, right: 48, bottom: 24, left: 48 }}>
                <PolarGrid stroke="#30363d" />
                <PolarAngleAxis dataKey="axis" tick={{ fill: "#8b949e", fontSize: 12, fontFamily: "monospace" }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tickCount={6} tick={{ fill: "#8b949e", fontSize: 10 }} stroke="#30363d" />
                <Radar name={mA} dataKey={mA} stroke="#2563eb" fill="#2563eb" fillOpacity={0.25} strokeWidth={2} dot={{ fill: "#2563eb", r: 3 }} />
                <Radar name={mB} dataKey={mB} stroke="#22c55e" fill="#22c55e" fillOpacity={0.25} strokeWidth={2} dot={{ fill: "#22c55e", r: 3 }} />
                <Legend wrapperStyle={{ fontSize: "12px", fontFamily: "monospace", color: "#8b949e", paddingTop: "12px" }} />
                <Tooltip contentStyle={{ background: "#1c2128", border: "1px solid #30363d", borderRadius: "6px", fontSize: "12px", fontFamily: "monospace" }} labelStyle={{ color: "#e6edf3", fontWeight: 600 }} formatter={(v, name) => [`${v}`, name]} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ marginTop: "20px" }}>
            <SectionTitle C={C}>スコア詳細</SectionTitle>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#1e3a5f" }}>
                  {["工程", mA, mB, "差分"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#7dd3fc", fontWeight: 600, fontSize: "12px", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RADAR_AXES.map((ax, i) => {
                  const va = radarData.model_a?.[ax] ?? 0;
                  const vb = radarData.model_b?.[ax] ?? 0;
                  const diff = va - vb;
                  return (
                    <tr key={ax} style={{ background: i % 2 === 0 ? C.card : "transparent" }}>
                      <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}`, color: C.muted, fontSize: "12px", whiteSpace: "nowrap" }}>{ax}</td>
                      <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}`, fontSize: "12px" }}><ScoreBar value={va} color="#2563eb" /></td>
                      <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}`, fontSize: "12px" }}><ScoreBar value={vb} color="#22c55e" /></td>
                      <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}`, fontSize: "12px", fontWeight: 600, color: diff > 0 ? "#7dd3fc" : diff < 0 ? "#86efac" : C.muted }}>
                        {diff > 0 ? `+${diff}` : diff === 0 ? "—" : diff}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ScoreBar({ value, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div style={{ flex: 1, height: "6px", background: "#30363d", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", background: color, borderRadius: "3px" }} />
      </div>
      <span style={{ minWidth: "28px", textAlign: "right", fontSize: "12px", color: "#e6edf3" }}>{value}</span>
    </div>
  );
}

// ── Report Detail ──────────────────────────────────────────────────────
function ReportDetail({ report, C }) {
  const ev = report.evaluation;
  const mA = ev.compared_models?.[0] || "Model A";
  const mB = ev.compared_models?.[1] || "Model B";
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "24px" }}>
      <div style={{ marginBottom: "20px", paddingBottom: "16px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: "15px", fontWeight: 700, color: C.text, marginBottom: "6px" }}>{report.label}</div>
        <div style={{ display: "flex", gap: "16px", fontSize: "11px", color: C.muted, flexWrap: "wrap" }}>
          <span>{new Date(report.createdAt).toLocaleString("ja-JP")}</span>
          {ev.bundle       && <span>bundle: {ev.bundle}</span>}
          {ev.prompt_style && <span>style: {ev.prompt_style}</span>}
          {ev.suite_count  && <span>suites: {ev.suite_count}</span>}
        </div>
      </div>
      <div style={{ marginBottom: "20px" }}>
        <SectionTitle C={C}>定量評価</SectionTitle>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "12px", marginBottom: "12px", lineHeight: "1.7" }}>{ev.quantitative?.summary}</div>
        <div style={{ marginBottom: "12px" }}>
          <span style={{ color: C.muted, fontSize: "11px" }}>総合優位: </span>
          <span style={{ color: "#7dd3fc", fontWeight: 700 }}>{ev.quantitative?.overall_winner}</span>
        </div>
        {ev.quantitative?.metrics?.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#1e3a5f" }}>
                {["指標", mA, mB, "優位"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#7dd3fc", fontWeight: 600, fontSize: "12px", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ev.quantitative.metrics.map((m, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? C.card : "transparent" }}>
                  <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}`, color: C.muted, fontSize: "12px" }}>{m.name}</td>
                  <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}`, fontSize: "12px" }}>{m.model_a}</td>
                  <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}`, fontSize: "12px" }}>{m.model_b}</td>
                  <td style={{ padding: "7px 12px", borderBottom: `1px solid ${C.border}`, fontSize: "12px", color: "#7dd3fc", fontWeight: 600 }}>{m.winner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div>
        <SectionTitle C={C}>定性評価</SectionTitle>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "6px", padding: "12px", marginBottom: "12px", lineHeight: "1.7" }}>{ev.qualitative?.summary}</div>
        {ev.qualitative?.spec_coverage_note && (
          <div style={{ background: "#1e3a5f", border: "1px solid #1d4ed8", borderRadius: "6px", padding: "10px 12px", marginBottom: "12px", fontSize: "12px", color: "#93c5fd", lineHeight: "1.6" }}>
            <span style={{ fontWeight: 700 }}>仕様カバレッジ: </span>{ev.qualitative.spec_coverage_note}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
          <StrengthBox title={`${mA} の強み`} items={ev.qualitative?.model_a_strengths} bg="#1e3a5f" border="#1d4ed8" color="#93c5fd" C={C} />
          <StrengthBox title={`${mB} の強み`} items={ev.qualitative?.model_b_strengths} bg="#14532d" border="#166534" color="#86efac" C={C} />
        </div>
        {ev.qualitative?.risks?.length > 0 && (
          <div style={{ background: "#422006", border: "1px solid #92400e", borderRadius: "6px", padding: "12px", marginBottom: "10px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#fcd34d", marginBottom: "6px" }}>注意点</div>
            {ev.qualitative.risks.map((r, i) => <div key={i} style={{ color: "#fde68a", fontSize: "12px", marginBottom: "3px" }}>• {r}</div>)}
          </div>
        )}
        <div style={{ background: "#14532d", border: "1px solid #166534", borderRadius: "6px", padding: "12px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#86efac", marginBottom: "6px" }}>推奨</div>
          <div style={{ color: "#dcfce7", fontSize: "12px", lineHeight: "1.6" }}>{ev.qualitative?.recommendation}</div>
        </div>
      </div>
    </div>
  );
}

function StrengthBox({ title, items, bg, border, color, C }) {
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: "6px", padding: "12px" }}>
      <div style={{ fontSize: "11px", fontWeight: 700, color, marginBottom: "6px" }}>{title}</div>
      {items?.map((s, i) => <div key={i} style={{ color: C.text, fontSize: "12px", marginBottom: "3px" }}>• {s}</div>)}
    </div>
  );
}
