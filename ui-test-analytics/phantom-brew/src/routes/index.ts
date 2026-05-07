import { Router, Request, Response } from 'express';
import { queryAll, queryOne, runSql, saveDb } from '../database';
import { TRAPS, shouldTrigger, randomDelay } from '../traps/config';
import { v4 as uuidv4 } from 'uuid';

export const menuRouter = Router();
export const cartRouter = Router();
export const checkoutRouter = Router();
export const orderRouter = Router();

// ============================================================
// P1: Menu listing
// ============================================================
menuRouter.get('/', (req: Request, res: Response) => {
  const category = req.query.category as string | undefined;
  const sort = req.query.sort as string | undefined;
  const search = req.query.search as string | undefined;

  let sql = 'SELECT * FROM products WHERE 1=1';
  const params: any[] = [];

  if (category && category !== 'all') { sql += ' AND category = ?'; params.push(category); }
  if (search) { sql += ' AND name LIKE ?'; params.push(`%${search}%`); }
  if (sort === 'price_asc') sql += ' ORDER BY price_s ASC';
  else if (sort === 'price_desc') sql += ' ORDER BY price_s DESC';
  else sql += ' ORDER BY id ASC';

  const products = queryAll(sql, params);
  const options = queryAll('SELECT * FROM options');

  res.render('menu', { products, options, currentCategory: category || 'all', currentSort: sort || '', currentSearch: search || '' });
});

// P2: Product detail
menuRouter.get('/:id', (req: Request, res: Response) => {
  const product = queryOne('SELECT * FROM products WHERE id = ?', [Number(req.params.id)]);
  if (!product) { res.status(404).render('error', { message: 'Product not found' }); return; }
  res.render('detail', { product, options: queryAll('SELECT * FROM options') });
});

// ============================================================
// P3: Cart
// ============================================================
const lastUpdateTimestamps = new Map<string, number>();

function calcCart(sessionId: string) {
  const items = queryAll(
    `SELECT ci.*, p.name, p.price_s, p.price_m, p.price_l, p.category
     FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.session_id = ?`,
    [sessionId]
  );
  let subtotal = 0;
  let buggyTax = 0;
  const cartItems = items.map((item: any) => {
    const priceKey = `price_${(item.size || 'm').toLowerCase()}`;
    let unitPrice = item[priceKey] || item.price_s;
    const options = JSON.parse(item.options_json || '[]');
    unitPrice += options.reduce((s: number, o: any) => s + (o.price || 0), 0);
    const itemSubtotal = unitPrice * item.quantity;
    subtotal += itemSubtotal;
    buggyTax += Math.round(itemSubtotal * TRAPS.FN1_TAX_RATE); // FN-1
    return { ...item, unitPrice, itemSubtotal, options };
  });
  return { cartItems, subtotal, buggyTax };
}

cartRouter.get('/', (req: Request, res: Response) => {
  const { cartItems, subtotal, buggyTax } = calcCart(req.sessionID);
  const coupon = (req.session as any)?.appliedCoupon;
  let discountDisplay = 0, discountLabel = '';
  if (coupon === 'PHANTOM10') { discountDisplay = Math.round(subtotal * 0.1); discountLabel = '10% OFF'; }
  else if (coupon === 'BREW500' && subtotal >= 1000) { discountDisplay = 500; discountLabel = '500 OFF'; }
  // FN-3: discount NOT subtracted from total
  const total = subtotal + buggyTax;
  res.render('cart', { items: cartItems, subtotal, tax: buggyTax, discount: discountDisplay, discountLabel, total, couponApplied: !!coupon, couponCode: coupon || '' });
});

