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
  checkPassword(p) { return this._password === p; }
}

export class StaffDirectory {
  constructor(staff = StaffDirectory.seed()) { this.staff = staff; }
  static seed() {
    return [
      new Staff({ id: 1, name: 'Amina Wafula', username: 'amina', password: 'manager123', role: 'manager' }),
      new Staff({ id: 2, name: 'Peter Otieno', username: 'peter', password: 'baker123', role: 'baker' }),
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
    this.session.set({ id: staff.id, name: staff.name, username: staff.username, role: staff.role });
    return staff;
  }
  logout() { this.session.clear(); }
  current() { return this.session.get(); }
}
// Kept separate from the login check above so tests can run without real storage.
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

// ---- Order queue helpers ----
const dateKey = iso => new Date(iso).toISOString().slice(0, 10);

export function filterOrders(orders, { status, category, date } = {}) {
  return orders.filter(o => {
    if (status && o.status !== status) return false;
    if (category && !(o.lines.some(l => l.bucket === category))) return false;
    if (date && !Object.values(o.pickups || {}).some(t => dateKey(t) === date)) return false;
    return true;
  });
}

export const STATUS_FLOW = ['Received', 'Baking', 'Ready', 'Collected'];
export function nextStatus(status) {
  const i = STATUS_FLOW.indexOf(status);
  return i >= 0 && i < STATUS_FLOW.length - 1 ? STATUS_FLOW[i + 1] : null;
}

// ---- Production summary: "what do we need to bake for this date" ----
// Groups every non-cancelled order line whose own bucket is scheduled for the
// given date, by category then by product+size+flavour, with running totals.
export function productionSummary(orders, date) {
  const summary = { bread: { total: 0, items: {} }, cake: { total: 0, items: {} }, pastry: { total: 0, items: {} } };
  orders.forEach(o => {
    if (o.status === 'Cancelled') return;
    o.lines.forEach(l => {
      const t = o.pickups?.[l.bucket];
      if (!t || dateKey(t) !== date) return;
      const bucket = summary[l.bucket]; if (!bucket) return;
      const key = `${l.name} (${l.size}${l.flavour ? ', ' + l.flavour : ''})`;
      bucket.items[key] = (bucket.items[key] || 0) + l.qty;
      bucket.total += l.qty;
    });
  });
  return summary;
}

export { LocalStorageOrderRepository };
