import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, buildNotifications, rowsToCsv, localDay } from '../Staff/js/staffDomain.js';

// Times have no 'Z', so they are read as local time and the tests pass in any timezone.
const line = (id, name, bucket, qty, price, status = 'Received') => ({ id, name, size: 'Std', flavour: null, message: null, qty, price, bucket, status });
const order = (serial, created, lines, extra = {}) => ({
  serial, status: 'Received', cancelRequested: false, fulfilment: 'pickup',
  customer: { name: 'Jane', phone: '254712345678', email: 'j@x.com' },
  createdAt: created, updatedAt: created, lines,
  pickups: Object.fromEntries([...new Set(lines.map(l => l.bucket))].map(b => [b, extra.pickup || '2026-10-05T10:00:00'])),
  ...extra,
});

const orders = [
  order('A1', '2026-10-01T09:00:00', [line('A1-L1', 'White Bread', 'bread', 4, 100), line('A1-L2', 'Celebration Cake', 'cake', 1, 2000)]),
  order('A2', '2026-10-02T09:00:00', [line('A2-L1', 'White Bread', 'bread', 6, 100)], { fulfilment: 'delivery' }),
  order('A3', '2026-10-03T09:00:00', [line('A3-L1', 'Scones', 'pastry', 10, 13, 'Cancelled')], { status: 'Cancelled' }),
  order('A4', '2026-10-09T09:00:00', [line('A4-L1', 'Scones', 'pastry', 5, 13)]),
];

test('report totals ignore cancelled orders and count revenue as qty x price', () => {
  const r = buildReport(orders, { from: '2026-10-01', to: '2026-10-03' });
  assert.equal(r.totals.orders, 2);
  assert.equal(r.totals.items, 11);
  assert.equal(r.totals.revenue, 4 * 100 + 2000 + 6 * 100);
  assert.equal(r.totals.cancelled, 1);
  assert.equal(r.totals.delivery, 1);
  assert.equal(r.totals.pickup, 1);
  assert.equal(r.totals.avgOrder, Math.round(3000 / 2));
});

test('the date range filters by the day the order was placed', () => {
  assert.equal(buildReport(orders, { from: '2026-10-09', to: '2026-10-09' }).totals.orders, 1);
  assert.equal(buildReport(orders, { from: '2026-10-04', to: '2026-10-08' }).totals.orders, 0);
  assert.equal(buildReport(orders).totals.orders, 3);   // no range = all time
});

test('pickup basis uses the collection day instead', () => {
  const r = buildReport(orders, { from: '2026-10-05', to: '2026-10-05', basis: 'pickup' });
  assert.equal(r.totals.orders, 4 - 1);                 // A1, A2, A4 are collected that day; A3 is cancelled
});

test('breakdowns by category, product and day add up', () => {
  const r = buildReport(orders);
  assert.equal(r.byCategory.bread.qty, 10);
  assert.equal(r.byCategory.cake.revenue, 2000);
  assert.equal(r.topProducts[0].name, 'Celebration Cake');          // highest revenue first
  assert.equal(r.topProducts.find(p => p.name === 'White Bread').qty, 10);
  assert.equal(r.byDay.reduce((s, d) => s + d.revenue, 0), r.totals.revenue);
  assert.equal(r.byDay[0].day, '2026-10-01');
});

test('csv has a header, one line per item, and escapes quotes', () => {
  const rows = buildReport([order('Q1', '2026-10-01T09:00:00', [line('Q1-L1', 'Cake "Special"', 'cake', 1, 500)])]).rows;
  const csv = rowsToCsv(rows).split('\r\n');
  assert.equal(csv.length, 2);
  assert.match(csv[0], /^"Order","Date ordered"/);
  assert.ok(csv[1].includes('Cake ""Special""'));
});

test('notifications: cancel requests first, new orders, pickups today, sold out', () => {
  const now = new Date('2026-10-05T08:00:00');
  const list = buildNotifications([
    order('N1', '2026-10-05T07:00:00', [line('N1-L1', 'White Bread', 'bread', 1, 100)]),                              // new, pickup 5 Oct = today
    order('N2', '2026-10-04T07:00:00', [line('N2-L1', 'White Bread', 'bread', 1, 100)], { cancelRequested: true }),
    order('N3', '2026-10-04T07:00:00', [line('N3-L1', 'Scones', 'pastry', 1, 13, 'Collected')]),                     // collected: no pickup alert
    order('N4', '2026-10-04T07:00:00', [line('N4-L1', 'Scones', 'pastry', 1, 13)], { status: 'Cancelled' }),
  ], [{ id: 'wb', name: 'White Bread', soldOut: true }], now);
  assert.deepEqual(list.map(n => n.id), ['cancel:N2', 'new:N1', `today:N1:bread:${localDay(now)}`, `today:N2:bread:${localDay(now)}`, 'soldout:wb']);
  assert.equal(list.find(n => n.type === 'soldout').managerOnly, true);
});