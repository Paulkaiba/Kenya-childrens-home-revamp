// Stage 2: the customer app loads its menu and scheduling rules from the PHP API (PostgreSQL).
// fetch() is faked here, with the same JSON shapes api/_data.php produces, so these run in plain Node.
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
globalThis.window = { addEventListener() {} };
globalThis.setInterval = () => 0;                                   // the 30-second refresh timer must not keep Node alive

const { CATALOG, Product, policyFromRules } = await import('../Bakery/js/domain.js');
const { DEFAULT_RULES } = await import('../shared/store.js');
const { RemoteProductRepository, loadServerData } = await import('../Bakery/js/remote.js');

// ----- what catalog.php / rules.php send -----
const plain = p => ({ id: p.id, name: p.name, category: p.category, emoji: p.emoji, desc: p.desc, ingredients: [...p.ingredients], allergens: [...p.allergens],
  custom: !!p.custom, soldOut: !!p.soldOut, hidden: !!p.hidden, image: p.image || '', sizes: p.sizes.map(s => ({ id: s.id, label: s.label, price: s.price })), flavours: [...p.flavours] });
const serverCatalog = () => CATALOG.map(plain);
const serverRules = () => JSON.parse(JSON.stringify({ productLead: DEFAULT_RULES.productLead, hours: DEFAULT_RULES.hours, closedDates: DEFAULT_RULES.closedDates, dailyCapacity: DEFAULT_RULES.dailyCapacity }));
const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const routes = { catalog: () => reply({ ok: true, products: serverCatalog() }), rules: () => reply({ ok: true, rules: serverRules() }) };
function serve(cat = routes.catalog, rules = routes.rules) {
  globalThis.fetch = async url => { const name = String(url).split('/').pop(); if (name === 'catalog.php') return cat(); if (name === 'rules.php') return rules(); throw new Error('unexpected ' + name); };
}
const down = () => { globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); }; };

// ----- a tiny fake page so the real customer app can start -----
let handlers, nodes;
function freshPage() {
  handlers = {}; nodes = {};
  const el = () => ({ classList: { toggle() {}, remove() {} }, addEventListener() {}, textContent: '', innerHTML: '', hidden: true, dataset: {} });
  globalThis.document = { hidden: false, querySelector: s => (nodes[s] ??= el()), querySelectorAll: () => [], addEventListener: (t, f) => (handlers[t] ??= []).push(f) };
}
let n = 0;
async function boot() { freshPage(); await import('../Bakery/js/app.js?boot=' + ++n); return nodes['#view'].innerHTML; }
const tick = () => new Promise(r => setTimeout(r, 10));

// ---------- loading ----------
test('the API address is built in one place and points at PHP/api/', async () => {
  const { apiUrl } = await import('../shared/api.js');
  assert.match(apiUrl('catalog.php').pathname, /\/PHP\/Bakery\/catalog\.php$/);
});

test('loadServerData returns the menu and the rules from catalog.php and rules.php', async () => {
  serve();
  const d = await loadServerData();
  assert.equal(d.products.length, CATALOG.length);
  assert.equal(d.rules.dailyCapacity, DEFAULT_RULES.dailyCapacity);
});

test('a server error is reported with its own message, not swallowed', async () => {
  serve(() => reply({ ok: false, error: 'SQLSTATE[08006] connection refused' }, 500));
  await assert.rejects(loadServerData(), /connection refused/);
  serve(() => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('not json'); } }));
  await assert.rejects(loadServerData(), /HTTP 502/);
  down();
  await assert.rejects(loadServerData(), /Failed to fetch/);
});

// ---------- the repository the menu reads from ----------
test('RemoteProductRepository gives the app real Product objects built from the server data', () => {
  const repo = new RemoteProductRepository(serverCatalog());
  const wb = repo.get('wb');
  assert.ok(wb instanceof Product);
  assert.equal(wb.fromPrice, Math.min(...CATALOG.find(p => p.id === 'wb').sizes.map(s => s.price)));
  assert.equal(repo.list().length, CATALOG.length);
  assert.equal(repo.get('nope'), undefined);
});

