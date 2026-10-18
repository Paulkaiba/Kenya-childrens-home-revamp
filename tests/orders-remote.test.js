// Stage 3: orders are saved by PHP in PostgreSQL. fetch() is faked here, so these run in plain Node.
// The PHP side itself is proven by PHP/Bakery/selftest.php (against the JavaScript rules) and the database part of that page.
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
globalThis.window = { addEventListener() {} };
globalThis.setInterval = () => 0;
globalThis.confirm = () => true;
let alerts = []; globalThis.alert = m => alerts.push(m);

const { CATALOG, Cart, Customer, Scheduler, FixedClock, policyFromRules, ValidationError } = await import('../Bakery/js/domain.js');
const { DEFAULT_RULES } = await import('../shared/store.js');
const { RemoteOrderService } = await import('../Bakery/js/remote.js');

// ---------- a fake server ----------
const plain = p => ({ id: p.id, name: p.name, category: p.category, emoji: p.emoji, desc: p.desc, ingredients: [...p.ingredients], allergens: [...p.allergens], custom: !!p.custom,
  soldOut: false, hidden: false, image: p.image || '', sizes: p.sizes.map(s => ({ id: s.id, label: s.label, price: s.price })), flavours: [...p.flavours] });
const rulesJson = (extra = {}) => ({ productLead: JSON.parse(JSON.stringify(DEFAULT_RULES.productLead)), hours: { ...DEFAULT_RULES.hours }, closedDates: [], dailyCapacity: 20, fullDates: [], ...extra });
const reply = (data, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(data) });
let calls, orderStore;
function server({ place, find, cancel, rules = rulesJson() } = {}) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const name = String(url).split('/').pop(), body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ name, method: opts.method || 'GET', body });
    if (name === 'catalog.php') return reply({ ok: true, products: CATALOG.map(plain) });
    if (name === 'rules.php') return reply({ ok: true, rules });
    if (name === 'place_order.php') return place ? place(body) : reply({ ok: true, order: makeOrder(body) });
    if (name === 'my_orders.php') return find ? find(body) : reply({ ok: true, orders: orderStore.filter(o => o.customer.phone === '254712345678' && o.customer.email === body.email.toLowerCase()) });
    if (name === 'request_cancel.php') return cancel ? cancel(body) : reply({ ok: true, order: Object.assign(orderStore[0], { cancelRequested: true }) });
    throw new Error('unexpected ' + name);
  };
}
// What the real server would answer: it prices the order from the DATABASE (here: the browser's price + 1 so we can tell the difference).
function makeOrder(b) {
  const lines = b.lines.map((l, i) => { const p = CATALOG.find(x => x.id === l.productId), s = p.sizes.find(z => z.id === l.size);
    return { id: `KBK-20261018-0001-L${i + 1}`, name: p.name, size: s.label, flavour: l.flavour || null, message: l.message || null, qty: l.qty, price: s.price + 1, bucket: p.category, status: 'Received' }; });
  const o = { serial: 'KBK-20261018-0001', fulfilment: b.fulfilment, location: b.location, fee: 0, notes: b.notes || '', status: 'Received', cancelRequested: false,
    total: lines.reduce((t, l) => t + l.price * l.qty, 0), customer: { ...b.customer, phone: b.customer.phone, email: b.customer.email.toLowerCase() }, lines,
    pickups: b.pickups, when: Object.values(b.pickups).sort()[0], createdAt: '2026-10-18T07:00:00.000Z', updatedAt: '2026-10-18T07:00:00.000Z' };
  orderStore.push(o); return o;
}

// ---------- a tiny fake page, so the real customer app can start ----------
let handlers, nodes;
function freshPage() {
  handlers = {}; nodes = {};
  const el = () => ({ classList: { toggle() {}, remove() {} }, addEventListener() {}, textContent: '', innerHTML: '', hidden: true, dataset: {} });
  globalThis.document = { hidden: false, querySelector: s => (nodes[s] ??= el()), querySelectorAll: () => [], addEventListener: (t, f) => (handlers[t] ??= []).push(f) };
}
let n = 0;
async function boot() { freshPage(); orderStore = []; alerts = []; return (await import('../Bakery/js/app.js?orders=' + ++n)).app; }
const tick = (ms = 15) => new Promise(r => setTimeout(r, ms));
const click = ds => handlers.click.forEach(f => f({ target: { closest: () => ({ dataset: ds }) } }));
const typed = (name, value) => handlers.input.forEach(f => f({ target: { name, value, type: 'text', dataset: {} } }));

