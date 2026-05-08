# ローカル Jenkins

このディレクトリは、`ui-test-analytics` 用のローカル Jenkins 環境です。

## 構成

- Jenkins LTS controller
- Java 21 / Node.js 22
- Playwright Chromium 実行環境
- Phantom Brew サンプルアプリ（`phantom-brew:3000`）
- Pipeline / Git / JUnit / Credentials Binding plugins
- built-in executor への `playwright` / `nodejs` / `linux` ラベル設定
- `../results` から `/var/jenkins_results` への結果永続化マウント

## 起動

```powershell
cd ui-test-analytics\jenkins
docker compose up -d --build
docker exec ui-test-analytics-jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

Jenkins は <http://127.0.0.1:8080> で開けます。表示された初期パスワードでセットアップを進めてください。

`localhost:8080` で別の Jenkins が表示される場合があります。その場合は IPv6 側の `::1` に既存環境が割り当たっている可能性があるため、このプロジェクトでは `127.0.0.1:8080` を使います。

## ジョブ構成

Jenkins 上では、まず `ui-test-analytics` フォルダを作成し、その中に段階別の Pipeline job を置きます。

```text
ui-test-analytics/
  pipeline              -> ai-in-the-loop-pipeline/ui-test-analytics/jenkins/jobs/pipeline.Jenkinsfile
  1a-playwright-whitebox -> ai-in-the-loop-pipeline/ui-test-analytics/jenkins/jobs/1a-playwright-whitebox.Jenkinsfile
  1b-playwright-blackbox -> ai-in-the-loop-pipeline/ui-test-analytics/jenkins/jobs/1b-playwright-blackbox.Jenkinsfile
  1c-playwright-naive   -> ai-in-the-loop-pipeline/ui-test-analytics/jenkins/jobs/1c-playwright-naive.Jenkinsfile
  2-parse-and-triage    -> ai-in-the-loop-pipeline/ui-test-analytics/jenkins/jobs/2-parse-and-triage.Jenkinsfile
  3-evalite             -> ai-in-the-loop-pipeline/ui-test-analytics/jenkins/jobs/3-evalite.Jenkinsfile
  4-aggregate           -> ai-in-the-loop-pipeline/ui-test-analytics/jenkins/jobs/4-aggregate.Jenkinsfile
  5-dashboard-aggregate -> ai-in-the-loop-pipeline/ui-test-analytics/jenkins/jobs/5-dashboard-aggregate.Jenkinsfile
```

各ジョブの役割は次の通りです。

- `pipeline`: 全体を通す統合パイプライン
- `1a-playwright-whitebox`: whiteboxテスト実行と `test-result-whitebox.xml` 出力
- `1b-playwright-blackbox`: blackboxテスト実行と `test-result-blackbox.xml` 出力
- `1c-playwright-naive`: 初心者QA想定のnaiveテスト実行と `test-result-naive.xml` 出力
- `2-parse-and-triage`: XML パース、ラベリング、差分分類、偽陰性候補検出、AI トリアージ、CSV 出力
- `3-evalite`: Evalite 評価と `eval-results.csv` 出力
- `4-aggregate`: CSV 集約とダッシュボード用 JSON 生成
- `5-dashboard-aggregate`: 過去runの成果物を横断収集し、`build-artifacts/summary.json` と静的ダッシュボード一式を公開

## Pipeline Job 設定

Pipeline job を作成し、SCM checkout を使う場合は次のように設定します。

- Repository URL: `https://github.com/AnarchyAtelier/UnderControl.git`
- Branches to build: `*/main`
- Script Path: 上のジョブ構成に記載した Jenkinsfile path

このプロジェクトは `UnderControl` モノレポ内にあるため、Repository URL は `https://github.com/AnarchyAtelier/UnderControl.git`、Branches to build は `*/main`、Script Path は `ai-in-the-loop-pipeline/ui-test-analytics/...` から始まるパスを指定します。`*/master` のままだと `fatal: couldn't find remote ref refs/heads/master` で Jenkinsfile の読み込み前に失敗します。

GitHub リポジトリ作成前にローカル疎通確認をしたい場合は、Jenkins コンテナ内からこのリポジトリを参照できる形にして job を作成します。GitHub リポジトリ作成後は、GitHub URL を使う運用に寄せます。

