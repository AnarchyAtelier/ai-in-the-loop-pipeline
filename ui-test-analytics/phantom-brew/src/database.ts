import initSqlJs from 'sql.js';
import type { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(__dirname, '..', 'data', 'phantom-brew.db');
let db: SqlJsDatabase | null = null;

export async function initDb(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
    description TEXT, price_s INTEGER, price_m INTEGER, price_l INTEGER, stock INTEGER DEFAULT 100
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS options (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, status TEXT DEFAULT 'received',
    total INTEGER NOT NULL, discount INTEGER DEFAULT 0, tax INTEGER NOT NULL,
    customer_name TEXT, customer_email TEXT, customer_address TEXT, customer_phone TEXT,
    payment_method TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL, size TEXT, options_json TEXT DEFAULT '[]',
    quantity INTEGER NOT NULL, unit_price INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, product_id INTEGER NOT NULL,
    size TEXT DEFAULT 'M', options_json TEXT DEFAULT '[]', quantity INTEGER DEFAULT 1,
    added_at TEXT DEFAULT (datetime('now'))
  )`);

  const res = db.exec('SELECT COUNT(*) FROM products');
  if (res.length === 0 || (res[0].values[0][0] as number) === 0) {
    seedData(db);
  }
  saveDb();
  return db;
}

export function getDb(): SqlJsDatabase {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export function saveDb(): void {
  if (!db) return;
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

export function queryAll(sql: string, params: any[] = []): any[] {
  const stmt = getDb().prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const results: any[] = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

export function queryOne(sql: string, params: any[] = []): any | null {
  const r = queryAll(sql, params);
  return r.length > 0 ? r[0] : null;
}

export function runSql(sql: string, params: any[] = []): void {
  getDb().run(sql, params);
  saveDb();
}

function seedData(d: SqlJsDatabase): void {
  const products = [
    [1,'House Blend','Coffee','Our signature blend with notes of chocolate and caramel.',320,380,450,100],
    [2,'Espresso','Coffee','Rich and bold single-origin espresso.',280,340,400,100],
    [3,'Cafe Latte','Coffee','Smooth espresso with steamed milk.',380,440,520,100],
    [4,'Matcha Latte','Coffee','Premium matcha with creamy milk.',420,480,560,100],
    [5,'Croissant','Food','Freshly baked butter croissant.',280,null,null,50],
    [6,'BLT Sandwich','Food','Classic bacon, lettuce, and tomato.',520,null,null,30],
    [7,'Cheese Cake','Sweets','New York style cheese cake.',450,null,null,20],
    [8,'Tiramisu','Sweets','Italian classic with mascarpone.',480,null,null,20],
    [9,'Chocolate Scone','Sweets','Warm chocolate chip scone.',320,null,null,40],
    [10,'Cold Brew','Coffee','24-hour cold brewed for smooth taste.',350,410,490,100],
  ];
  for (const p of products) {
    d.run('INSERT INTO products VALUES (?,?,?,?,?,?,?,?)', p as any[]);
  }
  for (const o of [[1,'Extra Shot',80],[2,'Oat Milk',50],[3,'Soy Milk',50],[4,'Whipped Cream',60]]) {
    d.run('INSERT INTO options VALUES (?,?,?)', o as any[]);
  }
}