// a pickup time the app's own calendar accepts
function openSlot(app, lead = 0) {
  for (let d = 1; d < 14; d++) { const day = new Date(); day.setDate(day.getDate() + d); const s = app.scheduler.slots(day, lead); if (s.length) return s[s.length - 1]; }
  throw new Error('no open day in the next two weeks');
}
function fillOrder(app, { qty = 2, lines = [['wb', qty]] } = {}) {
  for (const [id, q] of lines) { const p = app.catalog.get(id); app.cart.add(p, p.sizes[0].id, p.flavours[0] || '', q); }
  const cats = [...new Set(lines.map(([id]) => app.catalog.get(id).category))];
  app.form = { fulfilment: 'pickup', name: 'Grace Achieng', phone: '0712 345 678', email: 'Grace@Example.com', notes: '', whenByBucket: Object.fromEntries(cats.map(c => [c, openSlot(app)])) };
}

// ======================================================= RemoteOrderService
function service() {
  const clock = new FixedClock('2026-10-05T09:00:00'), scheduler = new Scheduler(clock, { open: 8, close: 18, closedDays: [0] });
  return { svc: new RemoteOrderService(scheduler, policyFromRules(DEFAULT_RULES), clock), cart: new Cart() };
}
const grace = () => new Customer('Grace Achieng', '0712 345 678', 'Grace@Example.com');

