import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboard } from '../Staff/js/staffDomain.js';

// Times have no 'Z', so they are read as local time and the tests pass in any timezone.
const ln = (id, name, bucket, qty, status) => ({ id, name, size: 'Std', flavour: null, message: null, qty, price: 100, bucket, status });
const mk = (serial, created, lines, pickupIso, extra = {}) => ({
  serial, status: 'Received', cancelRequested: false, fulfilment: 'pickup',
  customer: { name: 'Jane', phone: '254712345678', email: 'j@x.com' },
  createdAt: created, updatedAt: created, total: 0, lines,
  pickups: Object.fromEntries([...new Set(lines.map(l => l.bucket))].map(b => [b, pickupIso])), ...extra,
});
const now = new Date('2026-10-05T09:00:00');

const A = mk('A', '2026-10-05T07:00:00', [ln('A-L1', 'White Bread', 'bread', 4, 'Received')], '2026-10-05T10:00:00');
const B = mk('B', '2026-10-04T08:00:00', [ln('B-L1', 'Cake', 'cake', 1, 'Ready')], '2026-10-05T14:00:00', { cancelRequested: true });
const C = mk('C', '2026-10-05T08:00:00', [ln('C-L1', 'Scones', 'pastry', 9, 'Received')], '2026-10-05T11:00:00', { status: 'Cancelled' });
const D = mk('D', '2026-10-04T09:00:00', [ln('D-L1', 'Scones', 'pastry', 5, 'Received')], '2026-10-06T09:00:00');

test('dashboard counts orders placed today and ignores cancelled orders', () => {
  const d = buildDashboard([A, B, C, D], now);
  assert.equal(d.ordersToday, 1);              // only A was placed today and is not cancelled
});

test('pickups today are listed in time order with item totals and status', () => {
  const d = buildDashboard([A, B, C, D], now);
  assert.equal(d.pickupsToday, 2);
  assert.deepEqual(d.pickupList.map(p => [p.serial, p.items, p.status]), [['A', 4, 'Received'], ['B', 1, 'Ready']]);
  assert.equal(d.itemsDue, 5);
  assert.equal(d.itemsReady, 1);
});

test('needs attention counts new orders and cancellation requests', () => {
  assert.equal(buildDashboard([A, B, C, D], now).needsAttention, 3);   // A new, B cancel request, D new
});

test('collected items are no longer due today', () => {
  const E = mk('E', '2026-10-05T08:30:00', [ln('E-L1', 'Doughnuts', 'pastry', 6, 'Collected')], '2026-10-05T09:30:00');
  const d = buildDashboard([E], now);
  assert.equal(d.pickupsToday, 0);
  assert.equal(d.itemsDue, 0);
  assert.equal(d.ordersToday, 1);
});

test('an order with parts on different pickup times shows once per collection', () => {
  const F = mk('F', '2026-10-05T08:00:00', [ln('F-L1', 'Bread', 'bread', 2, 'Baking')], '2026-10-05T10:00:00');
  F.lines.push(ln('F-L2', 'Cake', 'cake', 1, 'Received')); F.pickups.cake = '2026-10-05T16:00:00';
  const d = buildDashboard([F], now);
  assert.equal(d.pickupsToday, 2);
  assert.deepEqual(d.pickupList.map(p => p.items), [2, 1]);
});