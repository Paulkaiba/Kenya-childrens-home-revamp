// Hide-from-customers switch + manager-defined scheduling rules (per group and per product).
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };

const { Cart, CATALOG, ProductRepository, LocalStorageProductRepository, Scheduler, FixedClock, policyFromRules } =
  await import('../Bakery/js/domain.js');
const { getRules, saveRules, DEFAULT_RULES } = await import('../shared/store.js');
const { parseTiers, tiersToText, describeTiers, parseDates } = await import('../Staff/js/staffDomain.js');

const byId = id => CATALOG.find(p => p.id === id);
const qc = byId('qc'), sc = byId('scn'), wb = byId('wb'), ck = byId('ck');

// ---------- hide from customers ----------
test('hidden: manager hides a product, the customer menu filter drops it, the manager still lists it', () => {
  const repo = new ProductRepository();
  repo.setHidden('wb', true);
  assert.equal(repo.get('wb').hidden, true);
  assert.equal(repo.list().filter(p => !p.hidden).some(p => p.id === 'wb'), false);   // customer view
  assert.equal(repo.list().some(p => p.id === 'wb'), true);                            // manager view
  repo.setHidden('wb', false);
  assert.equal(repo.list().filter(p => !p.hidden).some(p => p.id === 'wb'), true);
});

test('hidden and sold out are independent switches and survive saving', () => {
  const repo = new ProductRepository();
  repo.setSoldOut('ck', true); repo.setHidden('ck', true);
  const p = repo.get('ck'); assert.deepEqual([p.soldOut, p.hidden], [true, true]);
  repo.setHidden('ck', false);
  assert.deepEqual([repo.get('ck').soldOut, repo.get('ck').hidden], [true, false]);
});

test('hidden flag travels through the shared catalog between the staff and customer apps', () => {
  mem.clear();
  const staff = new LocalStorageProductRepository(), customer = new LocalStorageProductRepository();
  staff.setHidden('ck', true);
  assert.equal(customer.list().filter(p => !p.hidden).some(p => p.id === 'ck'), false);
});

test('older saved catalogs without the hidden field still load (treated as visible)', () => {
  mem.clear();
  localStorage.setItem('kch-catalog', JSON.stringify(CATALOG.map(({ hidden, ...p }) => p)));
  assert.ok(new LocalStorageProductRepository().list().every(p => p.hidden === false));
});

// ---------- parsing and wording ----------
test('parseTiers: days become hours, bad lines are reported not silently dropped', () => {
  const { tiers, errors } = parseTiers('30, 1\n\n 100 , 2 \nhello\n5\n-1, 2\n10, x');
  assert.deepEqual(tiers, [{ over: 30, hours: 24 }, { over: 100, hours: 48 }]);
  assert.deepEqual(errors, ['hello', '5', '-1, 2', '10, x']);
  assert.deepEqual(parseTiers('0, 0.5').tiers, [{ over: 0, hours: 12 }]);
});

test('tiersToText and describeTiers read back in plain English', () => {
  const t = [{ over: 25, hours: 24 }, { over: 50, hours: 48 }];
  assert.equal(tiersToText(t), '25, 1\n50, 2');
  assert.equal(describeTiers(t), 'Up to 25: same day · More than 25: 1 day · More than 50: 2 days');
  assert.equal(describeTiers([{ over: 0, hours: 24 }]), 'Any amount: 1 day');
  assert.equal(describeTiers([]), 'No advance notice needed');
});

// ---------- notice is set per product, nothing else ----------
const cartOf = (...adds) => { const c = new Cart(); adds.forEach(([p, qty]) => c.add(p, p.sizes[0].id, p.flavours[0] || '', qty)); return c; };

test('queen cakes: over 30 needs a day, 30 or fewer is same day', () => {
  const policy = policyFromRules({ productLead: { qc: [{ over: 30, hours: 24 }] } });
  assert.equal(cartOf([qc, 30]).leadHoursFor('pastry', policy), 0);
  assert.equal(cartOf([qc, 31]).leadHoursFor('pastry', policy), 24);
});