`pipeline` ジョブは、同じ `ui-test-analytics` フォルダ内にある `1a-playwright-whitebox`、`1b-playwright-blackbox`、`1c-playwright-naive`、`2-parse-and-triage`、`3-evalite`、`4-aggregate` を順番に呼び出し、最後に `5-dashboard-aggregate` で横断ダッシュボードを更新します。各ジョブには `PIPELINE_RUN_ID` parameter があり、統合実行時は同じ run id で `/var/jenkins_results/runs/<run-id>/results/` を共有します。単独実行時は空欄のままで構いません。

Playwright系ジョブは、テスト失敗そのものを分析対象にするため、親 `pipeline` では downstream build の失敗を即停止扱いにしません。子ジョブが `FAILURE` / `UNSTABLE` でも、JUnit XML が出ていれば `2-parse-and-triage` 以降へ進めて解析します。

`5-dashboard-aggregate` は横断集約ジョブのため、親 `pipeline` からは `RUN_LIMIT=20`, `START_INDEX=1`, `CLEAN_OUTPUT=true` で呼び出します。ダッシュボード更新に失敗した場合、コアrun成果物は残したまま親ビルドを `UNSTABLE` として扱います。

## ダッシュボード横断集約ジョブ

`5-dashboard-aggregate` は、各runの最後に手作業で成果物をダウンロードする代わりに、Jenkins の永続結果ディレクトリを横断してダッシュボード用スナップショットを作ります。

```text
/var/jenkins_results/runs/<raw-run-id>/results/
  -> build-artifacts/1st〜Nth/
  -> build-artifacts/summary.json
  -> build-artifacts/run-map.json
  -> build-artifacts/dashboard/
```

Jenkins の build 番号や raw run id が飛んでも、集約ジョブは選択したrunを時系列に並べ、ダッシュボード用に `pipeline-1`, `pipeline-2`, ... と連番化します。対応関係は `build-artifacts/run-map.json` に残ります。

主なパラメータ:

- `RUN_LIMIT`: 取り込む過去run数。`0` で全件
- `START_INDEX`: ダッシュボード用の開始番号。通常は `1`
- `CLEAN_OUTPUT`: 既存の `build-artifacts/1st〜Nth`, `summary.json`, `run-map.json` を消して作り直す

ローカルで同じ処理を確認する場合:

```powershell
npx tsx pipeline/artifacts/collect-runs.ts --source-root=results/runs --output-root=build-artifacts --limit=20 --start-index=1 --clean-output
npx tsx pipeline/artifacts/summarize-runs.ts --artifacts-root=build-artifacts --output=build-artifacts/summary.json
New-Item -ItemType Directory -Force -Path build-artifacts/dashboard | Out-Null
Copy-Item dashboard/index.html,dashboard/styles.css,dashboard/charts.js build-artifacts/dashboard/
npx tsx pipeline/artifacts/write-dashboard-data.ts --summary=build-artifacts/summary.json --output=build-artifacts/dashboard/summary-data.js
```

Jenkins では `build-artifacts/**/*` が artifacts として保存されます。`build-artifacts/dashboard` のZIPには `summary-data.js` も同梱されるため、展開した `index.html` をそのまま開けます。

## API キー

OpenAI API キーは Jenkins の Secret text credential として登録します。

- Kind: `Secret text`
- ID: `openai-api-key`
- Secret: OpenAI API キー

Jenkinsfile は `triage` ステージ内だけ、この secret を `OPENAI_API_KEY` として注入します。`.env` や Compose の環境変数には API キーを置きません。

AIトリアージの既定モデルは `gpt-5.4` です。比較実験などで別モデルを使う場合だけ、Jenkins job の環境変数または実行コマンド側で `OPENAI_MODEL` を指定します。

## 結果ファイル

Jenkins は build artifacts として結果を保存します。あわせて、段階別ジョブ間で共有するために `results/` ディレクトリの内容を次のパスにもコピーします。

```text
ui-test-analytics/results/runs/<run-id>/results/
```

主な出力は次の通りです。

- `results/test-result-whitebox.xml`
- `results/test-result-blackbox.xml`
- `results/test-result-naive.xml`
- `results/test-results.csv`
- `results/diff-results.csv`
- `results/false-negative-candidates.csv`
- `results/triage-results.csv`
- `results/eval-results.csv`
- `results/action-summary.json`
- `results/dashboard-summary.json`
