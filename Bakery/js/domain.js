// Pure domain logic: no DOM access, so every class can be unit-tested in Node.
// Orders, rules and capacity live in ../../shared/store.js so the customer app and the
// staff app read and write the same data. Products live in ProductRepository below
// (localStorage key 'kch-catalog'), which the staff Menu Management screen edits.
import { loadDb, saveDb, localYmd } from '../../shared/store.js';

const H = 36e5;

export class Clock { now() { return new Date(); } }
export class FixedClock extends Clock {
  constructor(d) { super(); this.d = new Date(d); }
  now() { return new Date(this.d); }
}

// ---- Lead-time rules (Strategy pattern) ----
export class LeadRule { hours() { return 0; } }
export class FixedLead extends LeadRule {
  constructor(h) { super(); this.h = h; }
  hours() { return this.h; }
}
export class TieredLead extends LeadRule {
  constructor(tiers) { super(); this.tiers = [...tiers].sort((a, b) => b.over - a.over); }
  hours(qty) { const t = this.tiers.find(t => qty > t.over); return t ? t.hours : 0; }
}
export class LeadPolicy {
  constructor(rules) { this.rules = rules; }
  hoursFor(category, qty) { return (this.rules[category] || new LeadRule()).hours(qty); }
}
// Fallback numbers (kept for tests). The customer app builds its policy from the
// shared rules via policyFromRules(getRules()).
export const defaultPolicy = () => new LeadPolicy({
  bread: new TieredLead([{ over: 25, hours: 24 }, { over: 50, hours: 48 }]),
  cake: new TieredLead([{ over: 2, hours: 48 }, { over: 0, hours: 24 }]),
  pastry: new TieredLead([{ over: 5, hours: 24 }, { over: 10, hours: 48 }]),
});
// Build a LeadPolicy from the shared rules object: { bread: [{over, hours}], ... }
export const policyFromRules = rules => new LeadPolicy(Object.fromEntries(
  Object.entries(rules.lead).map(([cat, tiers]) => [cat, new TieredLead(tiers)])));

// ---- Catalog: products with sizes and flavours ----
export class Size { constructor(id, label, price) { Object.assign(this, { id, label, price }); } }
export class Product {
  constructor({ id, name, category, emoji, desc, ingredients = [], allergens = [], sizes, flavours = [], custom = false, soldOut = false }) {
    Object.assign(this, { id, name, category, emoji, desc, ingredients, allergens, flavours, custom, soldOut });
    this.sizes = sizes.map(s => s instanceof Size ? s : new Size(s.id, s.label, s.price));
  }
  get fromPrice() { return Math.min(...this.sizes.map(s => s.price)); }
  size(id) { return this.sizes.find(s => s.id === id) || this.sizes[0]; }
}

