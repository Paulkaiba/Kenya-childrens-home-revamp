// shared/store.js — single source of truth for the customer app and the staff app.
// Nothing touches localStorage at import time, so Node tests can still import this.
   const KEYS = { db: 'kch-bakery', products: 'kch-products', rules: 'kch-rules', catalog: 'kch-catalog' };


// ---------- Default products (real Kelvin Loaf prices) ----------
const kgSizes = price => [
  { id: '1kg', label: '1 kg (8–10 people)',  price },
  { id: '2kg', label: '2 kg (16–20 people)', price: price * 2 },
  { id: '3kg', label: '3 kg (24–30 people)', price: price * 3 },
];
const cake = (id, name, desc, price, flavours) => ({
  id, name, desc, flavours, sizes: kgSizes(price),
  category: 'cake', emoji: '🎂', custom: true, available: true,
  ingredients: ['Wheat flour', 'Eggs', 'Butter', 'Sugar', 'Milk'],
  allergens: ['Gluten', 'Eggs', 'Milk'],
});
const bread = (id, name, desc, ingredients, allergens) => ({
  id, name, desc, ingredients, allergens, flavours: [],
  category: 'bread', emoji: '🍞', custom: false, available: true,
  sizes: [
    { id: '200g', label: '200 g', price: 35 },
    { id: '400g', label: '400 g', price: 63 },
    { id: '800g', label: '800 g', price: 123 },
  ],
});
const small = (id, name, emoji, each, pack = null) => ({
  id, name, emoji, desc: `Freshly baked ${name.toLowerCase()}.`,
  category: 'pastry', custom: false, available: true, flavours: [],
  ingredients: ['Wheat flour', 'Butter', 'Sugar', 'Eggs'], allergens: ['Gluten', 'Eggs', 'Milk'],
  sizes: [{ id: 'each', label: 'Single', price: each },
          ...(pack ? [{ id: 'pack', label: 'Pack', price: pack }] : [])],
});

export const DEFAULT_PRODUCTS = [
  cake('ck', 'Celebration Cake', 'Iced to order, priced per kg. Choose the size, flavour and message for each cake.', 2200,
    ['Mint Chocolate', 'Red Velvet', 'Chocolate', 'Carrot', 'Blueberry', 'Butterscotch', 'Bubblegum',
     'Lemon', 'Cappuccino', 'Chocolate Fudge', 'White Forest', 'Banana', 'Black Forest', 'Toffee', 'Pinacolada']),
  cake('cl', 'Classic Cake', 'Vanilla, strawberry or marble sponge, priced per kg.', 1800,
    ['Vanilla', 'Strawberry', 'Marble']),
  cake('cf', 'Fruit Cake', 'Rich fruit cake, priced per kg.', 2700, ['Fruit']),

  bread('wb', 'White Bread', 'Soft daily-baked white loaf.',
    ['Wheat flour', 'Yeast', 'Sugar', 'Salt', 'Milk'], ['Gluten', 'Milk']),
  bread('bb', 'Brown Bread', 'Wholemeal loaf, lightly sweetened.',
    ['Wheat flour', 'Whole wheat', 'Yeast', 'Sugar', 'Salt'], ['Gluten']),

  small('qc', 'Queen Cakes', '🧁', 25, 225),
  small('sc', 'Scones', '🥐', 13, 260),
  small('ts', 'Tea Scones', '🥐', 35, 225),
  small('rb', 'Ring Buns', '🍩', 8, 95),
  small('ro', 'Round Buns', '🥯', 15, 90),
  small('lr', 'Long Rolls', '🥖', 15),
  small('dn', 'Doughnut', '🍩', 15, 90),
  small('cr', 'Croissants', '🥐', 50),
  small('sr', 'Sausage Roll', '🥐', 55),
  small('da', 'Danish', '🥐', 55),
  small('co', 'Cookies', '🍪', 20, 200),
  { ...small('md', 'Madeira Cake', '🍰', 130),
    sizes: [{ id: '470g', label: '470 g', price: 130 }, { id: '1kg', label: '1 kg', price: 270 }] },
];

// ---------- Default rules (same numbers your defaultPolicy() had) ----------
// Notice is set per product: productLead = { productId: [{ over, hours }] } means "more than `over` of
// this product needs `hours` of notice". A product with no entry needs no advance notice.
// These starting values are the old bread / cake / pastry numbers, copied onto each product; the manager edits them.
const seedLead = (ids, tiers) => Object.fromEntries(ids.map(id => [id, tiers.map(t => ({ ...t }))]));
export const DEFAULT_RULES = {
  hours: { open: 8, close: 18, closedDays: [0] },   // 0 = Sunday
  closedDates: [],                                  // e.g. ['2026-12-25']
  dailyCapacity: 20,                                // max active orders per pickup day
  productLead: {
    ...seedLead(['wb', 'bb'], [{ over: 25, hours: 24 }, { over: 50, hours: 48 }]),
    ...seedLead(['ck', 'ckb', 'ckf', 'ckc'], [{ over: 0, hours: 24 }, { over: 2, hours: 48 }]),
    ...seedLead(['qc', 'scn', 'rgb', 'rdb', 'lr', 'dn', 'mad', 'tsc', 'crs', 'sr', 'ckie', 'dan'], [{ over: 5, hours: 24 }, { over: 10, hours: 48 }]),
  },
};

// ---------- Low-level helpers ----------
const read = (key, fallback) => {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
  catch { return fallback; }
};
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

export function initStore() {
  if (!localStorage.getItem(KEYS.products)) write(KEYS.products, DEFAULT_PRODUCTS);
  if (!localStorage.getItem(KEYS.rules))    write(KEYS.rules, DEFAULT_RULES);
}

// ---------- Products & rules ----------
export const getProducts  = () => read(KEYS.products, DEFAULT_PRODUCTS);
export const saveProducts = list => write(KEYS.products, list);
export const getRules     = () => ({ ...DEFAULT_RULES, ...read(KEYS.rules, {}) });
export const saveRules    = rules => write(KEYS.rules, rules);

// ---------- Orders (stored as { orders: [], seq: {} } under 'kch-bakery') ----------
export const loadDb   = () => read(KEYS.db, { orders: [], seq: {} });
export const saveDb   = db => write(KEYS.db, db);
export const getOrders = () => loadDb().orders;

export function updateOrder(serial, changes) {        // used by the staff app
  const db = loadDb();
  const order = db.orders.find(o => o.serial === serial);
  if (!order) return null;
  Object.assign(order, changes, { updatedAt: new Date().toISOString() });
  saveDb(db);
  return order;
}
export const requestCancellation = serial => updateOrder(serial, { cancelRequested: true });

// ---------- Capacity ----------
export const localYmd = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const ordersOnDate = ymd => getOrders().filter(o =>
  o.status !== 'Cancelled' && Object.values(o.pickups || {}).some(iso => localYmd(new Date(iso)) === ymd));

export const isDayFull = day => ordersOnDate(localYmd(day)).length >= getRules().dailyCapacity;

// ---------- Live updates (fires in OTHER tabs when data changes) ----------
export function onDataChange(callback) {
  window.addEventListener('storage', e => {
    if (Object.values(KEYS).includes(e.key)) callback(e.key);
  });
}