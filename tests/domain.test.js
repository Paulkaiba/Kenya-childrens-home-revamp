import test from 'node:test';
import assert from 'node:assert/strict';
import { Cart, CATALOG, defaultPolicy, Scheduler, FixedClock, OrderService, OrderRepository, Customer, ValidationError } from '../Bakery/js/domain.js';

const byId = id => CATALOG.find(p => p.id === id);
const wb = byId('wb'), bb = byId('bb'), ck = byId('ck'), policy = defaultPolicy();
const clock = new FixedClock('2026-09-28T09:00:00'); // a Monday
const setup = () => {
  const repo = new OrderRepository(), cart = new Cart();
  return { repo, cart, svc: new OrderService(repo, new Scheduler(clock), policy, clock) };
};
const me = () => new Customer('Paul Kaiba', '0712 345 678', 'Paul@Example.com');

test('bread lead time: 25 same-day, 26+ one day, 51+ two days, summed across products', () => {
  const c = new Cart();
  c.add(wb, 'std', '', 25); assert.equal(c.leadHoursFor('bread', policy), 0);
  c.add(bb, 'std', '', 1); assert.equal(c.leadHoursFor('bread', policy), 24);
  c.add(wb, 'std', '', 25); assert.equal(c.leadHoursFor('bread', policy), 48);
});

test('cakes need one day, size and flavour affect price not lead time', () => {
  const c = new Cart(); c.add(ck, '2kg', 'Chocolate', 1);
  assert.equal(c.leadHoursFor('cake', policy), 24);
  assert.equal(c.subtotal, 4400);
});

test('more than 2 cakes needs two days, 1-2 cakes still needs one day', () => {
  const c1 = new Cart(); c1.add(ck, '1kg', 'Vanilla', 2);
  assert.equal(c1.leadHoursFor('cake', policy), 24);
  const c2 = new Cart(); c2.add(ck, '1kg', 'Vanilla', 3);
  assert.equal(c2.leadHoursFor('cake', policy), 48);
});

test('a big cake order does not push out the lead time for bread in the same cart', () => {
  const c = new Cart();
  c.add(ck, '1kg', 'Vanilla', 3); // needs 2 days on its own
  c.add(wb, 'std', '', 1);        // needs 0 days on its own
  assert.equal(c.leadHoursFor('cake', policy), 48);
  assert.equal(c.leadHoursFor('bread', policy), 0);
  assert.deepEqual(c.buckets.sort(), ['bread', 'cake']);
});

test('scheduler: Sundays closed, lead time hides early days', () => {
  const s = new Scheduler(clock);
  assert.equal(s.slots(new Date(2026, 9, 4), 0).length, 0);
  assert.equal(s.slots(new Date(2026, 8, 28), 0)[0].getHours(), 11);
  assert.equal(s.slots(new Date(2026, 8, 29), 48).length, 0);
  assert.equal(s.slots(new Date(2026, 8, 30), 48)[0].getHours(), 9);
});

test('evening/overnight orders (5pm-midnight) push pickup to 3pm the next day', () => {
  const cases = ['2026-09-28T17:00:00', '2026-09-28T20:00:00', '2026-09-28T23:59:00'];
  for (const iso of cases) {
    const s = new Scheduler(new FixedClock(iso));
    const now = s.clock.now();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    assert.equal(s.slots(today, 0).length, 0, `${iso}: should have no same-day slots`);
    assert.equal(s.slots(tomorrow, 0)[0].getHours(), 15, `${iso}: next day should start at 3pm`);
  }
});

test('early-morning orders (midnight-8am) get the full next day from opening', () => {
  const cases = ['2026-09-29T00:00:00', '2026-09-29T01:00:00', '2026-09-29T04:00:00', '2026-09-29T07:59:00'];
  for (const iso of cases) {
    const s = new Scheduler(new FixedClock(iso));
    const now = s.clock.now();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    assert.equal(s.slots(today, 0).length, 0, `${iso}: should have no same-day slots`);
    assert.equal(s.slots(tomorrow, 0)[0].getHours(), 8, `${iso}: next day should start at 8am`);
  }
});