test('a product with no rule needs no notice, and one product\'s rule never touches another', () => {
  const policy = policyFromRules({ productLead: { qc: [{ over: 30, hours: 24 }] } });
  assert.equal(cartOf([sc, 200]).leadHoursFor('pastry', policy), 0);           // scones have no rule
  assert.equal(cartOf([qc, 31], [sc, 200]).leadHoursFor('pastry', policy), 24); // only queen cakes ask for notice
});

test('each product is judged on its own total, not added to other products', () => {
  const policy = policyFromRules({ productLead: { qc: [{ over: 30, hours: 24 }], scn: [{ over: 30, hours: 24 }] } });
  assert.equal(cartOf([qc, 20], [sc, 20]).leadHoursFor('pastry', policy), 0);   // 40 pastries in total, but 20 of each
});

test('the same product added twice is added up', () => {
  const policy = policyFromRules({ productLead: { wb: [{ over: 25, hours: 24 }] } });
  assert.equal(cartOf([wb, 20], [wb, 6]).leadHoursFor('bread', policy), 24);
});

test('longest notice in the cart wins', () => {
  const policy = policyFromRules({ productLead: { ck: [{ over: 0, hours: 72 }], ckb: [{ over: 0, hours: 24 }] } });
  assert.equal(cartOf([ck, 1], [byId('ckb'), 1]).leadHoursFor('cake', policy), 72);
});

test('starting values: bread, cakes and pastries begin with the old numbers on every product', () => {
  const p = policyFromRules(DEFAULT_RULES);
  assert.deepEqual([p.hoursForProduct('wb', 25), p.hoursForProduct('wb', 26), p.hoursForProduct('wb', 51)], [0, 24, 48]);
  assert.deepEqual([p.hoursForProduct('ck', 1), p.hoursForProduct('ck', 2), p.hoursForProduct('ck', 3)], [24, 24, 48]);
  assert.deepEqual([p.hoursForProduct('qc', 5), p.hoursForProduct('qc', 6), p.hoursForProduct('qc', 11)], [0, 24, 48]);
  assert.equal(CATALOG.every(x => DEFAULT_RULES.productLead[x.id]), true);       // every starting product has a rule to edit
  assert.equal(p.hoursForProduct('brand-new-product', 99), 0);                   // a product the manager adds later starts with none
});

// ---------- manager saves, customer reads ----------
test('saved rules (days off, closed dates, notice) reach the customer scheduler and policy', () => {
  mem.clear();
  saveRules({ hours: { open: 8, close: 18, closedDays: [6, 0] }, closedDates: ['2026-12-25'], dailyCapacity: 20,
    productLead: { qc: [{ over: 30, hours: 24 }] } });
  const r = getRules(), clock = new FixedClock('2026-09-28T09:00:00');     // Monday morning
  const sch = new Scheduler(clock, { open: r.hours.open, close: r.hours.close, closedDays: r.hours.closedDays, closedDates: r.closedDates });
  assert.equal(sch.isOpenDay(new Date(2026, 9, 3), 0), false);             // Saturday: no pickups
  assert.equal(sch.isOpenDay(new Date(2026, 9, 4), 0), false);             // Sunday: no pickups
  assert.equal(sch.isOpenDay(new Date(2026, 9, 2), 0), true);              // Friday: fine
  assert.equal(sch.isOpenDay(new Date(2026, 11, 25), 0), false);           // Christmas Day closed
  assert.equal(policyFromRules(r).hoursForProduct('qc', 31), 24);
});

test('older saved rules (by-category format) fall back to the starting per-product values', () => {
  mem.clear();
  localStorage.setItem('kch-rules', JSON.stringify({ lead: { bread: [{ over: 25, hours: 24 }] }, hours: DEFAULT_RULES.hours, closedDates: [], dailyCapacity: 20 }));
  assert.equal(policyFromRules(getRules()).hoursForProduct('wb', 26), 24);
});

test('parseDates keeps only valid dates, sorted and unique', () => {
  assert.deepEqual(parseDates('2026-12-25\n2026-01-01, nonsense 2026-12-25'), ['2026-01-01', '2026-12-25']);
});
