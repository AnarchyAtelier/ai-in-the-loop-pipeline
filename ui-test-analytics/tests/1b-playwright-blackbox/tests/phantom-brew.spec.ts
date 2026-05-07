import { expect, test, type Page } from '@playwright/test';

async function addDefaultHouseBlend(page: Page) {
  await page.goto('/menu/1');
  await page.getByRole('button', { name: 'Add to Cart' }).click();
}

async function addLargeHouseBlendWithExtraShot(page: Page) {
  await page.goto('/menu/1');
  await page.getByRole('button', { name: 'L ¥450' }).click();
  await page.getByRole('checkbox', { name: 'Extra Shot (+¥80)' }).check();
  await page.getByRole('button', { name: '+' }).click();
  await page.getByRole('button', { name: 'Add to Cart' }).click();
}

test.describe('Phantom Brew blackbox flows', () => {
  // Intent: Customers can discover products from the menu with the visible browse controls.
  test('lets customers browse, filter, search, and sort menu items', async ({ page }) => {
    await page.goto('/menu');

    await expect(page).toHaveTitle(/Phantom Brew/);
    await expect(page.getByRole('link', { name: /House Blend/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Cold Brew/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to Cart' })).toHaveCount(10);

    await page.getByRole('link', { name: 'Food', exact: true }).click();
    await expect(page.getByRole('link', { name: /Croissant/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /BLT Sandwich/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /House Blend/ })).toHaveCount(0);

    await page.goto('/menu');
    await page.getByRole('textbox', { name: 'Search products...' }).fill('Latte');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('link', { name: /Cafe Latte/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Matcha Latte/ })).toBeVisible();

    await page.goto('/menu');
    await page.getByRole('combobox', { name: 'Sort:' }).selectOption({ label: 'Price: Low to High' });
    await expect(page.locator('main').getByRole('link').filter({ hasText: /¥/ }).first()).toContainText(
      'Espresso'
    );
  });

  // Intent: Product details recalculate the selected coffee before adding it to the cart.
  test('customizes a coffee item and carries the selection into the cart', async ({ page }) => {
    await page.goto('/menu/1');

    await expect(page.getByRole('heading', { name: 'House Blend' })).toBeVisible();
    await expect(page.getByText('Our signature blend with notes of chocolate and caramel.')).toBeVisible();
    await expect(page.getByText('In stock: 100')).toBeVisible();
    await expect(page.locator('main')).toContainText('¥380');

    await page.getByRole('button', { name: 'L ¥450' }).click();
    await page.getByRole('checkbox', { name: 'Extra Shot (+¥80)' }).check();
    await page.getByRole('button', { name: '+' }).click();
    await expect(page.locator('main')).toContainText('¥1,060');

    await page.getByRole('button', { name: 'Add to Cart' }).click();
    await page.goto('/cart');

    await expect(page.getByRole('heading', { name: 'Your Cart' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'House Blend' })).toBeVisible();
    await expect(page.getByText('Size: L | Extra Shot')).toBeVisible();
    await expect(page.locator('main')).toContainText('¥1,166');
  });

  // Intent: Cart users can apply a visible coupon and still remove the item cleanly.
  test('applies a coupon and removes an item from the cart', async ({ page }) => {
    await addDefaultHouseBlend(page);
    await page.goto('/cart');

    await expect(page.getByRole('heading', { name: 'House Blend' })).toBeVisible();
    await expect(page.getByText('Size: M')).toBeVisible();
    await expect(page.locator('main')).toContainText('¥418');

    await page.getByRole('textbox', { name: 'Coupon code' }).fill('PHANTOM10');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Coupon applied successfully!')).toBeVisible();
    await expect(page.getByText('Discount (10% OFF)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Applied' })).toBeDisabled();

    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Your cart is empty.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse Menu' })).toBeVisible();
  });

  // Intent: A checkout submission creates an order status page and a matching history row.
  test('places an order and shows it in order history', async ({ page }) => {
    await addLargeHouseBlendWithExtraShot(page);
    await page.goto('/cart');
    await page.getByRole('link', { name: 'Proceed to Checkout' }).click();

    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Order Summary' })).toBeVisible();
    await expect(page.getByText('House Blend x2')).toBeVisible();

    await page.getByRole('textbox', { name: 'Name' }).fill('Blackbox Tester');
    await page.getByRole('textbox', { name: 'Email' }).fill('blackbox@example.com');
    await page.getByRole('textbox', { name: 'Address' }).fill('1 Brew Test Ave');
    await page.getByRole('textbox', { name: 'Phone' }).fill('09012345678');
    await page.getByRole('radio', { name: 'Cash on Delivery' }).check();

    await Promise.all([
      page.waitForURL(/\/orders\/[^/]+$/),
      page.getByRole('button', { name: 'Place Order' }).click()
    ]);

    const orderHeading = page.getByRole('heading', { name: /Order #/ });
    await expect(orderHeading).toBeVisible();
    await expect(page.getByText('Status:')).toBeVisible();
    await expect(page.getByText(/^received$/)).toBeVisible();
    await expect(page.getByText('Estimated: 15 min')).toBeVisible();
    await expect(page.getByText('House Blend (L) x2')).toBeVisible();
    await expect(page.locator('main')).toContainText('¥1,166');

    const orderText = (await orderHeading.textContent()) ?? '';
    const orderId = orderText.replace('Order #', '').trim();
    expect(orderId).not.toBe('');

    await page.goto('/orders');
    await expect(page.getByRole('heading', { name: 'Order History' })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`#${orderId}`) })).toBeVisible();
  });
});