// Real Kelvinloaf Bakery menu and prices, from the stakeholder's two price-list photos
// (Oct 3). Packet/pack quantities were not printed on the sheet for every item — where
// we had to invent one (noted "placeholder qty" below), it's a guess to unblock the
// prototype; the manager corrects these for real once Menu Management is built.
export const CATALOG = [
  new Product({ id: 'wb', name: 'White Bread', category: 'bread', emoji: '🍞',
    desc: 'Soft daily-baked white loaf.', ingredients: ['Wheat flour', 'Yeast', 'Sugar', 'Salt', 'Milk'], allergens: ['Gluten', 'Milk'],
    sizes: [{ id: '200g', label: '200g', price: 35 }, { id: '400g', label: '400g', price: 63 }, { id: '800g', label: '800g', price: 123 }] }),
  new Product({ id: 'bb', name: 'Brown Bread', category: 'bread', emoji: '🍞',
    desc: 'Wholemeal loaf, lightly sweetened.', ingredients: ['Wheat flour', 'Whole wheat', 'Yeast', 'Sugar', 'Salt'], allergens: ['Gluten'],
    sizes: [{ id: '200g', label: '200g', price: 35 }, { id: '400g', label: '400g', price: 63 }, { id: '800g', label: '800g', price: 123 }] }),

  // Standard cakes at Ksh 2200/kg. 2kg/3kg prices are our own linear estimate from the
  // 1kg price (placeholder — the sheet only lists a per-kg figure).
  new Product({ id: 'ck', name: 'Celebration Cake', category: 'cake', emoji: '🎂', custom: true,
    desc: 'Iced to order, Ksh 2200/kg. Choose the size, flavour and message for each cake.',
    ingredients: ['Wheat flour', 'Eggs', 'Butter', 'Sugar', 'Milk'], allergens: ['Gluten', 'Eggs', 'Milk'],
    flavours: ['Mint chocolate', 'Red velvet', 'Chocolate', 'Carrot', 'Blueberry', 'Butterscotch', 'Bubblegum', 'Lemon', 'Cappuccino', 'Chocolate fudge', 'White forest', 'Banana', 'Marble', 'Black forest', 'Toffee', 'Pinacolada'],
    sizes: [{ id: '1kg', label: '1 kg (8–10 people)', price: 2200 }, { id: '2kg', label: '2 kg (16–20 people)', price: 4400 }, { id: '3kg', label: '3 kg (24–30 people)', price: 6600 }] }),
  new Product({ id: 'ckb', name: 'Everyday Cake', category: 'cake', emoji: '🎂', custom: true,
    desc: 'Our lighter-priced cake line, Ksh 1800/kg.',
    ingredients: ['Wheat flour', 'Eggs', 'Butter', 'Sugar', 'Milk'], allergens: ['Gluten', 'Eggs', 'Milk'],
    flavours: ['Vanilla', 'Strawberry', 'Marble'],
    sizes: [{ id: '1kg', label: '1 kg (8–10 people)', price: 1800 }, { id: '2kg', label: '2 kg (16–20 people)', price: 3600 }, { id: '3kg', label: '3 kg (24–30 people)', price: 5400 }] }),
  new Product({ id: 'ckf', name: 'Fruit Cake', category: 'cake', emoji: '🎂', custom: true,
    desc: 'Dense fruit cake, Ksh 2700/kg.',
    ingredients: ['Wheat flour', 'Mixed dried fruit', 'Eggs', 'Butter', 'Sugar'], allergens: ['Gluten', 'Eggs', 'Milk'],
    flavours: ['Classic'],
    sizes: [{ id: '1kg', label: '1 kg (8–10 people)', price: 2700 }, { id: '2kg', label: '2 kg (16–20 people)', price: 5400 }, { id: '3kg', label: '3 kg (24–30 people)', price: 8100 }] }),
  new Product({ id: 'ckc', name: 'Custom / Designer Cake', category: 'cake', emoji: '🎂', custom: true,
    desc: 'Birthday, occasion or designer cakes — final price confirmed by the bakery. Placeholder starting price shown.',
    ingredients: ['Wheat flour', 'Eggs', 'Butter', 'Sugar', 'Milk'], allergens: ['Gluten', 'Eggs', 'Milk'],
    flavours: ['To discuss with bakery'],
    sizes: [{ id: '1kg', label: '1 kg (starting price)', price: 3000 }] }),

  new Product({ id: 'qc', name: 'Queen Cakes', category: 'pastry', emoji: '🧁',
    desc: 'Small individual sponge cakes.', ingredients: ['Wheat flour', 'Eggs', 'Butter', 'Sugar'], allergens: ['Gluten', 'Eggs', 'Milk'],
    sizes: [{ id: 'each', label: 'Each', price: 25 }, { id: 'packet', label: 'Packet of 9 (placeholder qty)', price: 225 }] }),
  new Product({ id: 'scn', name: 'Scones', category: 'pastry', emoji: '🥐',
    desc: 'Classic plain scones.', ingredients: ['Wheat flour', 'Butter', 'Milk', 'Sugar'], allergens: ['Gluten', 'Milk'],
    sizes: [{ id: 'each', label: 'Each', price: 13 }, { id: 'packet', label: 'Packet of 20 (placeholder qty)', price: 260 }] }),
  new Product({ id: 'rgb', name: 'Ring Buns', category: 'pastry', emoji: '🥯',
    desc: 'Ring-shaped sweet buns.', ingredients: ['Wheat flour', 'Yeast', 'Sugar', 'Butter'], allergens: ['Gluten', 'Milk'],
    sizes: [{ id: 'each', label: 'Each', price: 8 }, { id: 'packet', label: 'Packet of 12 (placeholder qty)', price: 95 }] }),
  new Product({ id: 'rdb', name: 'Round Buns', category: 'pastry', emoji: '🥯',
    desc: 'Soft round buns.', ingredients: ['Wheat flour', 'Yeast', 'Sugar', 'Butter'], allergens: ['Gluten', 'Milk'],
    sizes: [{ id: 'each', label: 'Each', price: 15 }, { id: 'packet', label: 'Packet of 6 (placeholder qty)', price: 90 }] }),
  new Product({ id: 'lr', name: 'Long Rolls', category: 'pastry', emoji: '🥖',
    desc: 'Long bread rolls.', ingredients: ['Wheat flour', 'Yeast', 'Salt'], allergens: ['Gluten'],
    sizes: [{ id: 'each', label: 'Each', price: 15 }] }),
  new Product({ id: 'dn', name: 'Doughnuts', category: 'pastry', emoji: '🍩',
    desc: 'Classic sugared doughnuts.', ingredients: ['Wheat flour', 'Sugar', 'Eggs', 'Oil'], allergens: ['Gluten', 'Eggs'],
    sizes: [{ id: 'each', label: 'Each', price: 15 }, { id: 'packet', label: 'Packet of 6 (placeholder qty)', price: 90 }] }),
  new Product({ id: 'mad', name: 'Madeira Cake', category: 'pastry', emoji: '🍰',
    desc: 'Classic dense Madeira loaf cake.', ingredients: ['Wheat flour', 'Eggs', 'Butter', 'Sugar'], allergens: ['Gluten', 'Eggs', 'Milk'],
    sizes: [{ id: '470g', label: '470g', price: 130 }, { id: '1kg', label: '1kg', price: 270 }] }),
  new Product({ id: 'tsc', name: 'Tea Scones', category: 'pastry', emoji: '🥐',
    desc: 'Scones sized for tea time.', ingredients: ['Wheat flour', 'Butter', 'Milk', 'Sugar'], allergens: ['Gluten', 'Milk'],
    sizes: [{ id: 'each', label: 'Each', price: 35 }, { id: 'packet', label: 'Packet of 6 (placeholder qty)', price: 225 }] }),
  new Product({ id: 'crs', name: 'Croissants', category: 'pastry', emoji: '🥐',
    desc: 'Buttery, flaky croissants.', ingredients: ['Wheat flour', 'Butter', 'Yeast'], allergens: ['Gluten', 'Milk'],
    sizes: [{ id: 'each', label: 'Each', price: 50 }] }),
  new Product({ id: 'sr', name: 'Sausage Rolls', category: 'pastry', emoji: '🌭',
    desc: 'Savoury sausage-filled pastry.', ingredients: ['Wheat flour', 'Sausage meat', 'Butter'], allergens: ['Gluten'],
    sizes: [{ id: 'each', label: 'Each', price: 55 }] }),
  new Product({ id: 'ckie', name: 'Cookies', category: 'pastry', emoji: '🍪',
    desc: 'Classic baked cookies.', ingredients: ['Wheat flour', 'Butter', 'Sugar', 'Eggs'], allergens: ['Gluten', 'Eggs', 'Milk'],
    sizes: [{ id: 'each', label: 'Each', price: 20 }, { id: 'packet', label: 'Packet of 10 (placeholder qty)', price: 200 }] }),
  new Product({ id: 'dan', name: 'Danish Pastries', category: 'pastry', emoji: '🥐',
    desc: 'Flaky Danish pastry.', ingredients: ['Wheat flour', 'Butter', 'Sugar'], allergens: ['Gluten', 'Milk'],
    sizes: [{ id: 'each', label: 'Each', price: 55 }] }),
];

