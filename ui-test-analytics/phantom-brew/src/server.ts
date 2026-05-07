import express from 'express';
import session from 'express-session';
import path from 'path';
import { initDb, queryOne } from './database';
import { rateLimiter } from './middleware/rateLimit';
import { TRAPS } from './traps/config';
import { menuRouter, cartRouter, checkoutRouter, orderRouter } from './routes';

const app = express();
const PORT = process.env.PORT || 3000;
let requestCount = 0;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(session({ secret: 'phantom-brew-secret', resave: false, saveUninitialized: true, cookie: { maxAge: 86400000 } }));
app.use(rateLimiter); // FP-4

// FP-6: Cold start delay
app.use((req, res, next) => {
  requestCount++;
  if (requestCount <= TRAPS.FP6_COLD_START_COUNT) setTimeout(next, TRAPS.FP6_COLD_START_DELAY_MS);
  else next();
});

// Cart count for header badge
app.use((req, res, next) => {
  try {
    const r = queryOne('SELECT SUM(quantity) as count FROM cart_items WHERE session_id=?', [req.sessionID]);
    res.locals.cartCount = r?.count || 0;
  } catch { res.locals.cartCount = 0; }
  next();
});

app.get('/', (_, res) => res.redirect('/menu'));
app.use('/menu', menuRouter);
app.use('/cart', cartRouter);
app.use('/checkout', checkoutRouter);
app.use('/orders', orderRouter);
app.use((_, res) => res.status(404).render('error', { message: 'Page not found' }));

// Async startup
(async () => {
  await initDb();
  app.listen(PORT, () => {
    console.log(`Phantom Brew running at http://localhost:${PORT}`);
  });
})();

export default app;
