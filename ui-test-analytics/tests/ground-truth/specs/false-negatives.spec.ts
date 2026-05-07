import { test, expect } from '@playwright/test';

// ============================================================
// FALSE NEGATIVE Ground Truth Tests
// これらのテストは「バグを検知する」テスト。
// アプリには実際のバグが存在するが、甘いテストでは見逃される。
// このGround Truthテストは厳密に書いてあるため、バグを検知してFAILする。
// AIトリアージはこれらを "real_bug" と判定すべき。
// ============================================================

test.describe('FN-1: 税計算の丸め誤差', () => {
  // 罠: 税額を商品ごとにMath.round()してから合算している。
  // 正しくは合算してからMath.round()すべき。
  // 3商品以上で端数が累積し、合計が1〜数円ずれる。
  // Ground Truth: real_bug

  test('3商品以上のカートで税額が正確に計算される', async ({ page }) => {
    // Espresso S(280) + Croissant(280) + Chocolate Scone(320) = 880
    // 正しい税額: Math.round(880 * 0.10) = 88
    // バグ税額: Math.round(280*0.10) + Math.round(280*0.10) + Math.round(320*0.10)
    //         = 28 + 28 + 32 = 88 (この組み合わせでは一致してしまう)

    // 別の組み合わせ: Espresso S(280) + Matcha Latte S(420) + Tiramisu(480) = 1180
    // 正しい税額: Math.round(1180 * 0.10) = 118
    // バグ税額: Math.round(280*0.10) + Math.round(420*0.10) + Math.round(480*0.10)
    //         = 28 + 42 + 48 = 118 (これも一致)

    // 端数が出る組み合わせ:
    // House Blend M(380) + Espresso M(340) + Cafe Latte M(440) + Croissant(280) + Cheese Cake(450)
    // = 1890
    // 正しい税額: Math.round(1890 * 0.10) = 189
    // バグ税額: Math.round(380*0.10) + Math.round(340*0.10) + Math.round(440*0.10) + Math.round(280*0.10) + Math.round(450*0.10)
    //         = 38 + 34 + 44 + 28 + 45 = 189 (端数なしで一致)

    // オプション追加で端数を作る:
    // Espresso S(280) + Extra Shot(80) = 360 → tax 36
    // Cafe Latte S(380) + Oat Milk(50) = 430 → tax 43
    // Matcha Latte S(420) + Whipped Cream(60) = 480 → tax 48
    // 合計: 1270, 正しい税額: 127, バグ税額: 36 + 43 + 48 = 127 (一致)

    // 5商品で強制的に端数を出す:
    // Espresso S(280) x1, Croissant(280) x1, Chocolate Scone(320) x1,
    // House Blend S(320) x1, Cold Brew S(350) x1
    // 合計: 1550, 正しい税額: 155
    // バグ税額: 28 + 28 + 32 + 32 + 35 = 155 (端数なし...)

    // 実は10%は端数が出にくい。量を増やす:
    // Espresso S(280) x 3 = 840 → Math.round(840*0.1) = 84
    // Croissant(280) x 3 = 840 → Math.round(840*0.1) = 84
    // Cheese Cake(450) x 3 = 1350 → Math.round(1350*0.1) = 135
    // 合計: 3030, 正しい税額: 303, バグ: 84+84+135 = 303 (一致)

    // 端数テスト: 奇数価格の商品を複数 + オプションで奇数金額を作る
    // Espresso S(280) + Extra Shot(80) + Soy Milk(50) = 410, qty 1 → tax: Math.round(410*0.1) = 41
    // Cafe Latte S(380) + Oat Milk(50) + Whipped Cream(60) = 490, qty 1 → tax: Math.round(490*0.1) = 49
    // Matcha Latte S(420) + Extra Shot(80) = 500, qty 1 → tax: Math.round(500*0.1) = 50
    // 合計: 1400, 正しい税額: 140, バグ: 41+49+50 = 140 (一致)

    // 10%税率では Math.round の差分が出にくい。
    // テスト方針を変更: 実際の表示値を取得して、合計から逆算した税額と比較する。
    // バグは「商品ごとにroundしてから合算」なので、
    // 正しい計算（合算してからround）と突き合わせる。

    await page.goto('/menu');
    await page.waitForSelector('.product-card.animated', { timeout: 5000 });

    // 複数商品をカートに追加（詳細ページ経由でオプション付き）
    // 商品1: Espresso(id=2) S + Extra Shot
    await page.goto('/menu/2');
    await page.locator('.size-btn[data-size="S"]').click();
    await page.locator('input[data-name="Extra Shot"]').check();
    await page.locator('#add-to-cart-btn').click();
    await page.waitForTimeout(500);

    // 商品2: Cafe Latte(id=3) S + Oat Milk + Whipped Cream
    await page.goto('/menu/3');
    await page.locator('.size-btn[data-size="S"]').click();
    await page.locator('input[data-name="Oat Milk"]').check();
    await page.locator('input[data-name="Whipped Cream"]').check();
    await page.locator('#add-to-cart-btn').click();
    await page.waitForTimeout(500);

    // 商品3: Matcha Latte(id=4) L + Soy Milk
    await page.goto('/menu/4');
    await page.locator('.size-btn[data-size="L"]').click();
    await page.locator('input[data-name="Soy Milk"]').check();
    await page.locator('#add-to-cart-btn').click();
    await page.waitForTimeout(500);

    // カートページで金額を検証
    await page.goto('/cart');

    const subtotalText = await page.locator('.summary-line:has-text("Subtotal") span:last-child').textContent();
    const taxText = await page.locator('.summary-line:has-text("Tax") span:last-child').textContent();

    const subtotal = parseInt(subtotalText!.replace(/[^\d]/g, ''));
    const displayedTax = parseInt(taxText!.replace(/[^\d]/g, ''));

    // 正しい税計算: 合算してからround
    const correctTax = Math.round(subtotal * 0.10);

    // FN-1: 商品ごとにroundしているため、差分が出る可能性がある
    // 差分が出た場合、このテストはFAILする = バグを検知
    expect(displayedTax, `FN-1: 税額が正確でない。表示: ${displayedTax}, 正しい値: ${correctTax}`).toBe(correctTax);
  });
});

