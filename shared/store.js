// kch/shared/store.js — single source of truth for both apps
const KEYS = { products: 'kch_products', orders: 'kch_orders', rules: 'kch_rules' };

const cake = (id, name, price) => ({
  id, name, price, unit: 'kg', minQty: 1, category: 'Cakes', image: '', available: true,
});
const item = (id, name, price, category, packPrice = null) => ({
  id, name, price, packPrice, unit: 'each', minQty: 1, category, image: '', available: true,
});

const DEFAULT_PRODUCTS = [
  // ---- Cakes: priced per 1 kg ----
  cake('c01', 'Mint Chocolate / Vanilla', 2200),
  cake('c02', 'Red Velvet', 2200),
  cake('c03', 'Chocolate Cake', 2200),
  cake('c04', 'Carrot Cake', 2200),
  cake('c05', 'Fruit Cake', 2700),
  cake('c06', 'Blueberry', 2200),
  cake('c07', 'Butterscotch', 2200),
  cake('c08', 'Bubblegum', 2200),
  cake('c09', 'Lemon Cake', 2200),
  cake('c10', 'Cappuccino Cake', 2200),
  cake('c11', 'Chocolate Fudge', 2200),
  cake('c12', 'White Forest', 2200),
  cake('c13', 'Banana Cake', 2200),
  cake('c14', 'Marble Cake', 2200),
  cake('c15', 'Black Forest Cake', 2200),
  cake('c16', 'Toffee Cake', 2200),
  cake('c17', 'Pinacolada', 2200),
  cake('c18', 'Vanilla Cake', 1800),
  cake('c19', 'Strawberry Cake', 1800),
  cake('c20', 'Marble Cake (1800 range)', 1800),

  // ---- Bread ----
  item('b01', 'White Bread 800g', 123, 'Bread', 225),
  item('b02', 'White Bread 400g', 63,  'Bread', 225),
  item('b03', 'White Bread 200g', 35,  'Bread', 225),
  item('b04', 'Brown Bread 800g', 123, 'Bread', 225),
  item('b05', 'Brown Bread 400g', 63,  'Bread', 225),
  item('b06', 'Brown Bread 200g', 35,  'Bread', 225),

  // ---- Buns & pastries ----
  item('p01', 'Scones',        13, 'Buns & Pastries', 260),
  item('p02', 'Ring Buns',      8, 'Buns & Pastries', 95),
  item('p03', 'Round Buns',    15, 'Buns & Pastries', 90),
  item('p04', 'Long Rolls',    15, 'Buns & Pastries'),
  item('p05', 'Doughnut',      15, 'Buns & Pastries', 90),
  item('p06', 'Tea Scones',    35, 'Buns & Pastries', 225),
  item('p07', 'Croissants',    50, 'Buns & Pastries'),
  item('p08', 'Sausage Roll',  55, 'Buns & Pastries'),
  item('p09', 'Danish',        55, 'Buns & Pastries'),

  // ---- Small cakes & cookies ----
  item('s01', 'Queen Cakes',   25, 'Cakes & Cookies', 225),
  item('s02', 'Cookies',       20, 'Cakes & Cookies', 200),
  item('s03', 'Madeira 470g', 130, 'Cakes & Cookies'),
  item('s04', 'Madeira 1kg',  270, 'Cakes & Cookies'),
];
const DEFAULT_RULES = {
  leadTimeHours: 24,                // minimum notice before pickup
  dailyCapacity: 20,                // max orders per day
  hours: {                          // 0 = Sunday ... 6 = Saturday; null = closed
    0: null,
    1: { open: '08:00', close: '17:00' },
    2: { open: '08:00', close: '17:00' },
    3: { open: '08:00', close: '17:00' },
    4: { open: '08:00', close: '17:00' },
    5: { open: '08:00', close: '17:00' },
    6: { open: '09:00', close: '13:00' },
  },
  closedDates: [],                  // e.g. ['2026-12-25']
};

const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
};
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

export function initStore() {
  if (!localStorage.getItem(KEYS.products)) write(KEYS.products, DEFAULT_PRODUCTS);
  if (!localStorage.getItem(KEYS.orders))   write(KEYS.orders, []);
  if (!localStorage.getItem(KEYS.rules))    write(KEYS.rules, DEFAULT_RULES);
}

// ---- Products ----
export const getProducts = () => read(KEYS.products, []);
export const saveProducts = (list) => write(KEYS.products, list);

// ---- Rules ----
export const getRules = () => read(KEYS.rules, DEFAULT_RULES);
export const saveRules = (rules) => write(KEYS.rules, rules);

// ---- Orders ----
export const getOrders = () => read(KEYS.orders, []);

export function addOrder({ customer, items, pickupDate, pickupTime }) {
  const orders = getOrders();
  const order = {
    id: 'KCH-' + Date.now().toString(36).toUpperCase(),
    customer,                       // { name, phone }
    items,                          // [{ productId, name, price, qty }]
    total: items.reduce((s, i) => s + i.price * i.qty, 0),
    pickupDate,                     // 'YYYY-MM-DD'
    pickupTime,                     // 'HH:MM'
    status: 'pending',              // pending | confirmed | baking | ready | collected | cancelled
    cancelRequested: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  orders.push(order);
  write(KEYS.orders, orders);
  return order;
}

export function updateOrder(id, changes) {   // used by Paul's staff app
  const orders = getOrders().map(o =>
    o.id === id ? { ...o, ...changes, updatedAt: new Date().toISOString() } : o);
  write(KEYS.orders, orders);
}

export const requestCancellation = (id) => updateOrder(id, { cancelRequested: true });

// ---- Scheduling helpers ----
export function ordersOnDate(dateStr) {
  return getOrders().filter(o => o.pickupDate === dateStr && o.status !== 'cancelled');
}
export function isDayFull(dateStr) {
  return ordersOnDate(dateStr).length >= getRules().dailyCapacity;
}
export function isDayOpen(dateStr) {
  const rules = getRules();
  const day = new Date(dateStr + 'T00:00').getDay();
  return !!rules.hours[day] && !rules.closedDates.includes(dateStr);
}
export function meetsLeadTime(dateStr, timeStr) {
  const pickup = new Date(`${dateStr}T${timeStr}`);
  const earliest = Date.now() + getRules().leadTimeHours * 3600 * 1000;
  return pickup.getTime() >= earliest;
}

// ---- Live updates (fires when ANOTHER tab/app changes the data) ----
export function onDataChange(callback) {
  window.addEventListener('storage', (e) => {
    if (Object.values(KEYS).includes(e.key)) callback(e.key);
  });
}