// ---- Product repository: the editable, persisted catalog ----
// CATALOG above is the seed data only. Every screen (customer menu, staff Menu
// Management) reads through this repository instead, so a manager's edits
// actually stick and the customer site picks them up on next load.
export class ProductRepository {
  constructor() { this.db = CATALOG.map(p => ProductRepository.toPlain(p)); }
  static toPlain(p) { return { id: p.id, name: p.name, category: p.category, emoji: p.emoji, desc: p.desc, ingredients: [...p.ingredients], allergens: [...p.allergens], flavours: [...p.flavours], custom: p.custom, soldOut: p.soldOut, sizes: p.sizes.map(s => ({ id: s.id, label: s.label, price: s.price })) }; }
  load() { return this.db; }
  persist(db) { this.db = db; }
  list() { return this.load().map(p => new Product(p)); }
  get(id) { const p = this.load().find(p => p.id === id); return p ? new Product(p) : undefined; }
  save(product) {
    const plain = product instanceof Product ? ProductRepository.toPlain(product) : product;
    const db = this.load(), i = db.findIndex(p => p.id === plain.id);
    if (i >= 0) db[i] = plain; else db.push(plain);
    this.persist(db);
  }
  remove(id) { this.persist(this.load().filter(p => p.id !== id)); }
  setSoldOut(id, soldOut) { const db = this.load(), p = db.find(p => p.id === id); if (p) { p.soldOut = soldOut; this.persist(db); } }
}
export class LocalStorageProductRepository extends ProductRepository {
  constructor() { super(); this._ensureSeeded(); }
  load() { return JSON.parse(localStorage.getItem('kch-catalog') || 'null') || this.db; }
  persist(db) { this.db = db; localStorage.setItem('kch-catalog', JSON.stringify(db)); }
  _ensureSeeded() { if (!localStorage.getItem('kch-catalog')) this.persist(this.db); }
}