cartRouter.post('/add', (req: Request, res: Response) => {
  const { productId, size, options, quantity } = req.body;
  // FP-1: random rollback
  if (shouldTrigger(TRAPS.FP1_ROLLBACK_RATE)) {
    setTimeout(() => res.status(409).json({ error: 'Out of stock', rollback: true }), 200);
    return;
  }
  if (!queryOne('SELECT id FROM products WHERE id = ?', [productId])) {
    res.status(404).json({ error: 'Product not found' }); return;
  }
  const sizeVal = size || 'M';
  const optsJson = JSON.stringify(options || []);
  const existing = queryOne(
    'SELECT * FROM cart_items WHERE session_id=? AND product_id=? AND size=? AND options_json=?',
    [req.sessionID, productId, sizeVal, optsJson]
  );
  if (existing) {
    runSql('UPDATE cart_items SET quantity=quantity+? WHERE id=?', [quantity || 1, existing.id]);
  } else {
    runSql('INSERT INTO cart_items (session_id,product_id,size,options_json,quantity) VALUES (?,?,?,?,?)',
      [req.sessionID, productId, sizeVal, optsJson, quantity || 1]);
  }
  const r = queryOne('SELECT SUM(quantity) as count FROM cart_items WHERE session_id=?', [req.sessionID]);
  res.json({ success: true, cartCount: r?.count || 0 });
});

cartRouter.post('/update', (req: Request, res: Response) => {
  const { itemId, quantity } = req.body;
  const now = Date.now();
  const key = `${req.sessionID}-${itemId}`;
  const last = lastUpdateTimestamps.get(key) || 0;
  // FN-5: race condition - silently ignore rapid updates
  if (now - last < TRAPS.FN5_RACE_WINDOW_MS) {
    const cur = queryOne('SELECT quantity FROM cart_items WHERE id=? AND session_id=?', [itemId, req.sessionID]);
    res.json({ success: true, quantity: cur?.quantity || 1 }); return;
  }
  lastUpdateTimestamps.set(key, now);
  if (quantity <= 0) runSql('DELETE FROM cart_items WHERE id=? AND session_id=?', [itemId, req.sessionID]);
  else runSql('UPDATE cart_items SET quantity=? WHERE id=? AND session_id=?', [quantity, itemId, req.sessionID]);
  res.json({ success: true, quantity: Math.max(0, quantity) });
});

cartRouter.post('/remove', (req: Request, res: Response) => {
  runSql('DELETE FROM cart_items WHERE id=? AND session_id=?', [req.body.itemId, req.sessionID]);
  res.json({ success: true });
});

cartRouter.post('/coupon', (req: Request, res: Response) => {
  const code = req.body.code?.toUpperCase();
  if (['PHANTOM10', 'BREW500'].includes(code)) {
    (req.session as any).appliedCoupon = code;
    res.json({ success: true, message: 'Coupon applied successfully!' }); // FN-3: doesn't change total
  } else {
    res.json({ success: false, message: 'Invalid coupon code.' });
  }
});

// ============================================================
// P4: Checkout
// ============================================================
checkoutRouter.get('/', (req: Request, res: Response) => {
  const { cartItems, subtotal, buggyTax } = calcCart(req.sessionID);
  if (cartItems.length === 0) { res.redirect('/cart'); return; }
  const variant = shouldTrigger(TRAPS.FP3_AB_TEST_RATE) ? 'B' : 'A'; // FP-3
  res.render('checkout', { items: cartItems, subtotal, tax: buggyTax, total: subtotal + buggyTax, variant });
});

