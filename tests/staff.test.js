import test from 'node:test';
import assert from 'node:assert/strict';
import { StaffDirectory, AuthService, AuthError, SessionStore, flattenLines, filterLines, nextStatus, productionSummary } from '../Staff/js/staffDomain.js';

const auth = () => new AuthService(new StaffDirectory(), new SessionStore());

test('manager and baker can log in, and the session carries the correct role', () => {
  const a = auth();
  const manager = a.login('amina', 'manager123');
  assert.equal(manager.role, 'manager');
  assert.equal(a.current().isManager, true); // what the UI actually reads after login
  assert.equal(a.current().canUpdateStatus, true);
  const baker = a.login('peter', 'baker123');
  assert.equal(baker.role, 'baker');
  assert.equal(a.current().isManager, false);
  assert.equal(a.current().canUpdateStatus, true);
});

test('supervisor can log in, is not a manager, and cannot update order status', () => {
  const a = auth();
  const supervisor = a.login('supervisor', 'super123');
  assert.equal(supervisor.role, 'supervisor');
  assert.equal(a.current().isManager, false);
  assert.equal(a.current().canUpdateStatus, false);
});

test('wrong password or unknown username is rejected', () => {
  const a = auth();
  assert.throws(() => a.login('amina', 'wrong'), AuthError);
  assert.throws(() => a.login('nobody', 'whatever'), AuthError);
});

test('session persists the logged-in staff member until logout', () => {
  const a = auth();
  assert.equal(a.current(), null);
  a.login('amina', 'manager123');
  assert.equal(a.current().username, 'amina');
  a.logout();
  assert.equal(a.current(), null);
});

const sampleOrders = () => ([
  { serial: 'KBK-001', status: 'Received', createdAt: '2026-09-29T08:00:00.000Z',
    customer: { name: 'Jane', phone: '254700000001' },
    pickups: { bread: '2026-09-30T10:00:00.000Z' },
    lines: [{ id: 'KBK-001-L1', name: 'White Bread', size: 'Standard loaf', bucket: 'bread', qty: 3, price: 80, status: 'Received' }] },
  { serial: 'KBK-002', status: 'Received', createdAt: '2026-09-29T09:00:00.000Z',
    customer: { name: 'Sam', phone: '254700000002' },
    pickups: { cake: '2026-10-01T15:00:00.000Z', bread: '2026-09-30T10:00:00.000Z' },
    lines: [
      { id: 'KBK-002-L1', name: 'Celebration Cake', size: '1 kg', flavour: 'Vanilla', message: 'Happy Birthday', bucket: 'cake', qty: 1, price: 650, status: 'Baking' },
      { id: 'KBK-002-L2', name: 'Brown Bread', size: 'Standard loaf', bucket: 'bread', qty: 2, price: 90, status: 'Received' },
    ] },
  { serial: 'KBK-003', status: 'Cancelled',
    customer: { name: 'Eve', phone: '254700000003' },
    pickups: { pastry: '2026-09-30T10:00:00.000Z' },
    lines: [{ id: 'KBK-003-L1', name: 'Pastry Pack', size: 'Box of 6', bucket: 'pastry', qty: 6, price: 220, status: 'Cancelled' }] },
]);

test('flattenLines gives one row per line item, each carrying its own pickup time', () => {
  const rows = flattenLines(sampleOrders());
  assert.equal(rows.length, 4); // 1 + 2 + 1, not 3 (one row per order)
  const cakeRow = rows.find(r => r.name === 'Celebration Cake');
  assert.equal(cakeRow.pickup, '2026-10-01T15:00:00.000Z');
  assert.equal(cakeRow.message, 'Happy Birthday');
  const breadRowFromOrder2 = rows.find(r => r.id === 'KBK-002-L2');
  assert.equal(breadRowFromOrder2.pickup, '2026-09-30T10:00:00.000Z'); // its own bucket's time, not the cake's
});

test('filterLines narrows the flattened rows by status, category and pickup date', () => {
  const rows = flattenLines(sampleOrders());
  assert.equal(filterLines(rows, { status: 'Baking' }).length, 1);
  assert.equal(filterLines(rows, { category: 'cake' }).length, 1);
  assert.equal(filterLines(rows, { date: '2026-09-30' }).length, 3); // bread x2 orders + the cancelled pastry row
});

test('nextStatus walks Received -> Baking -> Ready -> Collected, then stops', () => {
  assert.equal(nextStatus('Received'), 'Baking');
  assert.equal(nextStatus('Collected'), null);
});

test('productionSummary totals per category and skips cancelled lines', () => {
  const summary = productionSummary(sampleOrders(), '2026-09-30');
  assert.equal(summary.bread.total, 5); // 3 + 2 across two different orders
  assert.equal(summary.pastry.total, 0); // cancelled
  assert.equal(summary.cake.total, 0); // that cake is scheduled for 10-01
});

test('productionSummary carries per-order entries for the item drill-down page', () => {
  const summary = productionSummary(sampleOrders(), '2026-10-01');
  const entries = summary.cake.items['Celebration Cake (1 kg, Vanilla)'].entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].serial, 'KBK-002');
  assert.equal(entries[0].message, 'Happy Birthday');
  assert.equal(entries[0].status, 'Baking');
});
