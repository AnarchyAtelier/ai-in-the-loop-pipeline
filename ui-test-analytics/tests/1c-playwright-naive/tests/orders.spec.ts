import { test, expect } from '@playwright/test';

// ============================================================
// 1c-naive: 注文ステータス・注文履歴テスト
// 「ステータスが変わった」「一覧に出てる」レベルの確認。
// ============================================================

test.describe('注文ステータスページ', () => {

  async function placeOrder(page: any): Promise<string> {
    await page.goto('/menu');
    await page.waitForTimeout(500);
    await page.locator('.btn-add-cart').first().click();
    await page.waitForTimeout(500);
    await page.goto('/checkout');

    await page.fill('#customer-name', 'テストユーザー');
    await page.fill('#customer-email', 'test@example.com');
    await page.fill('#customer-address', '東京都千代田区1-1');
    await page.fill('#customer-phone', '03-0000-0000');

    await page.click('#place-order-btn');
    await page.waitForURL(/\/orders\//, { timeout: 10000 });
    return page.url();
  }

  test('注文後にステータスページが表示される', async ({ page }) => {
    await placeOrder(page);

    await expect(page.locator('h1')).toContainText('Order #');
    await expect(page.locator('.status-bar')).toBeVisible();
  });

  test('ステータスが「received」で始まる', async ({ page }) => {
    await placeOrder(page);

    const status = page.locator('#current-status');
    await expect(status).toHaveText('received');
  });

  test('ステータスが「preparing」に進む', async ({ page }) => {
    // FP-2: SSEのステータス遷移間隔が3〜30秒ランダム。
    // 初心者は「5秒待てば進むだろう」と書くが、最大30秒かかる場合がある。
    await placeOrder(page);

    // 5秒待ってpreparingになっているか確認
    await page.waitForTimeout(5000);
    const status = await page.locator('#current-status').textContent();

    // FP-2: ランダム遅延で5秒以内にpreparingに進まない場合がある
    expect(status).toBe('preparing');
  });

  test('最終的にステータスが「completed」になる', async ({ page }) => {
    // FP-2: 全ステータス遷移の合計が最大90秒（30秒×3遷移）かかる可能性。
    // タイムアウト15秒ではほぼ間に合わない。
    await placeOrder(page);

    // completedになるまで待つ（タイムアウト15秒 = playwright.config.ts のデフォルト）
    await expect(page.locator('#current-status')).toHaveText('completed', { timeout: 15000 });
  });

  test('予想配達時間が表示される', async ({ page }) => {
    await placeOrder(page);

    const eta = page.locator('#eta-value');
    await expect(eta).toBeVisible();
    const text = await eta.textContent();
    expect(text).not.toBe('calculating...');
  });
});

test.describe('注文履歴ページ', () => {

  async function placeQuickOrder(page: any) {
    await page.goto('/menu');
    await page.waitForTimeout(300);
    await page.locator('.btn-add-cart').first().click();
    await page.waitForTimeout(300);
    await page.goto('/checkout');
    await page.fill('#customer-name', 'テスト');
    await page.fill('#customer-email', 'test@example.com');
    await page.fill('#customer-address', '東京都');
    await page.fill('#customer-phone', '000-0000-0000');
    await page.click('#place-order-btn');
    await page.waitForURL(/\/orders\//, { timeout: 10000 });
  }

  test('注文履歴に注文が表示される', async ({ page }) => {
    await placeQuickOrder(page);
    await page.goto('/orders');

    const rows = page.locator('.table-row');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('注文履歴の各行に必要な情報が表示される', async ({ page }) => {
    await placeQuickOrder(page);
    await page.goto('/orders');

    const firstRow = page.locator('.table-row').first();
    await expect(firstRow.locator('.order-id')).toBeVisible();
    await expect(firstRow.locator('.status-badge')).toBeVisible();
  });

  test('注文履歴からステータスページに遷移できる', async ({ page }) => {
    await placeQuickOrder(page);
    await page.goto('/orders');

    await page.locator('.table-row').first().click();
    await expect(page).toHaveURL(/\/orders\//);
    await expect(page.locator('h1')).toContainText('Order #');
  });

  test('ページネーションが正しく動作する', async ({ page }) => {
    // FN-4: 3件だけ作ってページネーションを確認。
    // 10件ちょうどの境界バグは踏まない。

    for (let i = 0; i < 3; i++) {
      await placeQuickOrder(page);
    }

    await page.goto('/orders');

    // 3件表示されている
    const rows = page.locator('.table-row');
    const count = await rows.count();
    expect(count).toBe(3);

    // 3件ではページネーションは不要なはず
    const pagination = page.locator('.pagination');
    const hasPagination = await pagination.isVisible().catch(() => false);
    expect(hasPagination).toBe(false);
    // FN-4: 10件ちょうどで空ページが出るバグは確認しない
  });
});

test.describe('レート制限テスト', () => {

  test('通常のページ遷移でエラーが出ない', async ({ page }) => {
    // FP-4: 並列テスト（workers: 3）で他のテストと同時に走ると、
    // レート制限に引っかかる可能性がある。
    // 初心者はレート制限の存在を知らないので、ただページ遷移するだけ。

    await page.goto('/menu');
    await expect(page.locator('h1, .product-card')).toBeVisible();

    await page.goto('/cart');
    // カートが空でもページ自体は表示される
    await expect(page.locator('h1')).toBeVisible();

    await page.goto('/orders');
    await expect(page.locator('h1')).toBeVisible();
  });
});
