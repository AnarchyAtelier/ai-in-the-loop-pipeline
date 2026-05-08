# ai-in-the-loop-pipeline

既存のテスト自動化・セキュリティ検証パイプラインに AI 層を組み込み、判定・分類・トリアージを構造の中に位置づけるプロジェクト群。

AI を「万能な答え」としてではなく、設計されたパイプラインの中の構成要素として扱う。
どこを AI に任せ、どこを構造やルールで受け止めるか。その境界を実験と数字で確かめていく。

このリポジトリは [AnarchyAtelier](https://qiita.com/AnarchyAtelier) の技術探求の実装置き場にあたる。
活動の背景と方針は[こちら](https://qiita.com/AnarchyAtelier/private/167f0e8f6c8c991082a6)。

---

## プロジェクト

### ui-test-analytics

Playwright + Jenkins + LLM トリアージ + Evalite を1本のパイプラインにして、UIテストの偽陽性・偽陰性をAIでトリアージし、その精度を定量評価する。

罠を仕込んだサンプルアプリ（Phantom Brew）に対して、コンテキストの異なる3系統のテストスイートをAIに書かせ、結果の違いを観測する。

- 記事: [AIに書かせたテストの偽陽性と偽陰性を、AIでトリアージしてEvaliteで測った](https://qiita.com/AnarchyAtelier/items/daf4a0a466cc7f7ba427)
- コード: [ui-test-analytics/](./ui-test-analytics/)

---

## 共通する設計方針

- AI はパイプラインの構成要素。入力と出力を明確にし、判定結果を後段で検証可能にする
- 評価は定量的に行う。「なんとなく良い」ではなく、accuracy / detection rate を CSV に蓄積して追跡する
- Ground Truth は完成形ではなく、パイプラインを回す中で観測ベースで補正していく対象として扱う
- 無料枠・OSS・ローカル環境でどこまで構築できるかを基本方針とする
