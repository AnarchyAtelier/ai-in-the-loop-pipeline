import { test, expect } from '@playwright/test';

// ============================================================
// 1c-naive: カートテスト
// 「表示が変わったからOK」「メッセージが出たからOK」の甘いテスト。
// ============================================================

test.describe('カートページ', () => {

  test.beforeEach(async ({ page }) => {
    // 毎テスト前にカートをクリア（新しいセッション）
    await page.goto('/menu');
    await page.waitForTimeout(500);
  });

  test('商品をカートに追加するとバッジが更新される', async ({ page }) => {
    // FP-1: カート追加後すぐにバッジを確認。
    // 5%の確率でロールバックが走り、バッジが一瞬+1してから戻る。
    // 初心者は「追加したら+1」だけを確認する。

    await page.locator('.btn-add-cart').first().click();

    // すぐにバッジを確認（ロールバック前）
    await page.waitForTimeout(200);
    const badge = page.locator('#cart-badge');
    await expect(badge).toBeVisible();
    const text = await badge.textContent();
    expect(parseInt(text!)).toBeGreaterThan(0);
  });

  test('複数商品をカートに追加してバッジが正しい', async ({ page }) => {
    // FP-1: 3回追加で3回分ロールバックのチャンスがある
    for (let i = 0; i < 3; i++) {
      await page.locator('.btn-add-cart').nth(i).click();
      await page.waitForTimeout(200); // 短い待ち
    }

    const badge = page.locator('#cart-badge');
    const text = await badge.textContent();
    expect(parseInt(text!)).toBe(3); // FP-1で1つでもロールバックされたらFAIL
  });

  test('カートに商品が表示される', async ({ page }) => {
    // カートに追加してからカートページへ
    await page.locator('.btn-add-cart').first().click();
    await page.waitForTimeout(500);
    await page.goto('/cart');

    const items = page.locator('.cart-item');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
  });

  test('カートの合計金額が表示される', async ({ page }) => {
    // FN-1: 金額が「表示されている」ことだけ確認。厳密な金額は検証しない。
    // 商品ごとの税丸め誤差は見逃す。

    // 3商品追加（FN-1が発動しやすくなる）
    await page.goto('/menu/1'); // House Blend
    await page.locator('#add-to-cart-btn').click();
    await page.waitForTimeout(300);

    await page.goto('/menu/3'); // Cafe Latte
    await page.locator('#add-to-cart-btn').click();
    await page.waitForTimeout(300);

    await page.goto('/menu/7'); // Cheese Cake
    await page.locator('#add-to-cart-btn').click();
    await page.waitForTimeout(300);

    await page.goto('/cart');

    // 合計が「表示されている」ことだけ確認
    const total = page.locator('#cart-total');
    await expect(total).toBeVisible();
    const text = await total.textContent();
    expect(text).toMatch(/¥[\d,]+/);
    // FN-1: 正しい税額かどうかは検証しない → 丸め誤差を見逃す
  });

  test('数量の+ボタンで数量が増える', async ({ page }) => {
    // FN-5: 1回ずつ安定してクリック。競合状態は発生しない。
    await page.locator('.btn-add-cart').first().click();
    await page.waitForTimeout(500);
    await page.goto('/cart');

    // +を1回クリック
    const plusBtn = page.locator('.qty-btn:has-text("+")').first();
    await plusBtn.click();
    await page.waitForTimeout(500);
    await page.reload();

    const qty = await page.locator('.qty-value').first().textContent();
    expect(parseInt(qty!)).toBe(2);
    // FN-5: 連打しないので競合は起きない → バグを見逃す
  });

  test('数量の-ボタンで数量が減る', async ({ page }) => {
    await page.locator('.btn-add-cart').first().click();
    await page.waitForTimeout(500);
    await page.goto('/cart');

    // まず+で増やして
    await page.locator('.qty-btn:has-text("+")').first().click();
    await page.waitForTimeout(500);
    await page.reload();

    // -で戻す
    await page.locator('.qty-btn:has-text("-")').first().click();
    await page.waitForTimeout(500);
    await page.reload();

    const qty = await page.locator('.qty-value').first().textContent();
    expect(parseInt(qty!)).toBe(1);
  });

  test('商品を削除できる', async ({ page }) => {
    await page.locator('.btn-add-cart').first().click();
    await page.waitForTimeout(500);
    await page.goto('/cart');

    await page.locator('.btn-remove').first().click();
    await page.waitForTimeout(500);
    await page.reload();

    // カートが空になった
    await expect(page.locator('.empty-state')).toBeVisible();
  });

  test('クーポンを適用すると割引メッセージが表示される', async ({ page }) => {
    // FN-3: 「メッセージが表示された」ことだけ確認。
    // 合計金額が実際に減ったかは検証しない。

    await page.locator('.btn-add-cart').first().click();
    await page.waitForTimeout(500);
    await page.goto('/cart');

    await page.fill('#coupon-input', 'PHANTOM10');
    await page.click('#coupon-btn');

    // メッセージ確認だけ
    await expect(page.locator('#coupon-message')).toHaveText('Coupon applied successfully!');
    // FN-3: ここで合計が10%引きになっているかを確認すべきだが、しない
  });
});