checkoutRouter.post('/place-order', (req: Request, res: Response) => {
  const { name, email, address, phone, paymentMethod } = req.body;
  // FN-6: No server-side email format validation
  if (!name || !email || !address || !phone) {
    res.status(400).json({ error: 'All fields are required.' }); return;
  }
  const items = queryAll(
    `SELECT ci.*, p.name as product_name, p.price_s, p.price_m, p.price_l
     FROM cart_items ci JOIN products p ON ci.product_id=p.id WHERE ci.session_id=?`,
    [req.sessionID]
  );
  if (items.length === 0) { res.status(400).json({ error: 'Cart is empty.' }); return; }

  let subtotal = 0, tax = 0;
  const orderItems = items.map((item: any) => {
    let unitPrice = item[`price_${(item.size||'m').toLowerCase()}`] || item.price_s;
    const opts = JSON.parse(item.options_json || '[]');
    unitPrice += opts.reduce((s: number, o: any) => s + (o.price || 0), 0);
    const sub = unitPrice * item.quantity;
    subtotal += sub;
    tax += Math.round(sub * TRAPS.FN1_TAX_RATE); // FN-1
    return { product_id: item.product_id, product_name: item.product_name, size: item.size, options_json: item.options_json, quantity: item.quantity, unit_price: unitPrice };
  });

  const orderId = uuidv4().slice(0, 8).toUpperCase();
  runSql('INSERT INTO orders (id,session_id,total,discount,tax,customer_name,customer_email,customer_address,customer_phone,payment_method) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [orderId, req.sessionID, subtotal + tax, 0, tax, name, email, address, phone, paymentMethod || 'credit']);
  for (const item of orderItems) {
    runSql('INSERT INTO order_items (order_id,product_id,product_name,size,options_json,quantity,unit_price) VALUES (?,?,?,?,?,?,?)',
      [orderId, item.product_id, item.product_name, item.size, item.options_json, item.quantity, item.unit_price]);
  }
  runSql('DELETE FROM cart_items WHERE session_id=?', [req.sessionID]);
  delete (req.session as any).appliedCoupon;
  res.json({ success: true, orderId });
});

// ============================================================
// P5 + P6: Orders
// ============================================================
orderRouter.get('/', (req: Request, res: Response) => {
  const total = (queryOne('SELECT COUNT(*) as c FROM orders WHERE session_id=?', [req.sessionID])?.c || 0) as number;
  const perPage = TRAPS.FN4_ITEMS_PER_PAGE;
  let totalPages = Math.ceil(total / perPage) || 0;
  // FN-4: off-by-one when total is exactly a multiple of perPage
  if (total > 0 && total % perPage === 0) totalPages += 1;
  const page = parseInt(req.query.page as string) || 1;
  const orders = queryAll(
    `SELECT o.*, COUNT(oi.id) as item_count FROM orders o
     LEFT JOIN order_items oi ON o.id=oi.order_id WHERE o.session_id=?
     GROUP BY o.id ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
    [req.sessionID, perPage, (page - 1) * perPage]
  );
  res.render('orders', { orders, currentPage: page, totalPages, totalOrders: total });
});

orderRouter.get('/:id', (req: Request, res: Response) => {
  const order = queryOne('SELECT * FROM orders WHERE id=?', [req.params.id]);
  if (!order) { res.status(404).render('error', { message: 'Order not found' }); return; }
  res.render('order-status', { order, items: queryAll('SELECT * FROM order_items WHERE order_id=?', [req.params.id]) });
});

// P5: SSE stream (FP-2)
orderRouter.get('/:id/stream', (req: Request, res: Response) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  const statuses = ['received', 'preparing', 'delivering', 'completed'];
  const order = queryOne('SELECT status FROM orders WHERE id=?', [req.params.id]);
  let idx = Math.max(0, statuses.indexOf(order?.status || 'received'));

  function send() {
    if (idx >= statuses.length) { res.write(`data: ${JSON.stringify({ status: 'completed', final: true })}\n\n`); res.end(); return; }
    runSql('UPDATE orders SET status=?, updated_at=datetime("now") WHERE id=?', [statuses[idx], req.params.id]);
    res.write(`data: ${JSON.stringify({ status: statuses[idx], step: idx + 1, totalSteps: 4, estimatedMinutes: (3 - idx) * 5 })}\n\n`);
    idx++;
    if (idx < statuses.length) {
      setTimeout(send, randomDelay(TRAPS.FP2_STATUS_MIN_DELAY_MS, TRAPS.FP2_STATUS_MAX_DELAY_MS)); // FP-2
    } else {
      setTimeout(() => { res.write(`data: ${JSON.stringify({ status: 'completed', final: true, step: 4, totalSteps: 4, estimatedMinutes: 0 })}\n\n`); res.end(); }, 1000);
    }
  }
  send();
  req.on('close', () => {});
});