test.describe('FN-2: ソート後のリンク先不整合', () => {
  // 罠: 価格ソートすると表示テキストは正しくソートされるが、
  // 各カードのリンク先は元の順序のまま。
  // Ground Truth: real_bug

  test('価格昇順ソート後、最初のカードのリンク先が表示商品と一致する', async ({ page }) => {
    await page.goto('/menu');
    await page.waitForSelector('.product-card.animated', { timeout: 5000 });

    // 価格昇順ソートを選択
    await page.selectOption('#sort-select', 'price_asc');
    await page.waitForTimeout(500);

    // ソート後の最初のカードの商品名を取得
    const firstName = await page.locator('.product-card').first().locator('.product-name').textContent();

    // そのカードをクリック
    await page.locator('.product-card').first().locator('.card-link').click();
    await page.waitForURL(/\/menu\/\d+/);

    // 遷移先の商品名を取得
    const detailName = await page.locator('.detail-info h1').textContent();

    // FN-2: ソート後のリンク先が元の順序のままなので、商品名が一致しない
    expect(detailName!.trim(), 'FN-2: ソート後のリンク先が表示商品と一致しない').toBe(firstName!.trim());
  });
});

test.describe('FN-3: クーポン適用UIの欺き', () => {
  // 罠: クーポンを適用すると「割引が適用されました」と表示されるが、
  // 合計金額は実際には変わらない。
  // Ground Truth: real_bug

  test('PHANTOM10クーポン適用で合計が10%割引される', async ({ page }) => {
    // カートに商品を追加
    await page.goto('/menu');
    await page.waitForSelector('.product-card.animated', { timeout: 5000 });

    // House Blend(id=1) を追加
    await page.goto('/menu/1');
    await page.locator('#add-to-cart-btn').click();
    await page.waitForTimeout(500);

    // Cafe Latte(id=3) を追加
    await page.goto('/menu/3');
    await page.locator('#add-to-cart-btn').click();
    await page.waitForTimeout(500);

    // カートページへ
    await page.goto('/cart');

    // クーポン適用前の合計を取得
    const totalBeforeText = await page.locator('#cart-total').textContent();
    const totalBefore = parseInt(totalBeforeText!.replace(/[^\d]/g, ''));

    // クーポン適用
    await page.fill('#coupon-input', 'PHANTOM10');
    await page.locator('#coupon-btn').click();
    await page.waitForTimeout(1000);

    // ページリロード後の合計を取得
    const totalAfterText = await page.locator('#cart-total').textContent();
    const totalAfter = parseInt(totalAfterText!.replace(/[^\d]/g, ''));

    // FN-3: 割引メッセージは表示されるが、合計金額は変わらない
    // 正しくは totalAfter < totalBefore であるべき
    expect(totalAfter, `FN-3: クーポン適用後も合計が変わっていない。適用前: ${totalBefore}, 適用後: ${totalAfter}`).toBeLessThan(totalBefore);
  });
});

