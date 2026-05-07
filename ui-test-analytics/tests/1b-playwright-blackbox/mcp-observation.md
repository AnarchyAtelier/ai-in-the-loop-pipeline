# MCP Observation

Scope read before implementation:

- Read only `UnderControl/ai-in-the-loop-pipeline/ui-test-analytics/phantom-brew/README.md`.
- Did not read application source files.

Playwright MCP sequence:

- First called `browser_navigate` for `http://localhost:3000/menu`; it initially returned `ERR_CONNECTION_REFUSED` because the app was not running.
- Started the app from the README dev command with runtime-only transpile mode after `npm run dev` failed on a missing `sql.js` type declaration.
- Called `browser_navigate` for `http://localhost:3000/menu` again, then immediately called `browser_snapshot`.
- Confirmed `/menu`, `/menu/1`, `/cart`, `/checkout`, and `/orders` with Playwright MCP.
- Also used MCP interactions to observe cart, coupon, checkout, `/orders/:id`, and order history after placing an order.

Observed pages:

## `/menu`

- Page title is `Phantom Brew`.
- Header navigation has `Phantom Brew`, `Menu`, `Cart`, and `Orders`.
- Menu controls include category links: `All`, `Coffee`, `Food`, `Sweets`.
- Sort combobox is labeled `Sort:` and has `Default`, `Price: Low to High`, and `Price: High to Low`.
- Search textbox is labeled `Search products...` and has a `Search` button.
- Ten product cards were visible: House Blend, Espresso, Cafe Latte, Matcha Latte, Croissant, BLT Sandwich, Cheese Cake, Tiramisu, Chocolate Scone, and Cold Brew.
- Each product card has an `Add to Cart` button and a link to `/menu/:id`.

## `/menu/1`

- House Blend detail page shows category `Coffee`, title `House Blend`, description, stock count, and `Add to Cart`.
- Size buttons are `S ¥320`, `M ¥380`, and `L ¥450`.
- Coffee options are `Extra Shot (+¥80)`, `Oat Milk (+¥50)`, `Soy Milk (+¥50)`, and `Whipped Cream (+¥60)`.
- Quantity controls are `-` and `+`; default quantity is `1`.
- Default total shown was `¥380`.
- Selecting `L ¥450`, checking `Extra Shot (+¥80)`, and increasing quantity to `2` changed total to `¥1,060`.

## `/cart`

- Empty cart shows heading `Your Cart`, text `Your cart is empty.`, and `Browse Menu`.
- After adding House Blend L with Extra Shot quantity 2, the cart nav showed `Cart 2`.
- Cart item showed `House Blend`, `Size: L | Extra Shot`, unit price `¥530`, line total `¥1,060`, quantity controls, and `Remove`.
- Totals showed subtotal `¥1,060`, tax `¥106`, and total `¥1,166`.
- Coupon textbox is labeled `Coupon code`; applying `PHANTOM10` changed the button to disabled `Applied`, showed `Coupon applied successfully!`, and added `Discount (10% OFF)`.

## `/checkout`

- Visiting `/checkout` with an empty cart redirected to `/cart`.
- With items in cart, `/checkout` showed heading `Checkout`.
- Delivery fields were `Name`, `Email`, `Address`, and `Phone`.
- Payment radios were `Credit Card` and `Cash on Delivery`.
- With credit card selected, card fields `Card Number`, `MM/YY`, and `CVC` were visible.
- Selecting `Cash on Delivery` hid the card fields.
- Order summary showed `House Blend x2`, subtotal `¥1,060`, tax `¥106`, total `¥1,166`, and `Place Order`.

## `/orders/:id`

- Placing an order navigated to a URL like `/orders/A16D3626`.
- Status page heading was `Order #A16D3626`.
- Progress labels were `Received`, `Preparing`, `Delivering`, and `Completed`.
- Current status text was `received`.
- Estimated time was `Estimated: 15 min`.
- Items showed `House Blend (L) x2` and total `¥1,166`.

## `/orders`

- Empty history showed heading `Order History`, `No orders yet.`, and `Browse Menu`.
- After placing an order, history showed columns `Order ID`, `Date`, `Items`, `Total`, and `Status`.
- The order row linked to `/orders/:id` and displayed the order id, date, `1 items`, total `¥1,166`, and status `received`.
