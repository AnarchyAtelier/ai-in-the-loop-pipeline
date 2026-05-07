import { test, expect } from '@playwright/test';

// ============================================================
// 1c-naive: メニュー・商品詳細テスト
// 初心者エンジニアが仕様書を見て素直に書いたテスト。
// 「表示されてるからOK」「動いたからOK」レベルのアサーション。
// ============================================================

test.describe('メニューページ', () => {

  test('商品一覧が表示される', async ({ page }) => {
    // FP-5: アニメーション完了を待たずにすぐ確認
    // 初心者はwaitForSelectorなど書かない
    await page.goto('/menu');
    const cards = page.locator('.product-card');
    await expect(cards.first()).toBeVisible();
    const count = await cards.count();
    expect(count).toBe(10); // 全10商品
  });

  test('カテゴリフィルターが動作する', async ({ page }) => {
    await page.goto('/menu');
    await page.click('.cat-btn:has-text("Coffee")');
    const cards = page.locator('.product-card');
    const count = await cards.count();
    // Coffeeは5商品
    expect(count).toBe(5);
  });

  test('価格で昇順ソートできる', async ({ page }) => {
    // FN-2: ソート後の表示順だけ確認。リンク先は見ない。
    await page.goto('/menu');
    await page.waitForTimeout(500);
    await page.selectOption('#sort-select', 'price_asc');
    await page.waitForTimeout(500);

    // 最初のカードが一番安い商品であること（表示テキストだけ確認）
    const firstPrice = await page.locator('.product-card').first().locator('.product-price').textContent();
    const secondPrice = await page.locator('.product-card').nth(1).locator('.product-price').textContent();

    const price1 = parseInt(firstPrice!.replace(/[^\d]/g, ''));
    const price2 = parseInt(secondPrice!.replace(/[^\d]/g, ''));

    // 表示順は正しい → PASS（でもリンク先は壊れている = FN-2見逃し）
    expect(price1).toBeLessThanOrEqual(price2);
  });

  test('ソート後に商品カードをクリックして詳細に遷移できる', async ({ page }) => {
    // FN-2: ソートしてからクリックするが、遷移先の商品名は確認しない
    await page.goto('/menu');
    await page.waitForTimeout(500);
    await page.selectOption('#sort-select', 'price_asc');
    await page.waitForTimeout(500);

    // 最初のカードをクリック
    await page.locator('.product-card .card-link').first().click();

    // 「詳細ページに遷移した」ことだけ確認。商品名の一致は見ない。
    await expect(page).toHaveURL(/\/menu\/\d+/);
    await expect(page.locator('.detail-info h1')).toBeVisible();
    // FN-2: ここで「ソート前の最初のカードの商品名 == 遷移先の商品名」を確認すべきだが、しない
  });

  test('商品カードのAdd to Cartボタンが動作する', async ({ page }) => {
    // FP-5: ページ読み込み直後にクリック → アニメーション中でpointer-events:noneかも
    await page.goto('/menu');

    // 初心者はアニメーション完了を意識しない
    const addButton = page.locator('.btn-add-cart').first();
    await addButton.click({ timeout: 3000 });

    // トーストが出たらOK
    await expect(page.locator('.toast')).toBeVisible({ timeout: 3000 });
  });

  test('検索で商品を絞り込める', async ({ page }) => {
    await page.goto('/menu');
    await page.fill('#search-input', 'Latte');
    await page.click('.search-bar button');

    const cards = page.locator('.product-card');
    const count = await cards.count();
    expect(count).toBe(2); // Cafe Latte + Matcha Latte
  });
});

test.describe('商品詳細ページ', () => {

  test('サイズ変更で価格が変わる', async ({ page }) => {
    await page.goto('/menu/1'); // House Blend
    await page.locator('.size-btn[data-size="L"]').click();

    const total = await page.locator('#total-price').textContent();
    expect(total).toContain('450');
  });

  test('オプションを選択すると価格に反映される', async ({ page }) => {
    await page.goto('/menu/2'); // Espresso
    // Mサイズ: 340 + Extra Shot(80) = 420
    await page.locator('input[data-name="Extra Shot"]').check();

    const total = await page.locator('#total-price').textContent();
    expect(total).toContain('420');
  });

  test('数量を変更すると合計に反映される', async ({ page }) => {
    await page.goto('/menu/1'); // House Blend M: 380
    await page.click('.qty-btn:has-text("+")');
    // 数量2: 380 * 2 = 760

    const total = await page.locator('#total-price').textContent();
    expect(total).toContain('760');
  });
});