test.describe('FN-4: ページネーション境界バグ', () => {
  // 罠: 注文数がちょうど10件のとき、空の2ページ目が存在する。
  // Ground Truth: real_bug

  test('ちょうど10件の注文でページネーションが正しく動作する', async ({ page }) => {
    // 10件の注文を作成
    for (let i = 0; i < 10; i++) {
      await page.goto('/menu');
      await page.waitForSelector('.product-card.animated', { timeout: 5000 });
      await page.locator('.btn-add-cart').first().click();
      await page.waitForTimeout(300);

      await page.goto('/checkout');
      await page.fill('#customer-name', `Test User ${i}`);
      await page.fill('#customer-email', `test${i}@example.com`);
      await page.fill('#customer-address', '123 Test Street');
      await page.fill('#customer-phone', '090-0000-0000');
      await page.locator('#place-order-btn').click();
      await page.waitForURL(/\/orders\//, { timeout: 10000 });
    }

    // 注文履歴ページへ
    await page.goto('/orders');

    // 10件表示されているか確認
    const rows = page.locator('.table-row');
    const rowCount = await rows.count();
    expect(rowCount).toBe(10);

    // FN-4: 「Next」ボタンが存在しないべき（ちょうど1ページ分）
    // バグ: totalPages が 2 になるため、Next ボタンが表示される
    const nextButton = page.locator('#next-page-btn');
    const hasNext = await nextButton.isVisible().catch(() => false);
    expect(hasNext, 'FN-4: ちょうど10件で不要なNextボタンが表示されている').toBe(false);
  });
});

test.describe('FN-5: 数量ボタン連打の競合状態', () => {
  // 罠: +ボタンを100ms以内に連続クリックすると、
  // サーバー側で競合が発生し、一部の更新が無視される。
  // Ground Truth: real_bug

  test('数量+ボタンを3回素早くクリックすると数量が4になる', async ({ page }) => {
    // カートに商品を追加
    await page.goto('/menu');
    await page.waitForSelector('.product-card.animated', { timeout: 5000 });
    await page.locator('.btn-add-cart').first().click();
    await page.waitForTimeout(500);

    // カートページへ
    await page.goto('/cart');

    // 初期数量は1
    const initialQty = await page.locator('.qty-value').first().textContent();
    expect(parseInt(initialQty!)).toBe(1);

    // +ボタンを素早く3回クリック（50ms間隔）
    const plusButton = page.locator('.qty-btn:has-text("+")').first();
    // page.click ではなく evaluate で直接DOMイベントを発火
    // リアルユーザーの高速クリックをシミュレート
    await page.evaluate(async () => {
      const btn = document.querySelector('.item-controls .qty-btn:last-of-type') as HTMLButtonElement;
      if (!btn) return;
      for (let i = 0; i < 3; i++) {
        btn.click();
        await new Promise(r => setTimeout(r, 50)); // 50ms間隔
      }
    });

    // リクエスト完了を待つ
    await page.waitForTimeout(1000);
    await page.reload();

    // 数量を確認
    const finalQty = await page.locator('.qty-value').first().textContent();
    const qty = parseInt(finalQty!);

    // FN-5: 競合状態により、3回クリックしても数量が4にならない場合がある
    expect(qty, `FN-5: 3回+クリック後の数量が${qty}。期待値: 4`).toBe(4);
  });
});

test.describe('FN-6: サーバー側メールバリデーション欠如', () => {
  // 罠: メールアドレスのバリデーションがフロントエンドのHTML5 type="email" のみ。
  // サーバー側では任意の文字列が受け入れられる。
  // Playwright の fill() は HTML5 バリデーションをバイパスする。
  // Ground Truth: real_bug

  test('不正なメールアドレスで注文するとサーバーがエラーを返す', async ({ page }) => {
    // カートに商品を追加
    await page.goto('/menu');
    await page.waitForSelector('.product-card.animated', { timeout: 5000 });
    await page.locator('.btn-add-cart').first().click();
    await page.waitForTimeout(500);

    // チェックアウトへ
    await page.goto('/checkout');

    // 不正なメールアドレスで送信
    await page.fill('#customer-name', 'Test User');
    await page.fill('#customer-email', 'not-an-email'); // 明らかに不正
    await page.fill('#customer-address', '123 Test Street');
    await page.fill('#customer-phone', '090-0000-0000');

    // APIを直接叩いて、サーバー側のバリデーションを確認
    const response = await page.evaluate(async () => {
      const res = await fetch('/checkout/place-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test User',
          email: 'not-an-email',
          address: '123 Test Street',
          phone: '090-0000-0000',
          paymentMethod: 'credit',
        }),
      });
      return { status: res.status, body: await res.json() };
    });

    // FN-6: サーバーはエラーを返すべきだが、実際には注文が成功してしまう
    expect(response.status, 'FN-6: 不正なメールで注文が成功してしまった').toBeGreaterThanOrEqual(400);
  });
});
