// Staff-side domain logic: no DOM access, so every class is unit-testable.
// Reuses the same order data the customer app writes (same localStorage key,
// same origin) — this IS the shared data layer for the prototype stage.
import { LocalStorageOrderRepository, LocalStorageProductRepository, Product } from '../../Bakery/js/domain.js';

// ---- Staff accounts & roles ----
// Prototype-only: plain-text credentials in a hardcoded directory. Not for production —
// a real build needs hashed passwords and a server-side login, flagged for later.
export class Staff {
  constructor({ id, name, username, password, role }) {
    Object.assign(this, { id, name, username, role });
    this._password = password;
  }
  get isManager() { return this.role === 'manager'; }
  // Managers and supervisors run the Staff Accounts page; only managers may change passwords.
  get canManageStaff() { return this.role === 'manager' || this.role === 'supervisor'; }
  get canResetPasswords() { return this.role === 'manager'; }
  setPassword(p) { this._password = p; }
  toRecord() { return { id: this.id, name: this.name, username: this.username, password: this._password, role: this.role }; }
  // Supervisor can see everything a baker sees, but cannot change an order's status —
  // per the stakeholder, supervisors view orders/reports only.
  get canUpdateStatus() { return this.role === 'manager' || this.role === 'baker'; }
  checkPassword(p) { return this._password === p; }
}

export class StaffError extends Error {}
export const STAFF_ROLES = ['manager', 'supervisor', 'baker'];
const USERNAME_RE = /^[a-z0-9._-]{3,20}$/i;
const MIN_PASSWORD = 6;

export class StaffDirectory {
  constructor(staff = StaffDirectory.seed()) { this.staff = staff; }
  // Starting accounts: 2 managers, 1 supervisor, 1 baker. More are added from the Staff Accounts page.
  static seed() {
    return [
      new Staff({ id: 1, name: 'Amina Wafula', username: 'amina', password: 'manager123', role: 'manager' }),
      new Staff({ id: 2, name: 'Manager Two', username: 'manager2', password: 'manager123', role: 'manager' }),
      new Staff({ id: 3, name: 'Supervisor', username: 'supervisor', password: 'super123', role: 'supervisor' }),
      new Staff({ id: 4, name: 'Peter Otieno', username: 'peter', password: 'baker123', role: 'baker' }),
    ];
  }
  list() { return this.staff; }
  persist() {}                                   // the localStorage subclass saves here
  find(username) { return this.list().find(s => s.username.toLowerCase() === username.trim().toLowerCase()); }
  byId(id) { return this.list().find(s => s.id === id); }

  // Which roles a person may create or remove: managers anyone; supervisors only bakers and supervisors.
  static manageableRoles(role) { return role === 'manager' ? [...STAFF_ROLES] : role === 'supervisor' ? ['supervisor', 'baker'] : []; }