// ---- Cart: one shared cart across products, like an Uber-style checkout ----
export class Cart {
  constructor() { this.items = new Map(); }
  key(p, sizeId, flavour, message) { return [p.id, sizeId, flavour || '', message || ''].join('|'); }
  add(p, sizeId, flavour, qty, message = '') {
    const k = this.key(p, sizeId, flavour, message), existing = this.items.get(k);
    this.items.set(k, { product: p, size: p.size(sizeId), flavour, message, qty: (existing?.qty || 0) + qty });
  }
  remove(k) { this.items.delete(k); }
  clear() { this.items.clear(); }
  get lines() { return [...this.items.entries()].map(([key, l]) => ({ key, ...l })); }
  get count() { return this.lines.reduce((n, l) => n + l.qty, 0); }
  get subtotal() { return this.lines.reduce((s, l) => s + l.qty * l.size.price, 0); }
  get isEmpty() { return !this.items.size; }
  // Every category (bread, cake, pastry, ...) is scheduled independently, so a big
  // order in one category never forces another category onto a later date.
  bucketOf(l) { return l.product.category; }
  get buckets() { return [...new Set(this.lines.map(l => this.bucketOf(l)))]; }
  leadHoursFor(bucket, policy) {
    const byCat = {};
    this.lines.filter(l => this.bucketOf(l) === bucket).forEach(l => { byCat[l.product.category] = (byCat[l.product.category] || 0) + l.qty; });
    return Math.max(0, ...Object.entries(byCat).map(([c, q]) => policy.hoursFor(c, q)));
  }
  // Kept for callers that just want one worst-case figure across the whole cart.
  leadHours(policy) { return Math.max(0, ...this.buckets.map(b => this.leadHoursFor(b, policy))); }
}

