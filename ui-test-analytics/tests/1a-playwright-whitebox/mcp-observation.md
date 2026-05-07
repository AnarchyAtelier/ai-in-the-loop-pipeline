# MCP Observation

Date: 2026-05-06 JST

## Setup Notes

- First MCP action was `browser_navigate` to `http://localhost:3000/menu`, as requested.
- The first navigation returned `ERR_CONNECTION_REFUSED` because the app server was not running.
- The next MCP action was `browser_snapshot`; it captured the Chrome error page for localhost connection refusal.
- I then started Phantom Brew from `phantom-brew` with `TS_NODE_FILES=true` and `npm run dev` so the existing `src/types/sql.js.d.ts` file would be loaded by ts-node.
- After the server started, I used Playwright MCP to inspect `/menu`, `/menu/1`, `/cart`, `/checkout`, `/orders/0E2B572B`, and `/orders`.

## /menu

- Header shows `Phantom Brew` plus navigation links for Menu, Cart, and Orders.
- Menu controls include category links: All, Coffee, Food, Sweets.
- Sorting is available through a `Sort:` combobox with Default, Price: Low to High, and Price: High to Low.
- Search input uses placeholder `Search products...` and a `Search` button.
- The product grid showed 10 products: House Blend, Espresso, Cafe Latte, Matcha Latte, Croissant, BLT Sandwich, Cheese Cake, Tiramisu, Chocolate Scone, and Cold Brew.
- Each card links to `/menu/:id` and has an `Add to Cart` button.

## /menu/1

- Detail page showed House Blend with category Coffee and description text.
- Size buttons were S 320 yen, M 380 yen, and L 450 yen, with M as the default total.
- Coffee options were visible as checkboxes: Extra Shot, Oat Milk, Soy Milk, and Whipped Cream.
- Quantity controls used `-` and `+`, total price was shown, stock displayed `In stock: 100`, and there was an `Add to Cart` button.
- Clicking `Add to Cart` showed an `Added to cart!` toast and updated the cart badge to 1.

## /cart

- Cart page showed `Your Cart`.
- The added House Blend item appeared with size M, unit price 380 yen, quantity controls, subtotal 380 yen, and a Remove button.
- Summary showed subtotal 380 yen, tax 38 yen, and total 418 yen.
- Coupon input and Apply button were present.
- `Proceed to Checkout` linked to `/checkout`.

## /checkout

- Checkout page showed delivery fields for Name, Email, Address, and Phone.
- Payment method radios were Credit Card and Cash on Delivery.
- Credit card fields were Card Number, MM/YY, and CVC.
- Order Summary showed House Blend x1, subtotal 380 yen, tax 38 yen, total 418 yen, and a `Place Order` button.
- Filling the form and placing an order redirected to an order status URL.

## /orders/:id

- The created order status page showed `Order #0E2B572B`.
- Status steps were Received, Preparing, Delivering, and Completed.
- Current status initially appeared as `received`, with an ETA of 15 min from the SSE stream.
- Items showed House Blend (M) x1 and total 418 yen.

## /orders

- Order History page showed a table header: Order ID, Date, Items, Total, Status.
- The created order row linked to `/orders/0E2B572B`.
- The row displayed one item, total 418 yen, and status `received`.
