import { expect, test, type Page } from '@playwright/test';

async function addHouseBlendFromDetail(page: Page) {
  await page.goto('/menu/1');
  await page.getByRole('button', { name: 'Add to Cart' }).click();
  await expect(page.locator('#cart-badge')).toHaveText('1');
}

test.describe('Phantom Brew 白箱フロー', () => {
  // Intent: Verify menu discovery features that a shopper uses before choosing an item.
  test('メニューで閲覧・絞り込み・検索・価格順ソートができる', async ({ page }) => {
    await page.goto('/menu');

    await expect(page.getByRole('link', { name: 'Phantom Brew', exact: true })).toBeVisible();
    await expect(page.locator('.product-card')).toHaveCount(10);
    await expect(page.getByRole('heading', { name: 'House Blend' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cold Brew' })).toBeVisible();

    await page.getByRole('link', { name: 'Food', exact: true }).click();
    await expect(page).toHaveURL(/category=Food/);
    await expect(page.locator('.product-card')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: 'Croissant' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'BLT Sandwich' })).toBeVisible();

    await page.goto('/menu');
    await page.getByPlaceholder('Search products...').fill('Latte');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.locator('.product-card')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: 'Cafe Latte' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Matcha Latte' })).toBeVisible();

    await page.goto('/menu');
    await page.selectOption('#sort-select', 'price_asc');
    await expect(page).toHaveURL(/sort=price_asc/);
    await expect(page.locator('.product-card .product-price').first()).toContainText('¥280');
  });

  // Intent: Verify product detail customization updates the displayed purchase total.
  test('商品詳細でサイズ・オプション・数量から合計金額を再計算する', async ({ page }) => {
    await page.goto('/menu/1');

    await expect(page.getByRole('heading', { name: 'House Blend' })).toBeVisible();
    await expect(page.locator('#total-price')).toHaveText('¥380');

    await page.getByRole('button', { name: 'L ¥450' }).click();
    await page.getByLabel('Extra Shot (+¥80)').check();
    await page.getByRole('button', { name: '+' }).click();

    await expect(page.locator('#qty-display')).toHaveText('2');
    await expect(page.locator('#total-price')).toHaveText('¥1,060');
  });

  // Intent: Verify cart line items can be reviewed, changed, and removed.
  test('カートで追加商品を確認し数量変更と削除ができる', async ({ page }) => {
    await addHouseBlendFromDetail(page);
    await page.goto('/cart');

    await expect(page.getByRole('heading', { name: 'Your Cart' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'House Blend' })).toBeVisible();
    await expect(page.getByText('Size: M')).toBeVisible();
    await expect(page.locator('#cart-total')).toHaveText('¥418');

    await page.getByRole('button', { name: '+' }).click();
    await expect(page.locator('.qty-value')).toHaveText('2');
    await expect(page.locator('#cart-total')).toHaveText('¥836');

    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Your cart is empty.')).toBeVisible();
  });

  // Intent: Verify a valid coupon changes the cart total shown to the shopper.
  test('カートでクーポンを適用すると注文合計に割引が反映される', async ({ page }) => {
    await addHouseBlendFromDetail(page);
    await page.goto('/cart');

    await page.getByPlaceholder('Coupon code').fill('PHANTOM10');
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page.locator('#coupon-message')).toHaveText('Coupon applied successfully!');
    await expect(page.locator('#discount-line')).toContainText('10% OFF');
    await expect(page.locator('#cart-total')).toHaveText('¥380');
  });

  // Intent: Verify checkout creates an order and the order appears in history.
  test('注文後にステータスページと注文履歴へ反映される', async ({ page }) => {
    await addHouseBlendFromDetail(page);
    await page.goto('/checkout');

    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
    await expect(page.getByText('House Blend x1')).toBeVisible();
    await expect(page.locator('.order-summary')).toContainText('¥418');

    await page.getByLabel('Name').fill('Test User');
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Address').fill('1 Test Street');
    await page.getByLabel('Phone').fill('090-0000-0000');
    await page.getByLabel('Cash on Delivery').check();
    await expect(page.locator('#credit-card-section')).toBeHidden();

    await page.getByRole('button', { name: 'Place Order' }).click();
    await expect(page).toHaveURL(/\/orders\/[A-Z0-9]{8}$/);

    const orderId = page.url().split('/').pop() ?? '';
    expect(orderId).toMatch(/^[A-Z0-9]{8}$/);

    await expect(page.getByRole('heading', { name: `Order #${orderId}` })).toBeVisible();
    await expect(page.getByText('House Blend (M) x1')).toBeVisible();
    await expect(page.locator('#current-status')).toHaveText(/received|preparing|delivering|completed/);

    await page.goto('/orders');
    const orderRow = page.locator(`a.table-row[href="/orders/${orderId}"]`);
    await expect(orderRow).toBeVisible();
    await expect(orderRow).toContainText('1 items');
    await expect(orderRow).toContainText('¥418');
  });
});