test('ordering right at opening (8am) is unrestricted again', () => {
  const s = new Scheduler(new FixedClock('2026-09-29T08:00:00'));
  assert.equal(s.slots(new Date(2026, 8, 29), 0)[0].getHours(), 10); // 8am + 2h minPrep
});

test('ordering before 5pm is unaffected by the late-order floor', () => {
  const s = new Scheduler(clock); // 9am
  assert.equal(s.slots(new Date(2026, 8, 28), 0)[0].getHours(), 11);
});

test('serials are unique and orders link to customer by phone + email', () => {
  const { svc, cart, repo } = setup();
  cart.add(wb, 'std', '', 1); const a = svc.place(cart, me(), { whenByBucket: { bread: new Date(2026, 8, 28, 12) } });
  cart.add(wb, 'std', '', 1); const b = svc.place(cart, me(), { whenByBucket: { bread: new Date(2026, 8, 28, 13) } });
  assert.equal(a.serial, 'KBK-20260928-0001');
  assert.equal(b.serial, 'KBK-20260928-0002');
  assert.equal(repo.find('254712345678', 'paul@example.com').length, 2);
  assert.equal(repo.find('0799999999', 'paul@example.com').length, 0);
});

test('a mixed cart lets cake and bread use different pickup times', () => {
  const { svc, cart, repo } = setup();
  cart.add(ck, '1kg', 'Vanilla', 3); // 2-day lead
  cart.add(wb, 'std', '', 1);        // same-day fine
  const order = svc.place(cart, me(), { whenByBucket: {
    cake: new Date(2026, 8, 30, 10),   // Wednesday — satisfies the 2-day cake lead
    bread: new Date(2026, 8, 28, 12),  // Monday — same day, satisfies bread's 0-hour lead
  } });
  assert.equal(order.pickups.cake, new Date(2026, 8, 30, 10).toISOString());
  assert.equal(order.pickups.bread, new Date(2026, 8, 28, 12).toISOString());
  assert.equal(order.when, new Date(2026, 8, 28, 12).toISOString()); // earliest of the two
});

test('pastries get their own lead time and pickup time, separate from bread', () => {
  const scones = byId('scn'); // a pastry-category product
  const c = new Cart();
  c.add(scones, 'packet', '', 6); // over the 5-unit pastry threshold -> 24h
  c.add(wb, 'std', '', 1);          // bread stays same-day
  assert.equal(c.leadHoursFor('pastry', policy), 24);
  assert.equal(c.leadHoursFor('bread', policy), 0);
  assert.deepEqual(c.buckets.sort(), ['bread', 'pastry']);
});

test('rejects a time earlier than the lead time, bad customer details, and delivery with no location', () => {
  const { svc, cart } = setup();
  cart.add(ck, '1kg', 'Vanilla', 1);
  assert.throws(() => svc.place(cart, me(), { whenByBucket: { cake: new Date(2026, 8, 28, 12) } }), ValidationError);
  assert.throws(() => svc.place(cart, new Customer('P', '123', 'x'), { whenByBucket: { cake: new Date(2026, 8, 30, 10) } }), ValidationError);
  assert.throws(() => svc.place(cart, me(), { whenByBucket: { cake: new Date(2026, 8, 30, 10) }, fulfilment: 'delivery', location: '' }), ValidationError);
});

test('cancellation needs 24 hours before pickup', () => {
  const { svc, cart, repo } = setup();
  cart.add(ck, '1kg', 'Vanilla', 1); const far = svc.place(cart, me(), { whenByBucket: { cake: new Date(2026, 8, 30, 10) } });
  cart.add(wb, 'std', '', 1); const near = svc.place(cart, me(), { whenByBucket: { bread: new Date(2026, 8, 28, 12) } });
  svc.cancel(far.serial);
  assert.equal(repo.get(far.serial).status, 'Cancelled');
  assert.throws(() => svc.cancel(near.serial), ValidationError);
});
