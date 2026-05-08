# ui-test-analytics

Playwright の UI テスト結果を Jenkins 上で実行し、JUnit XML を CSV 化、差分分類、LLM トリアージ、Evalite 評価まで流すための検証用プロジェクトです。

## Pipeline

Jenkinsfile は `jenkins/jobs/` 配下に分割しています。統合ジョブのステージ構成は次の通りです。

```text
1a-playwright-whitebox -> 1b-playwright-blackbox -> 1c-playwright-naive -> 2-parse-and-triage -> 3-evalite -> 4-aggregate
```

ルートの npm script は実装済みです。`test:e2e` は `E2E_SUITES` で指定した Playwright スイートを実行し、JUnit XML を `results/test-result-*.xml` に分けて出力します。Jenkins では `1a-playwright-whitebox` が `whitebox`、`1b-playwright-blackbox` が `blackbox`、`1c-playwright-naive` が `naive` を実行します。

```json
{
  "scripts": {
    "test:e2e": "tsx pipeline/playwright/run-suites.ts",
    "pipeline:parse": "tsx pipeline/parser/index.ts",
    "pipeline:diff": "tsx pipeline/diff/index.ts",
    "pipeline:false-negatives": "tsx pipeline/false-negatives/index.ts",
    "pipeline:triage": "tsx pipeline/triage/index.ts",
    "pipeline:advisor": "tsx pipeline/advisor/index.ts",
    "pipeline:aggregate": "npm run pipeline:advisor && tsx pipeline/aggregate/index.ts",
    "pipeline:eval": "tsx pipeline/eval/index.ts",
    "artifacts:normalize-run": "tsx pipeline/artifacts/normalize-run.ts"
  }
}
```

## Build Artifacts

Jenkins の `results/*.csv` は追記型なので、記事用・ダッシュボード用のスナップショットを作る場合は対象 run だけを `build-artifacts/<n>/` にコピーし、必要に応じて run id を正規化します。

```powershell
npx tsx pipeline/artifacts/normalize-run.ts --artifacts-dir=build-artifacts/1st --from-run=pipeline-5 --to-run=pipeline-1
```

## AIトリアージ

AIトリアージは OpenAI Responses API を使い、既定モデルは `gpt-5.4` です。Jenkins やローカル実行でモデルを明示的に固定したい場合は `OPENAI_MODEL` で上書きできます。

```powershell
$env:OPENAI_MODEL = 'gpt-5.4'
npm run pipeline:triage
```

## Local Jenkins

```powershell
cd ui-test-analytics\jenkins
docker compose up -d --build
docker exec ui-test-analytics-jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

Jenkins は <http://127.0.0.1:8080> で起動します。`localhost:8080` で別の Jenkins が表示される場合があるため、このプロジェクトでは `127.0.0.1:8080` を使います。Pipeline job を作成する場合は、SCM の Script Path に `ai-in-the-loop-pipeline/ui-test-analytics/jenkins/jobs/<job-name>.Jenkinsfile` を指定してください。

Compose では Phantom Brew も `phantom-brew:3000` として起動します。Jenkins 側は `BASE_URL=http://phantom-brew:3000` と `PLAYWRIGHT_SKIP_WEBSERVER=1` を使い、Playwright config 内の webServer 起動をスキップします。

OpenAI API キーは Jenkins の Secret text credential として登録し、credential ID を `openai-api-key` にします。Jenkinsfile は `triage` ステージ内だけで `OPENAI_API_KEY` として注入します。
