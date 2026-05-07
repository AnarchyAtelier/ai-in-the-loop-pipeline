import { test, expect } from '@playwright/test';

// ============================================================
// FALSE POSITIVE Ground Truth Tests
// これらのテストは「FAILすることが正解」。
// アプリのバグではなく、テスト環境・タイミング・設計上の意図的な不安定要素。
// AIトリアージはこれらを "flaky" or "environment_issue" と判定すべき。
// ============================================================

test.describe('FP-1: オプティミスティックUI + ロールバック', () => {
  // 罠: カート追加時、5%の確率でサーバーが在庫切れを返し、
  // UIが一度+1してからロールバックする。
  // テストが「追加成功」をアサートした直後にロールバックが走ると FAIL。
  // Ground Truth: flaky（アプリのバグではない）

  test('カート追加後にバッジ数が安定しない場合がある', async ({ page }) => {
    await page.goto('/menu');
    await page.waitForSelector('.product-card.animated', { timeout: 5000 });

    // カート追加前のバッジを取得
    const badgeBefore = await page.locator('#cart-badge').textContent().catch(() => '0');
    const countBefore = parseInt(badgeBefore || '0');

    // 商品を追加（20回試行して、5%のロールバックに当たる確率を上げる）
    for (let i = 0; i < 20; i++) {
      await page.goto('/menu');
      await page.waitForSelector('.product-card.animated', { timeout: 5000 });

      const addButton = page.locator('.btn-add-cart').first();
      await addButton.click();

      // 200ms待つ（ロールバックが走る前の瞬間）
      await page.waitForTimeout(100);
      const badgeText = await page.locator('#cart-badge').textContent().catch(() => '0');
      const currentCount = parseInt(badgeText || '0');

      // さらに500ms待ってロールバックが走るか確認
      await page.waitForTimeout(500);
      const afterText = await page.locator('#cart-badge').textContent().catch(() => '0');
      const afterCount = parseInt(afterText || '0');

      if (currentCount > afterCount) {
        // ロールバック発生を検知 → テストとしてはFAIL扱いにする
        expect(currentCount, 'FP-1: ロールバックによりカート数が減少した').toBe(afterCount);
        return; // 1回でも発生したら終了
      }
    }

    // 20回でロールバックが1回も起きなかった場合（確率的にありうる）
    // テストとしてはPASSするが、それは確率の問題
    expect(true).toBe(true);
  });
});

test.describe('FP-2: SSEステータス更新の非決定的タイミング', () => {
  // 罠: ステータス遷移がSSEで通知されるが、各ステータスの滞在時間が3〜30秒ランダム。
  // 「preparing」ステータスを確認しようとしても、一瞬で飛ばされることがある。
  // Ground Truth: flaky（タイミング依存であり、アプリのバグではない）

  test('「preparing」ステータスが表示されることを5秒以内に確認', async ({ page }) => {
    // まず注文を作る
    await page.goto('/menu');
    await page.waitForSelector('.product-card.animated', { timeout: 5000 });
    await page.locator('.btn-add-cart').first().click();
    await page.waitForTimeout(300);

    await page.goto('/cart');
    await page.locator('a[href="/checkout"]').click();
    await page.waitForURL('/checkout');

    await page.fill('#customer-name', 'Test User');
    await page.fill('#customer-email', 'test@example.com');
    await page.fill('#customer-address', '123 Test Street');
    await page.fill('#customer-phone', '090-0000-0000');

    // 注文確定
    await page.locator('#place-order-btn').click();
    await page.waitForURL(/\/orders\//);

    // 「preparing」が5秒以内に表示されることを確認
    // FP-2: ステータスの遷移間隔が3〜30秒ランダムなので、
    // 「received」のまま5秒経過する可能性がある
    const preparingStep = page.locator('.status-step[data-step="preparing"].active');
    await expect(preparingStep).toBeVisible({ timeout: 5000 });
  });
});

test.describe('FP-3: A/Bテストによるレイアウト変動', () => {
  // 罠: チェックアウトページのフォームが50%の確率で2カラム or 1カラム。
  // 2カラム版の .form-row セレクタで書いたテストが、1カラム版に当たるとFAIL。
  // Ground Truth: flaky（A/Bテストは意図的な設計であり、バグではない）

  test('チェックアウトの form-row 要素が存在する', async ({ page }) => {
    // カートに商品を追加してチェックアウトへ
    await page.goto('/menu');
    await page.waitForSelector('.product-card.animated', { timeout: 5000 });
    await page.locator('.btn-add-cart').first().click();
    await page.waitForTimeout(300);
    await page.goto('/checkout');

    // variant-A（2カラム）固有のセレクタで検証
    // variant-B（1カラム）に当たるとこの要素は存在しない → FAIL
    const formRow = page.locator('.checkout-form .form-row');
    await expect(formRow.first()).toBeVisible({ timeout: 3000 });
  });
});

test.describe('FP-4: レート制限', () => {
  // 罠: 10秒間に20リクエスト超過で429を返す。
  // テストスイートを高速実行すると引っかかる。
  // Ground Truth: environment_issue（アプリの正常な防御機構）

  test('短時間に大量リクエストを送ると429が返る', async ({ page }) => {
    await page.goto('/menu');

    // 25回連続でAPIを叩く
    const responses: number[] = [];
    for (let i = 0; i < 25; i++) {
      const res = await page.evaluate(async () => {
        const r = await fetch('/cart/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: 1, size: 'M', options: [], quantity: 1 }),
        });
        return r.status;
      });
      responses.push(res);
    }

    // 429が含まれていることを確認
    // FP-4: テストが高速実行される環境では429が発生するが、これはバグではない
    const has429 = responses.includes(429);
    expect(has429, 'FP-4: レート制限による429が発生すべき').toBe(true);
  });
});

test.describe('FP-5: CSSアニメーション中のpointer-events:none', () => {
  // 罠: 商品カードがフェードインアニメーション中は pointer-events: none。
  // Playwrightが「表示された」と判断してクリックしても効かない。
  // Ground Truth: flaky（アニメーション設計であり、バグではない）

  test('ページ読み込み直後にカードをクリックできる', async ({ page }) => {
    await page.goto('/menu');

    // アニメーション完了を待たずに即座にクリック
    const firstCard = page.locator('.product-card .card-link').first();

    // waitForの代わりに短い固定待機で、アニメーション途中を狙う
    await page.waitForTimeout(50);

    await firstCard.click({ timeout: 1000 });

    // 商品詳細ページに遷移したか確認
    await expect(page).toHaveURL(/\/menu\/\d+/, { timeout: 2000 });
  });
});

test.describe('FP-6: コールドスタート遅延', () => {
  // 罠: サーバー起動後の最初の5リクエストは3〜5倍遅い。
  // CIでサーバー起動直後にテストが走ると、最初の数テストだけタイムアウト。
  // Ground Truth: environment_issue（DB接続プールのウォームアップ）
  // 注: このテストはサーバーを再起動した直後にのみ意味がある。
  // 通常のテスト実行では既にウォームアップ済みでPASSする。

  test('サーバー起動直後のレスポンスが2秒以内に返る', async ({ page }) => {
    // このテストはサーバー再起動直後に実行された場合のみFAILする
    // FP-6: 最初の5リクエストは3秒の遅延が入るため、2秒タイムアウトでは間に合わない
    const start = Date.now();
    await page.goto('/menu', { timeout: 2000 });
    const elapsed = Date.now() - start;

    expect(elapsed, 'FP-6: レスポンスが2秒以内であるべき').toBeLessThan(2000);
  });
});
