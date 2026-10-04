// Staff-side domain logic: no DOM access, so every class is unit-testable.
// Reuses the same order data the customer app writes (same localStorage key,
// same origin) — this IS the shared data layer for the prototype stage.
import { LocalStorageOrderRepository } from '../../Bakery/js/domain.js';

// ---- Staff accounts & roles ----
// Prototype-only: plain-text credentials in a hardcoded directory. Not for production —
// a real build needs hashed passwords and a server-side login, flagged for later.
export class Staff {
  constructor({ id, name, username, password, role }) {
    Object.assign(this, { id, name, username, role });
    this._password = password;
  }
  get isManager() { return this.role === 'manager'; }
  // Supervisor can see everything a baker sees, but cannot change an order's status —
  // per the stakeholder, supervisors view orders/reports only.
  get canUpdateStatus() { return this.role === 'manager' || this.role === 'baker'; }
  checkPassword(p) { return this._password === p; }
}

export class StaffDirectory {
  constructor(staff = StaffDirectory.seed()) { this.staff = staff; }
  // Real staff: 2 managers, 1 supervisor, 1 baker. 10 username slots are reserved
  // in the directory below for future hires — just add more entries as needed.
  static seed() {
    return [
      new Staff({ id: 1, name: 'Amina Wafula', username: 'amina', password: 'manager123', role: 'manager' }),
      new Staff({ id: 2, name: 'Manager Two', username: 'manager2', password: 'manager123', role: 'manager' }),
      new Staff({ id: 3, name: 'Supervisor', username: 'supervisor', password: 'super123', role: 'supervisor' }),
      new Staff({ id: 4, name: 'Peter Otieno', username: 'peter', password: 'baker123', role: 'baker' }),
    ];
  }
  find(username) { return this.staff.find(s => s.username.toLowerCase() === username.trim().toLowerCase()); }
}

export class AuthError extends Error {}
export class AuthService {
  constructor(directory, session = new SessionStore()) { Object.assign(this, { directory, session }); }
  login(username, password) {
    const staff = this.directory.find(username);
    if (!staff || !staff.checkPassword(password)) throw new AuthError('Incorrect username or password');
    // isManager is stored as plain data, not relied on as a getter — a getter doesn't
    // survive the JSON round-trip through localStorage, which caused manager accounts
    // to come back looking like bakers after login.
    this.session.set({ id: staff.id, name: staff.name, username: staff.username, role: staff.role, isManager: staff.isManager, canUpdateStatus: staff.canUpdateStatus });
    return staff;
  }
  logout() { this.session.clear(); }
  current() { return this.session.get(); }
}
export class SessionStore {
  constructor() { this._v = null; }
  set(v) { this._v = v; }
  get() { return this._v; }
  clear() { this._v = null; }
}
export class LocalSessionStore extends SessionStore {
  set(v) { localStorage.setItem('kch-staff-session', JSON.stringify(v)); }
  get() { const v = localStorage.getItem('kch-staff-session'); return v ? JSON.parse(v) : null; }
  clear() { localStorage.removeItem('kch-staff-session'); }
}

// ---- Order queue: one row per line item, not per order ----
// A single order can hold several different products (cakes, bread, pastries), each
// needing its own baking/ready/collected status and its own pickup time (the bucket
// it belongs to). Flattening to one row per line is what lets staff track each item
// on its own, while `serial` still ties every row back to the same customer order.
const dateKey = iso => new Date(iso).toISOString().slice(0, 10);

export function flattenLines(orders) {
  const rows = [];
  orders.forEach(o => {
    o.lines.forEach(l => {
      rows.push({
        serial: o.serial, orderStatus: o.status, createdAt: o.createdAt,
        customer: o.customer, id: l.id, name: l.name, size: l.size, flavour: l.flavour,
        message: l.message, qty: l.qty, price: l.price, bucket: l.bucket,
        status: l.status || 'Received', pickup: o.pickups?.[l.bucket] || null,
      });
    });
  });
  return rows;
}

export function filterLines(rows, { status, category, date } = {}) {
  return rows.filter(r => {
    if (status && r.status !== status) return false;
    if (category && r.bucket !== category) return false;
    if (date && (!r.pickup || dateKey(r.pickup) !== date)) return false;
    return true;
  });
}

export const STATUS_FLOW = ['Received', 'Baking', 'Ready', 'Collected'];
export function nextStatus(status) {
  const i = STATUS_FLOW.indexOf(status);
  return i >= 0 && i < STATUS_FLOW.length - 1 ? STATUS_FLOW[i + 1] : null;
}

// ---- Production summary: "what do we need to bake for this date" ----
// Groups every non-cancelled line scheduled for the given date by category, then by
// exact product+size+flavour variant, with each variant carrying the list of orders
// that contributed to it (qty, cake message, customer, status) for the drill-down page.
export function productionSummary(orders, date) {
  const summary = { bread: { total: 0, items: {} }, cake: { total: 0, items: {} }, pastry: { total: 0, items: {} } };
  orders.forEach(o => {
    if (o.status === 'Cancelled') return;
    o.lines.forEach(l => {
      if (l.status === 'Cancelled') return;
      const t = o.pickups?.[l.bucket];
      if (!t || dateKey(t) !== date) return;
      const bucket = summary[l.bucket]; if (!bucket) return;
      const key = `${l.name} (${l.size}${l.flavour ? ', ' + l.flavour : ''})`;
      if (!bucket.items[key]) bucket.items[key] = { qty: 0, entries: [] };
      bucket.items[key].qty += l.qty;
      bucket.items[key].entries.push({
        serial: o.serial, lineId: l.id, customer: o.customer.name, qty: l.qty,
        message: l.message || null, status: l.status || 'Received', pickup: t,
      });
      bucket.total += l.qty;
    });
  });
  return summary;
}

export { LocalStorageOrderRepository };
