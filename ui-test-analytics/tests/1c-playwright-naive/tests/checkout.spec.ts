import { test, expect } from '@playwright/test';

// ============================================================
// 1c-naive: チェックアウトテスト
// 「フォームが表示された」「注文できた」レベルの確認。
// ============================================================

test.describe('チェックアウトページ', () => {

  async function addItemAndGoToCheckout(page: any) {
    await page.goto('/menu');
    await page.waitForTimeout(500);
    await page.locator('.btn-add-cart').first().click();
    await page.waitForTimeout(500);
    await page.goto('/checkout');
  }

  test('チェックアウトページが表示される', async ({ page }) => {
    // FP-6: テストスイートの最初の方に配置されているため、
    // サーバー起動直後ならコールドスタート遅延で timeout する可能性あり
    await addItemAndGoToCheckout(page);
    await expect(page.locator('h1')).toHaveText('Checkout');
  });

  test('配送先フォームの全フィールドが表示される', async ({ page }) => {
    // FP-3: A/Bテストで2カラム版のセレクタで書いているため、
    // variant-B（1カラム）に当たるとform-rowが存在しない
    await addItemAndGoToCheckout(page);

    // 2カラムレイアウト前提で確認
    const formRow = page.locator('.form-row');
    await expect(formRow.first()).toBeVisible({ timeout: 3000 });

    // 各フィールドも確認
    await expect(page.locator('#customer-name')).toBeVisible();
    await expect(page.locator('#customer-email')).toBeVisible();
    await expect(page.locator('#customer-address')).toBeVisible();
    await expect(page.locator('#customer-phone')).toBeVisible();
  });

  test('支払い方法を選択できる', async ({ page }) => {
    await addItemAndGoToCheckout(page);

    // クレジットカードがデフォルトで選択されている
    const credit = page.locator('input[name="payment"][value="credit"]');
    await expect(credit).toBeChecked();

    // 代引きに切り替え
    await page.locator('input[name="payment"][value="cod"]').click();
    const cod = page.locator('input[name="payment"][value="cod"]');
    await expect(cod).toBeChecked();

    // カード入力セクションが非表示になる
    await expect(page.locator('#credit-card-section')).toBeHidden();
  });

  test('注文サマリーが表示される', async ({ page }) => {
    await addItemAndGoToCheckout(page);

    await expect(page.locator('.order-summary')).toBeVisible();
    await expect(page.locator('.summary-item')).toBeVisible();
  });

  test('正常な情報で注文を確定できる', async ({ page }) => {
    // FN-6: 正常なメールアドレスだけ使う。
    // 不正メールでの送信は試さない → サーバー側バリデーション欠如を見逃す。
    await addItemAndGoToCheckout(page);

    await page.fill('#customer-name', '田中太郎');
    await page.fill('#customer-email', 'tanaka@example.com'); // 正常なメール
    await page.fill('#customer-address', '東京都渋谷区1-1-1');
    await page.fill('#customer-phone', '03-1234-5678');

    await page.click('#place-order-btn');

    // 注文ステータスページに遷移したらOK
    await expect(page).toHaveURL(/\/orders\//, { timeout: 10000 });
    // FN-6: 不正メールでも通ることは確認しない
  });
});