// ---- Scheduling ----
// closedDates: ['YYYY-MM-DD'] extra days off. isFull(day): returns true when the day is at capacity.
export class Scheduler {
  constructor(clock, { open = 8, close = 18, closedDays = [0], closedDates = [], isFull = () => false, minPrep = 2, lateCutoffHour = 17, lateFloorHour = 15 } = {}) {
    Object.assign(this, { clock, open, close, closedDays, closedDates, isFull, minPrep, lateCutoffHour, lateFloorHour });
  }
  earliest(lead) {
    const now = this.clock.now();
    let t = new Date(now.getTime() + Math.max(lead, this.minPrep) * H);
    if (now.getHours() >= this.lateCutoffHour) {
      // Evening/overnight order (5pm-midnight): too close to the next opening
      // for a normal morning slot, so push to no earlier than 3pm the next day.
      const floor = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, this.lateFloorHour);
      if (t < floor) t = floor;
    } else if (now.getHours() < this.open) {
      // Early-morning order (midnight-opening): still can't get today, but the
      // next day is already 24h+ away, so the full day is available from opening.
      const floor = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, this.open);
      if (t < floor) t = floor;
    }
    return t;
  }
  slots(day, lead) {
    if (this.closedDays.includes(day.getDay()) || this.closedDates.includes(localYmd(day)) || this.isFull(day)) return [];
    const min = this.earliest(lead), out = [];
    for (let h = this.open; h < this.close; h++) {
      const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h);
      if (t >= min) out.push(t);
    }
    return out;
  }
  isOpenDay(day, lead) { return this.slots(day, lead).length > 0; }
  isValid(when, lead) { return this.slots(when, lead).some(t => +t === +when); }
}

// ---- Customer ----
export class Customer {
  constructor(name, phone, email) {
    this.name = name.trim();
    this.phone = Customer.normalizePhone(phone);
    this.email = email.trim().toLowerCase();
  }
  static normalizePhone(p) {
    const d = String(p).replace(/\D/g, '');
    return d.startsWith('254') ? d : '254' + d.replace(/^0/, '');
  }
  errors() {
    const e = [];
    if (this.name.length < 2) e.push('Enter your full name');
    if (!/^254[17]\d{8}$/.test(this.phone)) e.push('Enter a valid Kenyan phone number');
    if (!/^\S+@\S+\.\S+$/.test(this.email)) e.push('Enter a valid email address');
    return e;
  }
}

// ---- Storage (swap the subclass for a real database later) ----
export class OrderRepository {
  constructor() { this.db = { orders: [], seq: {} }; }
  load() { return this.db; }
  persist(db) { this.db = db; }
  add(order) { const db = this.load(); db.orders.push(order); this.persist(db); }
  update(serial, patch) {
    const db = this.load();
    Object.assign(db.orders.find(o => o.serial === serial), patch, { updatedAt: new Date().toISOString() });
    this.persist(db);
  }
  nextSeq(key) { const db = this.load(); db.seq[key] = (db.seq[key] || 0) + 1; this.persist(db); return db.seq[key]; }
  get(serial) { return this.load().orders.find(o => o.serial === serial); }
  // Each line (one cake, one bread order, etc.) progresses through its own status
  // independently — the whole order is only marked Collected once every line is.
  updateLineStatus(serial, lineId, status) {
    const db = this.load(), order = db.orders.find(o => o.serial === serial);
    if (!order) return;
    const line = order.lines.find(l => l.id === lineId);
    if (!line) return;
    line.status = status;
    if (order.lines.every(l => l.status === 'Collected')) order.status = 'Collected';
    order.updatedAt = new Date().toISOString();
    this.persist(db);
  }
  // Staff approve a cancellation (request or phone call): the whole order and every line are cancelled.
  cancelOrder(serial) {
    const db = this.load(), order = db.orders.find(o => o.serial === serial);
    if (!order) return;
    order.status = 'Cancelled';
    order.cancelRequested = false;
    order.lines.forEach(l => { l.status = 'Cancelled'; });
    order.updatedAt = new Date().toISOString();
    this.persist(db);
  }
  find(phone, email) {
    const p = Customer.normalizePhone(phone), e = email.trim().toLowerCase();
    return this.load().orders.filter(o => o.customer.phone === p && o.customer.email === e);
  }
}
// Same localStorage key as before ('kch-bakery'), now accessed through the shared store.
export class LocalStorageOrderRepository extends OrderRepository {
  load() { return loadDb(); }
  persist(db) { saveDb(db); }
}