test('the customer app cannot change the menu: saving is blocked until the staff side is connected', () => {
  const repo = new RemoteProductRepository(serverCatalog());
  assert.throws(() => repo.setSoldOut('wb', true), /read-only/);
  assert.throws(() => repo.save(repo.get('wb')), /read-only/);
});

// ---------- the rules ----------
test('rules from the server give exactly the same notice times as the built-in defaults', () => {
  const fromServer = policyFromRules(serverRules()), local = policyFromRules(DEFAULT_RULES);
  for (const p of CATALOG) for (const q of [1, 2, 3, 5, 6, 10, 11, 25, 26, 50, 51]) assert.equal(fromServer.hoursForProduct(p.id, q), local.hoursForProduct(p.id, q), `${p.id} x${q}`);
});

test('notice rules that the manager changes in the database reach the customer policy', () => {
  const r = serverRules(); r.productLead.qc = [{ over: 30, hours: 24 }];          // Queen Cakes: over 30 need a day
  const p = policyFromRules(r);
  assert.equal(p.hoursForProduct('qc', 30), 0);
  assert.equal(p.hoursForProduct('qc', 31), 24);
});

test('an empty rules table (PHP sends {}) means no notice, not a crash', () => {
  const r = serverRules(); r.productLead = {};
  assert.equal(policyFromRules(r).hoursForProduct('wb', 99), 0);
});

// ---------- the real customer app, started against the fake server ----------
test('the customer menu is built from the server data', async () => {
  const cat = serverCatalog().slice(0, 3); cat[0].name = 'Server White Bread'; cat[0].sizes.forEach(z => { z.price = 99; });   // a card shows the cheapest size
  serve(() => reply({ ok: true, products: cat }));
  const html = await boot();
  assert.match(html, /Server White Bread/); assert.match(html, /Ksh 99/);
  assert.doesNotMatch(html, /Server not reachable/);
  assert.equal((html.match(/data-order=/g) || []).length, 3);                      // only the three the server sent
});

test('products the server leaves out (hidden ones) never reach the menu', async () => {
  const cat = serverCatalog().filter(p => p.id !== 'ck');
  serve(() => reply({ ok: true, products: cat }));
  assert.doesNotMatch(await boot(), /Celebration Cake/);
});

test('sold-out items from the database show as sold out', async () => {
  const cat = serverCatalog(); cat.find(p => p.id === 'wb').soldOut = true;
  serve(() => reply({ ok: true, products: cat }));
  assert.match(await boot(), /Sold out/);
});

test('server unreachable: the app still opens with the built-in menu and tells the user', async () => {
  down();
  const html = await boot();
  assert.match(html, /Server not reachable/);
  assert.equal((html.match(/data-order=/g) || []).length, CATALOG.length);
});

test('live refresh: a change made in the database appears on the open menu without a reload', async () => {
  const cat = serverCatalog().slice(0, 4);
  serve(() => reply({ ok: true, products: cat }));
  await boot();
  assert.match(nodes['#view'].innerHTML, new RegExp(cat[1].name.replace(/[()]/g, '.')));
  const changed = serverCatalog().slice(0, 4); changed[1].name = 'Brand New Loaf';
  serve(() => reply({ ok: true, products: changed }));
  handlers.visibilitychange.forEach(f => f());                                     // customer comes back to the tab
  await tick();
  assert.match(nodes['#view'].innerHTML, /Brand New Loaf/);
});

test('live refresh does nothing (and does not crash) when the server is down', async () => {
  serve(); await boot();
  const before = nodes['#view'].innerHTML;
  down(); handlers.visibilitychange.forEach(f => f()); await tick();
  assert.equal(nodes['#view'].innerHTML, before);
});
