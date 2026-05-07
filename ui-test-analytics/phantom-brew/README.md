# Phantom Brew

Phantom Brew は、架空のオンラインコーヒーショップです。
メニュー閲覧、商品詳細、カート、チェックアウト、注文ステータス、注文履歴を備えています。

## セットアップ

```bash
npm install
npm run build
npm start
```

起動後、`http://localhost:3000` でアクセスできます。

## 開発モード

```bash
npm run dev
```

## 主なページ

### メニュー一覧

- URL: `/menu`
- 商品一覧をカード形式で表示します。
- カテゴリで絞り込みできます。
  - All
  - Coffee
  - Food
  - Sweets
- 価格順で並び替えできます。
  - Price: Low to High
  - Price: High to Low
- 商品名で検索できます。
- 各商品カードから商品詳細へ移動できます。
- 各商品カードの `Add to Cart` からカートに追加できます。

### 商品詳細

- URL: `/menu/:id`
- 商品名、説明、カテゴリ、価格、在庫数を表示します。
- サイズを選択できます。
  - S
  - M
  - L
- コーヒー商品ではオプションを選択できます。
  - Extra Shot
  - Oat Milk
  - Soy Milk
  - Whipped Cream
- 数量を変更できます。
- 選択中の内容に応じて合計価格を表示します。
- `Add to Cart` からカートに追加できます。

### カート

- URL: `/cart`
- カート内の商品を一覧表示します。
- 商品ごとに数量変更と削除ができます。
- 小計、税額、割引、合計金額を表示します。
- クーポンコードを入力して適用できます。
- `Proceed to Checkout` からチェックアウトへ進みます。

### チェックアウト

- URL: `/checkout`
- 配送先情報を入力します。
  - Name
  - Email
  - Address
  - Phone
- 支払い方法を選択します。
  - Credit Card
  - Cash on Delivery
- 注文内容のサマリーを確認できます。
- `Place Order` で注文を確定します。
- 注文完了後、注文ステータス画面へ移動します。

### 注文ステータス

- URL: `/orders/:id`
- 注文内容と現在のステータスを表示します。
- ステータスは次の順に進みます。
  - received
  - preparing
  - delivering
  - completed
- 予想残り時間を表示します。

### 注文履歴

- URL: `/orders`
- 過去の注文を一覧表示します。
- 注文ID、日付、商品数、合計金額、ステータスを確認できます。
- ページネーションで注文履歴を移動できます。
- 注文行をクリックすると注文ステータス画面へ移動します。

## 商品データ

|  ID | 商品名          | カテゴリ | S価格 | M価格 | L価格 |
| --: | --------------- | -------- | ----: | ----: | ----: |
|   1 | House Blend     | Coffee   |   320 |   380 |   450 |
|   2 | Espresso        | Coffee   |   280 |   340 |   400 |
|   3 | Cafe Latte      | Coffee   |   380 |   440 |   520 |
|   4 | Matcha Latte    | Coffee   |   420 |   480 |   560 |
|   5 | Croissant       | Food     |   280 |     - |     - |
|   6 | BLT Sandwich    | Food     |   520 |     - |     - |
|   7 | Cheese Cake     | Sweets   |   450 |     - |     - |
|   8 | Tiramisu        | Sweets   |   480 |     - |     - |
|   9 | Chocolate Scone | Sweets   |   320 |     - |     - |
|  10 | Cold Brew       | Coffee   |   350 |   410 |   490 |

## オプション

| オプション    | 追加料金 |
| ------------- | -------: |
| Extra Shot    |       80 |
| Oat Milk      |       50 |
| Soy Milk      |       50 |
| Whipped Cream |       60 |

## クーポンコード

| コード      | 内容                  |
| ----------- | --------------------- |
| `PHANTOM10` | 10%割引               |
| `BREW500`   | 1000円以上で500円割引 |

## 技術スタック

- TypeScript
- Express
- EJS
- sql.js
- express-session