  add(actor, { name = '', username = '', role = '', password = '' }) {
    if (!StaffDirectory.manageableRoles(actor.role).includes(role))
      throw new StaffError(actor.role === 'supervisor' && role === 'manager' ? 'Only a manager can create a manager account.' : 'You are not allowed to add this kind of account.');
    name = name.trim(); username = username.trim();
    const errs = [];
    if (!name) errs.push('Enter the person\'s name');
    if (!USERNAME_RE.test(username)) errs.push('Username must be 3–20 letters, numbers, dots, dashes or underscores');
    else if (this.find(username)) errs.push('That username is already taken');
    if (password.length < MIN_PASSWORD) errs.push(`Password must be at least ${MIN_PASSWORD} characters`);
    if (errs.length) throw new StaffError(errs.join('. '));
    const staff = new Staff({ id: Math.max(0, ...this.list().map(s => s.id)) + 1, name, username, password, role });
    this.staff = [...this.list(), staff];
    this.persist();
    return staff;
  }
  // '' when the actor may remove this account, otherwise the reason they may not.
  removeBlocker(actor, id) {
    const target = this.byId(id);
    if (!target) return 'That account no longer exists.';
    if (!StaffDirectory.manageableRoles(actor.role).includes(target.role))
      return actor.role === 'supervisor' && target.role === 'manager' ? 'Only a manager can remove a manager.' : 'You are not allowed to remove accounts.';
    if (target.id === actor.id) return 'You cannot remove your own account.';
    if (target.role === 'manager' && this.list().filter(s => s.role === 'manager').length <= 1) return 'The last manager account cannot be removed.';
    return '';
  }
  remove(actor, id) {
    const why = this.removeBlocker(actor, id);
    if (why) throw new StaffError(why);
    this.staff = this.list().filter(s => s.id !== id);
    this.persist();
  }
  // Only a manager can change someone's password (a person who forgot theirs asks a manager).
  resetPassword(actor, id, password) {
    if (actor.role !== 'manager') throw new StaffError('Only a manager can change passwords.');
    const target = this.byId(id);
    if (!target) throw new StaffError('That account no longer exists.');
    if ((password || '').length < MIN_PASSWORD) throw new StaffError(`Password must be at least ${MIN_PASSWORD} characters`);
    target.setPassword(password);
    this.persist();
  }
}
// Same directory, saved in the browser so added accounts survive a refresh and can log in.
export class LocalStaffDirectory extends StaffDirectory {
  list() {
    const raw = localStorage.getItem('kch-staff');
    if (raw) this.staff = JSON.parse(raw).map(r => new Staff(r));
    else { this.staff = StaffDirectory.seed(); this.persist(); }
    return this.staff;
  }
  persist() { localStorage.setItem('kch-staff', JSON.stringify(this.staff.map(s => s.toRecord()))); }
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
    this.session.set(AuthService.snapshot(staff));
    return staff;
  }
  static snapshot(s) {
    return { id: s.id, name: s.name, username: s.username, role: s.role, isManager: s.isManager,
             canUpdateStatus: s.canUpdateStatus, canManageStaff: s.canManageStaff, canResetPasswords: s.canResetPasswords };
  }
  logout() { this.session.clear(); }
  // The logged-in person, re-read from the directory every time: if their account was removed they are
  // logged out, and their permissions always match their current record.
  current() {
    const s = this.session.get();
    if (!s) return null;
    const live = this.directory.byId(s.id);
    if (!live || live.username !== s.username) { this.session.clear(); return null; }
    return AuthService.snapshot(live);
  }
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

export { LocalStorageOrderRepository, LocalStorageProductRepository, Product };

// ---- Scheduling rules helpers. The manager types DAYS; the store keeps HOURS. ----
const HOURS_PER_DAY = 24;
const dayLabel = h => h === 0 ? 'same day' : `${h / HOURS_PER_DAY} day${h === HOURS_PER_DAY ? '' : 's'}`;
// Lines of "more than N, D" (N items, D days of notice) -> { tiers: [{ over, hours }], errors: [badLines] }
export function parseTiers(text) {
  const tiers = [], errors = [];
  text.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
    const parts = line.split(',').map(x => x.trim());
    const over = Number(parts[0]), days = Number(parts[1]);
    if (parts.length !== 2 || parts[0] === '' || parts[1] === '' || !Number.isFinite(over) || !Number.isFinite(days) || over < 0 || days < 0) errors.push(line);
    else tiers.push({ over, hours: Math.round(days * HOURS_PER_DAY) });
  });
  return { tiers, errors };
}
export const tiersToText = tiers => (tiers || []).map(t => `${t.over}, ${t.hours / HOURS_PER_DAY}`).join('\n');
// Plain-English summary shown under each box, e.g. "Up to 25: same day · More than 25: 1 day"
export function describeTiers(tiers) {
  if (!tiers || !tiers.length) return 'No advance notice needed';
  const t = [...tiers].sort((a, b) => a.over - b.over), out = [];
  if (t[0].over > 0) out.push(`Up to ${t[0].over}: same day`);
  t.forEach(x => out.push(`${x.over === 0 ? 'Any amount' : 'More than ' + x.over}: ${dayLabel(x.hours)}`));
  return out.join(' · ');
}
// Free text -> sorted unique 'YYYY-MM-DD' dates.
export const parseDates = text => [...new Set(text.split(/[\s,]+/).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort();