test('place sends the cart WITHOUT prices, with the pickup time per group, and empties the cart only after the server saved it', async () => {
  orderStore = []; server();
  const { svc, cart } = service(); const wb = CATALOG.find(p => p.id === 'wb'); cart.add({ ...wb, size: id => wb.sizes.find(s => s.id === id) }, '400g', '', 2);
  const order = await svc.place(cart, grace(), { whenByBucket: { bread: new Date(2026, 9, 7, 12) }, notes: 'ring me' });
  const sent = calls.find(c => c.name === 'place_order.php');
  assert.equal(sent.method, 'POST');
  assert.deepEqual(sent.body.lines, [{ productId: 'wb', size: '400g', flavour: '', message: '', qty: 2 }]);
  assert.equal(sent.body.customer.phone, '254712345678'); assert.equal(sent.body.customer.email, 'grace@example.com');
  assert.match(sent.body.pickups.bread, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(!JSON.stringify(sent.body).includes('price'));          // the browser never tells the server a price
  assert.equal(order.serial, 'KBK-20261018-0001');                  // the order number is the server's
  assert.equal(cart.isEmpty, true);
});

test('a mistake the browser can see never reaches the network', async () => {
  server(); const { svc, cart } = service();
  await assert.rejects(svc.place(cart, grace(), { whenByBucket: {} }), ValidationError);          // empty cart
  const wb = CATALOG.find(p => p.id === 'wb'); cart.add({ ...wb, size: id => wb.sizes.find(s => s.id === id) }, '400g', '', 1);
  await assert.rejects(svc.place(cart, new Customer('G', '123', 'x'), { whenByBucket: {} }), e => e instanceof ValidationError && e.list.length >= 3);
  assert.equal(calls.filter(c => c.name === 'place_order.php').length, 0);
});

test('the server refusing an order (422) comes back as a ValidationError the customer can read, and the cart is kept', async () => {
  orderStore = []; server({ place: () => reply({ ok: false, errors: ['Pick an available date and time for the cakes'] }, 422) });
  const { svc, cart } = service(); const wb = CATALOG.find(p => p.id === 'wb'); cart.add({ ...wb, size: id => wb.sizes.find(s => s.id === id) }, '400g', '', 1);
  await assert.rejects(svc.place(cart, grace(), { whenByBucket: { bread: new Date(2026, 9, 7, 12) } }), e => e instanceof ValidationError && e.list[0].includes('the cakes'));
  assert.equal(cart.isEmpty, false);
});

test('find and requestCancel send the phone AND email (and the order number to cancel)', async () => {
  orderStore = [{ serial: 'S1', customer: { phone: '254712345678', email: 'grace@example.com' }, cancelRequested: false }]; server();
  const { svc } = service();
  assert.equal((await svc.find('0712 345 678', 'GRACE@example.com')).length, 1);
  assert.deepEqual(calls.at(-1).body, { phone: '0712 345 678', email: 'GRACE@example.com' });
  await svc.requestCancel('S1', '0712345678', 'grace@example.com');
  assert.deepEqual(calls.at(-1).body, { serial: 'S1', phone: '0712345678', email: 'grace@example.com' });
  server({ cancel: () => reply({ ok: false, errors: ['This order cannot be cancelled'] }, 422) });
  await assert.rejects(svc.requestCancel('S1', 'a', 'b'), /cannot be cancelled/);
});

// ======================================================= the real customer app
test('placing an order online: the server saves it, the confirmation shows the SERVER\'s order number and total, the cart empties', async () => {
  server(); const app = await boot(); fillOrder(app);
  const localTotal = app.cart.subtotal;
  await app.place();
  assert.equal(app.order.serial, 'KBK-20261018-0001');
  assert.match(nodes['#view'].innerHTML, /KBK-20261018-0001/);
  assert.equal(app.order.total, localTotal + 2);                    // server priced it (+1 per loaf in this fake), not the browser
  assert.equal(app.cart.isEmpty, true);
  assert.equal(app.service.repo, null);                             // nothing was saved in the browser
  assert.equal(mem.has('kch-bakery'), false);
});

test('the server refusing the order shows its reasons on the checkout and keeps the cart', async () => {
  server({ place: () => reply({ ok: false, errors: ['Pick an available date and time for the rest of your order'] }, 422) });
  const app = await boot(); fillOrder(app);
  await app.place();
  assert.match(nodes['#errors'].innerHTML, /Pick an available date/);
  assert.equal(app.cart.isEmpty, false); assert.equal(app.order, undefined);
});

test('server down while ordering: the customer is told nothing was saved, and the cart is kept', async () => {
  server(); const app = await boot(); fillOrder(app);
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await app.place();
  assert.match(nodes['#errors'].innerHTML, /Nothing was saved/);
  assert.equal(app.cart.isEmpty, false);
});

test('a PHP error message cannot inject HTML into the page', async () => {
  server({ place: () => ({ ok: false, status: 500, text: async () => '<img src=x onerror=alert(1)>Fatal error' }) });
  const app = await boot(); fillOrder(app); await app.place();
  assert.doesNotMatch(nodes['#errors'].innerHTML, /<img/);
});

test('pressing Place order twice sends only ONE order', async () => {
  let release; const gate = new Promise(r => (release = r));
  server({ place: async b => { await gate; return reply({ ok: true, order: makeOrder(b) }); } });
  const app = await boot(); fillOrder(app);
  const first = app.place(); const second = app.place();
  release(); await Promise.all([first, second]);
  assert.equal(calls.filter(c => c.name === 'place_order.php').length, 1);
  assert.equal(orderStore.length, 1);
});

test('My Orders needs BOTH the phone number and the email', async () => {
  server(); const app = await boot();
  orderStore.push({ serial: 'KBK-1', customer: { name: 'Grace', phone: '254712345678', email: 'grace@example.com' }, status: 'Received', cancelRequested: false, total: 70, when: '2026-10-20T09:00:00.000Z', lines: [{ id: 'a', name: 'White Bread', size: '400g', qty: 1, status: 'Received', bucket: 'bread' }], pickups: {} });
  typed('lphone', '0712 345 678'); typed('lemail', '');
  click({ find: '' }); await tick();
  assert.match(nodes['#view'].innerHTML, /Enter both the phone number and the email/);
  assert.equal(calls.filter(c => c.name === 'my_orders.php').length, 0);          // nothing sent without both
  typed('lemail', 'Grace@Example.com'); click({ find: '' }); await tick();
  assert.match(nodes['#view'].innerHTML, /KBK-1/);
});

test('a phone number with the WRONG email shows no orders', async () => {
  server(); const app = await boot();
  orderStore.push({ serial: 'KBK-1', customer: { phone: '254712345678', email: 'grace@example.com' }, status: 'Received', cancelRequested: false, total: 70, when: '2026-10-20T09:00:00.000Z', lines: [], pickups: {} });
  typed('lphone', '0712345678'); typed('lemail', 'someone.else@example.com'); click({ find: '' }); await tick();
  assert.match(nodes['#view'].innerHTML, /No orders found/); assert.doesNotMatch(nodes['#view'].innerHTML, /KBK-1/);
});

test('requesting a cancellation sends serial + phone + email and the list then shows it as requested', async () => {
  server(); const app = await boot();
  orderStore.push({ serial: 'KBK-1', customer: { name: 'Grace', phone: '254712345678', email: 'grace@example.com' }, status: 'Received', cancelRequested: false, total: 70, when: '2026-10-20T09:00:00.000Z', lines: [{ id: 'a', name: 'White Bread', size: '400g', qty: 1, status: 'Received', bucket: 'bread' }], pickups: {} });
  typed('lphone', '0712345678'); typed('lemail', 'grace@example.com'); click({ find: '' }); await tick();
  assert.match(nodes['#view'].innerHTML, /data-cancel="KBK-1"/);
  click({ cancel: 'KBK-1' }); await tick();
  assert.deepEqual(calls.find(c => c.name === 'request_cancel.php').body, { serial: 'KBK-1', phone: '0712345678', email: 'grace@example.com' });
  assert.match(nodes['#view'].innerHTML, /Cancellation requested/);
});

test('days the database says are full are greyed out in the calendar', async () => {
  const day = new Date(); day.setDate(day.getDate() + 3);
  const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  server({ rules: rulesJson({ fullDates: [ymd] }) }); const app = await boot();
  assert.equal(app.scheduler.isFull(day), true);
  const other = new Date(day); other.setDate(other.getDate() + 1);
  assert.equal(app.scheduler.isFull(other), false);
  assert.deepEqual(app.scheduler.slots(day, 0), []);
});

test('server unreachable at start: the app still works with browser storage, exactly as before', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const app = await boot(); fillOrder(app);
  assert.equal(app.offline, true);
  await app.place();
  assert.match(app.order.serial, /^KBK-\d{8}-\d{4}$/);
  assert.equal(mem.has('kch-bakery'), true);                         // saved locally in the fallback
});
