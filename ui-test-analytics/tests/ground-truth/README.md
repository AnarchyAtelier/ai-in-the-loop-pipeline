# Ground Truth テストスイート

Phantom Brew に仕込まれた12個の罠（偽陽性6 + 偽陰性6）に対応するGround Truthテスト。

## 目的

AIトリアージの精度を Evalite で評価するための正解ラベルを確定する。

- **FPテスト**: アプリのバグではない不安定要素を意図的に踏む。FAILすることが正解。
- **FNテスト**: アプリの実バグを厳密に検証する。バグを検知してFAILすることが正解。

## テスト一覧

| ID   | 種別 | テスト内容                                   | 期待結果 |
|------|------|----------------------------------------------|----------|
| FP-1 | 偽陽性 | オプティミスティックUI + ロールバック         | FAIL（確率的） |
| FP-2 | 偽陽性 | SSEステータス更新の非決定的タイミング         | FAIL（確率的） |
| FP-3 | 偽陽性 | A/Bテストによるレイアウト変動                 | FAIL（50%） |
| FP-4 | 偽陽性 | レート制限                                   | PASS（429検知に成功） |
| FP-5 | 偽陽性 | CSSアニメーション中のpointer-events:none      | FAIL（タイミング依存） |
| FP-6 | 偽陽性 | コールドスタート遅延                         | FAIL（起動直後のみ） |
| FN-1 | 偽陰性 | 税計算の丸め誤差                             | FAIL（バグ検知） |
| FN-2 | 偽陰性 | ソート後のリンク先不整合                     | FAIL（バグ検知） |
| FN-3 | 偽陰性 | クーポン適用UIの欺き                         | FAIL（バグ検知） |
| FN-4 | 偽陰性 | ページネーション境界バグ                     | FAIL（バグ検知） |
| FN-5 | 偽陰性 | 数量ボタン連打の競合状態                     | FAIL（バグ検知） |
| FN-6 | 偽陰性 | サーバー側メールバリデーション欠如            | FAIL（バグ検知） |

## 実行方法

```bash
# Phantom Brew が localhost:3000 で起動している状態で
npm install
npx playwright install chromium
npm test

# 偽陽性テストのみ
npm run test:fp

# 偽陰性テストのみ
npm run test:fn
```

## ground-truth-labels.json

Evalite評価で使用する正解ラベルデータ。
各テストに対して、AIトリアージが出すべき正しい判定を定義している。

## ラベル運用

`ground-truth-labels.json` は、テスト設計時に意図的に仕込んだ罠の正解ラベルを置く。Evalite では `label_source: designed` として扱われ、既定でメトリクスに含まれる。設計時点の仮説が実ログと食い違った場合は、FP-4 のように実エラーログを優先してこのファイルを修正する。

`observed-labels.json` は、パイプラインを回す中で後から観測した失敗パターンのラベルを置く。Evalite では `label_source: observed` として扱われる。確信が固まるまでは `status: provisional` と `confidence_required: 3` を付け、通常の評価メトリクスから除外する。暫定ラベルを含めて確認したい場合だけ、`EVAL_INCLUDE_PROVISIONAL_LABELS=1` を指定するか、`pipeline/eval/index.ts` に `--include-provisional-labels` を渡す。

`provisional` から `confirmed` へ昇格できる条件は、同じテストケース・同じ失敗モード・同じ推定原因が `confidence_required` 回数以上の独立した run で再現し、テストログまたはトレースでアプリ本体の既知バグではないことを確認できた場合とする。昇格時は `status: confirmed` に変更し、`notes` に確認した run と判断理由を残す。

## 注意事項

- FP-1, FP-2, FP-3, FP-5 は確率的にPASSすることがある（罠が発火しなかった場合）
- FP-6 はサーバー再起動直後にのみ有効
- FN-4 は10件の注文を作成するため、実行に時間がかかる
- FN-5 は実行環境の速度に依存する
