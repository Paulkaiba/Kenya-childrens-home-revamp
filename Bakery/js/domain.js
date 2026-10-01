// Pure domain logic: no DOM access, so every class can be unit-tested in Node.
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
// Edit these numbers to change ordering rules.
export const defaultPolicy = () => new LeadPolicy({
  bread: new TieredLead([{ over: 25, hours: 24 }, { over: 50, hours: 48 }]),
  cake: new TieredLead([{ over: 2, hours: 48 }, { over: 0, hours: 24 }]),
  pastry: new TieredLead([{ over: 5, hours: 24 }, { over: 10, hours: 48 }]),
});

// ---- Catalog: products with sizes and flavours (placeholder prices/options for now) ----
export class Size { constructor(id, label, price) { Object.assign(this, { id, label, price }); } }
export class Product {
  constructor({ id, name, category, emoji, desc, ingredients = [], allergens = [], sizes, flavours = [], custom = false }) {
    Object.assign(this, { id, name, category, emoji, desc, ingredients, allergens, flavours, custom });
    this.sizes = sizes.map(s => s instanceof Size ? s : new Size(s.id, s.label, s.price));
  }
  get fromPrice() { return Math.min(...this.sizes.map(s => s.price)); }
  size(id) { return this.sizes.find(s => s.id === id) || this.sizes[0]; }
}
export const CATALOG = [
  new Product({ id: 'wb', name: 'White Bread', category: 'bread', emoji: '🍞',
    desc: 'Soft daily-baked white loaf.', ingredients: ['Wheat flour', 'Yeast', 'Sugar', 'Salt', 'Milk'], allergens: ['Gluten', 'Milk'],
    sizes: [{ id: 'std', label: 'Standard loaf', price: 80 }] }),
  new Product({ id: 'bb', name: 'Brown Bread', category: 'bread', emoji: '🍞',
    desc: 'Wholemeal loaf, lightly sweetened.', ingredients: ['Wheat flour', 'Whole wheat', 'Yeast', 'Sugar', 'Salt'], allergens: ['Gluten'],
    sizes: [{ id: 'std', label: 'Standard loaf', price: 90 }] }),
  new Product({ id: 'ck', name: 'Celebration Cake', category: 'cake', emoji: '🎂', custom: true,
    desc: 'Vanilla or chocolate sponge, iced to order. Choose the size, flavour and message for each cake.',
    ingredients: ['Wheat flour', 'Eggs', 'Butter', 'Sugar', 'Milk'], allergens: ['Gluten', 'Eggs', 'Milk'],
    flavours: ['Vanilla', 'Chocolate', 'Red velvet', 'Marble'],
    sizes: [{ id: '1kg', label: '1 kg (8–10 people)', price: 650 }, { id: '2kg', label: '2 kg (16–20 people)', price: 1200 }, { id: '3kg', label: '3 kg (24–30 people)', price: 1700 }] }),
  new Product({ id: 'cu', name: 'Cupcakes', category: 'pastry', emoji: '🧁',
    desc: 'Boxed cupcakes, sold by the dozen.', ingredients: ['Wheat flour', 'Eggs', 'Butter', 'Sugar'], allergens: ['Gluten', 'Eggs', 'Milk'],
    flavours: ['Vanilla', 'Chocolate', 'Red velvet'],
    sizes: [{ id: 'box12', label: 'Box of 12', price: 480 }] }),
  new Product({ id: 'pp', name: 'Pastry Pack', category: 'pastry', emoji: '🥐',
    desc: 'Mixed savoury and sweet pastries.', ingredients: ['Wheat flour', 'Butter', 'Eggs'], allergens: ['Gluten', 'Eggs', 'Milk'],
    sizes: [{ id: 'box6', label: 'Box of 6', price: 220 }] }),
  new Product({ id: 'sc', name: 'Slice Cake Box', category: 'pastry', emoji: '🍰',
    desc: 'Pre-cut cake slices, boxed.', ingredients: ['Wheat flour', 'Eggs', 'Butter', 'Sugar'], allergens: ['Gluten', 'Eggs', 'Milk'],
    flavours: ['Vanilla', 'Chocolate'],
    sizes: [{ id: 'box6', label: 'Box of 6', price: 350 }] }),
];

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
  // Cakes and everything else are scheduled independently, so a big cake order
  // doesn't force bread or pastries in the same cart onto a later date.
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
export class Scheduler {
  constructor(clock, { open = 8, close = 18, closedDays = [0], minPrep = 2, lateCutoffHour = 17, lateFloorHour = 15 } = {}) {
    Object.assign(this, { clock, open, close, closedDays, minPrep, lateCutoffHour, lateFloorHour });
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
    if (this.closedDays.includes(day.getDay())) return [];
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
    Object.assign(db.orders.find(o => o.serial === serial), patch);
    this.persist(db);
  }
  nextSeq(key) { const db = this.load(); db.seq[key] = (db.seq[key] || 0) + 1; this.persist(db); return db.seq[key]; }
  get(serial) { return this.load().orders.find(o => o.serial === serial); }
  find(phone, email) {
    const p = Customer.normalizePhone(phone), e = email.trim().toLowerCase();
    return this.load().orders.filter(o => o.customer.phone === p && o.customer.email === e);
  }
}
export class LocalStorageOrderRepository extends OrderRepository {
  load() { return JSON.parse(localStorage.getItem('kch-bakery') || '{"orders":[],"seq":{}}'); }
  persist(db) { localStorage.setItem('kch-bakery', JSON.stringify(db)); }
}

// ---- Orders ----
export class ValidationError extends Error {
  constructor(list) { super(list.join('; ')); this.list = list; }
}
export class OrderService {
  static DELIVERY_FEE = 100;
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
    const fee = fulfilment === 'delivery' ? OrderService.DELIVERY_FEE : 0;
    const pickups = Object.fromEntries(buckets.map(b => [b, whenByBucket[b].toISOString()]));
    const earliest = buckets.map(b => whenByBucket[b]).sort((a, b) => a - b)[0];
    const order = {
      serial, fulfilment, location, fee, notes, status: 'Received', total: cart.subtotal + fee,
      customer: { name: customer.name, phone: customer.phone, email: customer.email },
      lines: cart.lines.map(l => ({ name: l.product.name, size: l.size.label, flavour: l.flavour || null, message: l.message || null, qty: l.qty, price: l.size.price, bucket: cart.bucketOf(l) })),
      pickups, when: earliest.toISOString(), createdAt: now.toISOString(),
    };
    this.repo.add(order);
    cart.clear();
    return order;
  }

  cancel(serial) {
    const o = this.repo.get(serial);
    if (!o || o.status !== 'Received') throw new ValidationError(['This order cannot be cancelled']);
    if (new Date(o.when) - this.clock.now() < OrderService.CANCEL_HOURS * H)
      throw new ValidationError(['Orders can only be cancelled 24 hours before pickup']);
    this.repo.update(serial, { status: 'Cancelled' });
  }
}