// ---- Orders ----
export class ValidationError extends Error {
  constructor(list) { super(list.join('; ')); this.list = list; }
}
export class OrderService {
  // Delivery no longer has a flat fee: the manager contacts the customer after
  // the order is placed to agree a delivery price by phone/WhatsApp.
  static CANCEL_HOURS = 24;
  constructor(repo, scheduler, policy, clock) { Object.assign(this, { repo, scheduler, policy, clock }); }

  place(cart, customer, { fulfilment = 'pickup', location = '', whenByBucket = {}, notes = '' }) {
    const errs = customer.errors();
    const buckets = cart.buckets;
    if (cart.isEmpty) errs.push('Your cart is empty');
    else buckets.forEach(b => {
      const t = whenByBucket[b];
      if (!t || !this.scheduler.isValid(t, cart.leadHoursFor(b, this.policy)))
        errs.push(`Pick an available date and time for ${b === 'cake' ? 'the cakes' : 'the rest of your order'}`);
    });
    if (fulfilment === 'delivery' && !location.trim()) errs.push('Enter your delivery location');
    if (errs.length) throw new ValidationError(errs);
    const now = this.clock.now(), p = n => String(n).padStart(2, '0');
    const key = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
    const serial = `KBK-${key}-${String(this.repo.nextSeq(key)).padStart(4, '0')}`;
    const fee = 0; // delivery price is agreed by phone/WhatsApp after ordering, not charged here
    const pickups = Object.fromEntries(buckets.map(b => [b, whenByBucket[b].toISOString()]));
    const earliest = buckets.map(b => whenByBucket[b]).sort((a, b) => a - b)[0];
    const order = {
      serial, fulfilment, location, fee, notes, status: 'Received', cancelRequested: false, total: cart.subtotal + fee,
      customer: { name: customer.name, phone: customer.phone, email: customer.email },
      lines: cart.lines.map((l, i) => ({
        id: `${serial}-L${i + 1}`, name: l.product.name, size: l.size.label, flavour: l.flavour || null,
        message: l.message || null, qty: l.qty, price: l.size.price, bucket: cart.bucketOf(l), status: 'Received',
      })),
      pickups, when: earliest.toISOString(), createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    this.repo.add(order);
    cart.clear();
    return order;
  }

  // Instant cancel (kept for tests / staff use). The customer app uses requestCancel().
  cancel(serial) {
    const o = this.repo.get(serial);
    if (!o || o.status !== 'Received') throw new ValidationError(['This order cannot be cancelled']);
    if (new Date(o.when) - this.clock.now() < OrderService.CANCEL_HOURS * H)
      throw new ValidationError(['Orders can only be cancelled 24 hours before pickup']);
    this.repo.update(serial, { status: 'Cancelled' });
  }

  // Customer-side cancellation is a REQUEST: the status does not change.
  // Staff approve it with repo.cancelOrder(serial), or reject it with
  // repo.update(serial, { cancelRequested: false }).
  requestCancel(serial) {
    const o = this.repo.get(serial);
    if (!o || !['Received', 'Confirmed'].includes(o.status) || o.cancelRequested)
      throw new ValidationError(['This order cannot be cancelled']);
    if (new Date(o.when) - this.clock.now() < OrderService.CANCEL_HOURS * H)
      throw new ValidationError(['Orders can only be cancelled 24 hours before pickup']);
    this.repo.update(serial, { cancelRequested: true });
  }
}