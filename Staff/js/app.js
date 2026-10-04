import { StaffDirectory, LocalStaffDirectory, StaffError, AuthService, LocalSessionStore, LocalStorageOrderRepository, LocalStorageProductRepository, Product, flattenLines, filterLines, nextStatus, productionSummary, STATUS_FLOW, parseTiers, tiersToText, describeTiers, parseDates, buildReport, buildNotifications, rowsToCsv, localDay } from './staffDomain.js';
import { getRules, saveRules, DEFAULT_RULES, onDataChange } from '../../shared/store.js';

const $ = s => document.querySelector(s);
const ksh = n => 'Ksh ' + Number(n).toLocaleString();
const when = iso => new Date(iso).toLocaleString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const today = () => localDay(new Date());
const itemLabel = l => `${l.name} (${l.size}${l.flavour ? ', ' + l.flavour : ''})${l.message ? ' — “' + l.message + '”' : ''}`;
// Sections only managers may open. Staff Accounts is separate: managers AND supervisors.
const MANAGER_ONLY = ['menu', 'rules', 'reports'];
const ROLE_LABEL = { manager: 'Manager', supervisor: 'Supervisor', baker: 'Baker' };
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CATEGORIES = ['bread', 'cake', 'pastry'];
const CAT_LABEL = { bread: 'Bread', cake: 'Cakes', pastry: 'Pastries' };
// Sidebar labels, page titles, notification icons.
const NAV = { queue: ['📋', 'Order Queue'], production: ['🧁', 'Production View'], reports: ['📊', 'Reports'], menu: ['🍰', 'Menu Management'], rules: ['⏱️', 'Scheduling Rules'], staff: ['👥', 'Staff Accounts'] };
const TITLES = { queue: 'Order Queue', production: 'Production View', item: 'Production View', reports: 'Reports', menu: 'Menu Management', rules: 'Scheduling Rules', staff: 'Staff Accounts' };
const NOTIF_ICON = { cancel: '⚠️', new: '🆕', pickup: '🛍️', soldout: '🚫' };
const STAT_LABEL = { Received: 'To start', Baking: 'Baking', Ready: 'Ready for pickup', Collected: 'Collected' };
const dayLabel = ymd => new Date(ymd + 'T00:00').toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
const ago = iso => {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 0) return new Date(iso).toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit' });   // later today
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

class StaffApp {
  constructor(staff, directory, auth) {
    Object.assign(this, { staff, directory, auth });
    this.resettingStaff = null; // account id whose password box is open
    this.repo = new LocalStorageOrderRepository();
    this.catalog = new LocalStorageProductRepository();
    this.filters = { status: '', category: '', date: '' };
    this.prodDate = today();
    this.prodItem = null; // { category, key } when drilled into one item
    this.editingProduct = null; // product id currently expanded for editing, or 'new'
    this.rep = { range: 'month', ...this.rangeDates('month'), basis: 'ordered' };   // Reports page state
    this.currentView = 'queue';
    $('#who').textContent = `${staff.name} · ${ROLE_LABEL[staff.role] || staff.role}`;
    $('#role-banner').textContent = {
      manager: 'Manager access — full visibility and controls.',
      supervisor: 'Supervisor access — you can view orders and add or remove baker and supervisor accounts, but cannot change order status, menu, rules, reports or passwords.',
      baker: 'Baker access — you can view and update orders, but not menu, rules, reports or staff accounts.',
    }[staff.role] || '';
    // Sidebar: unlock what this role may open, keep the lock on the rest.
    document.querySelectorAll('.side button[data-v]').forEach(b => {
      const v = b.dataset.v, [icon, label] = NAV[v] || ['', b.textContent], ok = this.allowed(v);
      b.classList.toggle('locked', !ok);
      b.textContent = `${icon} ${label}${ok ? '' : ' 🔒'}`;
    });
    $('#logout').addEventListener('click', e => { e.preventDefault(); this.auth.logout(); location.href = 'index.html'; });
    document.addEventListener('click', e => this.onClick(e));
    document.addEventListener('change', e => this.onChange(e));
    // Live updates when the customer app (or another staff tab) changes data.
    onDataChange(() => {
      this.refreshBell();
      if (['queue', 'production', 'reports'].includes(this.currentView)) this.show(this.currentView);
    });
    setInterval(() => { if (this.stillSignedIn()) this.refreshBell(); }, 15000);   // keeps "x min ago" fresh too
    this.show('queue');
  }
  // One gate for every way of opening a section (sidebar, back buttons, anything), so a baker or
  // supervisor can never reach a screen their role doesn't allow.
  allowed(v) {
    if (v === 'staff') return !!this.staff.canManageStaff;
    if (MANAGER_ONLY.includes(v)) return !!this.staff.isManager;
    return true;
  }
  // If this account was removed (even from another tab), send the person back to the login page.
  stillSignedIn() {
    const now = this.auth.current();
    if (!now) { location.href = 'index.html'; return false; }
    this.staff = now;
    return true;
  }
  show(v) {
    if (!this.allowed(v)) { alert(v === 'staff' ? 'Only managers and supervisors can manage staff accounts.' : 'Manager access only — ask your manager for this.'); return; }
    this.currentView = v;
    document.querySelectorAll('.side button').forEach(b => b.classList.toggle('active', b.dataset.v === (v === 'item' ? 'production' : v)));
    $('#page-title').textContent = TITLES[v] || '';
    const screen = { staff: 'accounts' }[v] || v;   // `this.staff` is the signed-in person, so that screen is called accounts()
    $('#view').innerHTML = this[screen] ? this[screen]() : this.locked();
    this.refreshBell();
  }
  locked() { return `<div class="box"><b>Manager access only</b><p class="sub">This section is for managers.</p></div>`; }

  allOrders() { return this.repo.load().orders; }

  // ---- Notifications (the bell). Worked out from existing orders and products; "read" is remembered per person. ----
  seenKey() { return `kch-staff-seen-${this.staff.id}`; }
  loadSeen() { try { return new Set(JSON.parse(localStorage.getItem(this.seenKey()) || '[]')); } catch { return new Set(); } }
  saveSeen(set) { localStorage.setItem(this.seenKey(), JSON.stringify([...set].slice(-500))); }
  notifications() { return buildNotifications(this.allOrders(), this.catalog.list()).filter(n => !n.managerOnly || this.staff.isManager); }
  panelHtml(list, seen) {
    const items = list.map(n => `<button class="notif-item ${seen.has(n.id) ? '' : 'unread'}" data-notif="${esc(n.id)}" data-view="${n.view}">
      <span class="notif-ico">${NOTIF_ICON[n.type] || '🔔'}</span><span class="notif-body"><b>${esc(n.title)}</b><small>${esc(n.detail)}</small></span><span class="notif-time">${ago(n.at)}</span></button>`).join('');
    return `<div class="notif-head"><b>Notifications</b><button class="ghost small" data-markall>Mark all read</button></div>${items || '<div class="notif-empty">You are all caught up 🎉</div>'}`;
  }
  refreshBell() {
    const list = this.notifications(), seen = this.loadSeen();
    const unread = list.filter(n => !seen.has(n.id)).length;
    const badge = $('#bell-count');
    if (badge) { badge.textContent = unread > 9 ? '9+' : String(unread); badge.hidden = unread === 0; }
    const panel = $('#notif-panel');
    if (panel && !panel.hidden) panel.innerHTML = this.panelHtml(list, seen);
  }
  toggleBell() {
    const panel = $('#notif-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) panel.innerHTML = this.panelHtml(this.notifications(), this.loadSeen());
  }

  // ---- Order Queue: one row per item. Status is read-only here — it's set from
  // the Production View drill-down instead, since that's where the baker is
  // actually working through a specific item across every order that needs it. ----
  queue() {
    const f = this.filters, all = flattenLines(this.allOrders());
    const rows = filterLines(all, { status: f.status || undefined, category: f.category || undefined, date: f.date || undefined })
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const count = s => all.filter(r => r.status === s).length;
    const cards = STATUS_FLOW.map(s => `<button class="stat stat-${s} ${f.status === s ? 'on' : ''}" data-cardstatus="${s}"><span class="stat-num">${count(s)}</span><span class="stat-label">${STAT_LABEL[s]}</span></button>`).join('');
    const seen = new Set();
    const trs = rows.map(r => {
      const firstOfOrder = !seen.has(r.serial); seen.add(r.serial);
      const cancelBtn = firstOfOrder && this.staff.isManager && r.orderStatus !== 'Cancelled'
        ? `<button class="ghost" data-cancel="${r.serial}">Cancel order</button>` : '';
      return `<tr><td><b>${r.serial}</b></td><td>${esc(r.customer.name)}<br><small>${esc(r.customer.phone)}</small></td>
        <td>${esc(itemLabel(r))} ×${r.qty}</td><td>${r.pickup ? when(r.pickup) : '—'}</td><td>${ksh(r.qty * r.price)}</td>
        <td><span class="status status-${r.status}">${r.status}</span></td><td>${cancelBtn}</td></tr>`;
    }).join('');
    return `<p class="sub">${rows.length} item${rows.length === 1 ? '' : 's'} matching your filters. Click a card to filter by status. Update status from Production View.</p>
      <div class="stats">${cards}</div>
      <div class="box"><div class="two">
        <div><label>Status</label><select data-filter="status"><option value="">All</option>${STATUS_FLOW.concat('Cancelled').map(s => `<option ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div><label>Category</label><select data-filter="category"><option value="">All</option>${CATEGORIES.map(c => `<option value="${c}" ${f.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div><label>Pickup date</label><input type="date" data-filter="date" value="${f.date}"></div>
      </div></div>
      <div class="box table-wrap"><table><tr><th>Serial</th><th>Customer</th><th>Item</th><th>Pickup</th><th>Price</th><th>Status</th><th></th></tr>${trs || '<tr><td colspan="7" class="sub">No items match.</td></tr>'}</table></div>`;
  }

  // ---- Production View: category totals, drill into one item variant to see
  // every order that needs it and update status from there. ----
  production() {
    const summary = productionSummary(this.allOrders(), this.prodDate);
    const card = (label, category, b) => `<div class="prod-card"><div class="prod-head"><b>${label}</b><span class="pill">${b.total} total</span></div>${Object.entries(b.items).map(([name, v]) => `<button class="item-row" data-item="${category}|${encodeURIComponent(name)}"><span>${esc(name)}</span><span>×${v.qty} ›</span></button>`).join('') || '<p class="sub">Nothing scheduled.</p>'}</div>`;
    return `<p class="sub">What needs to be ready, grouped by category, for the date below. Click an item to see each order and set its status.</p>
      <div class="box"><label>Date</label><input type="date" id="prod-date" value="${this.prodDate}" style="max-width:220px"></div>
      <div class="prod-grid">${card('🍞 Bread', 'bread', summary.bread)}${card('🎂 Cakes', 'cake', summary.cake)}${card('🥐 Pastries', 'pastry', summary.pastry)}</div>`;
  }

  item() {
    const { category, key } = this.prodItem;
    const bucket = productionSummary(this.allOrders(), this.prodDate)[category];
    const data = bucket.items[key];
    if (!data) return `<p class="sub">This item is no longer scheduled for this date.</p><button class="ghost" data-v="production">‹ Back to Production View</button>`;
    const rows = data.entries.map(e => `<tr><td><b>${e.serial}</b></td><td>${esc(e.customer)}</td><td>×${e.qty}</td><td>${e.message ? '“' + esc(e.message) + '”' : '—'}</td>
      <td><span class="status status-${e.status}">${e.status}</span></td>
      <td>${this.staff.canUpdateStatus && nextStatus(e.status) ? `<button class="primary" data-lineadvance="${e.serial}|${e.lineId}">Mark ${nextStatus(e.status)}</button>` : ''}</td></tr>`).join('');
    return `<button class="ghost" data-v="production">‹ Back to Production View</button>
      <h2 style="margin-top:12px">${esc(key)}</h2><p class="sub">${data.qty} total needed on ${this.prodDate}.</p>
      <div class="box table-wrap"><table><tr><th>Serial</th><th>Customer</th><th>Qty</th><th>Specification</th><th>Status</th><th></th></tr>${rows}</table></div>`;
  }

  // ---- Reports (managers only, enforced in show()) ----
  rangeDates(range) {
    const t = new Date(), end = localDay(t);
    if (range === 'today') return { from: end, to: end };
    if (range === '7') { const s = new Date(t); s.setDate(s.getDate() - 6); return { from: localDay(s), to: end }; }
    if (range === 'month') return { from: localDay(new Date(t.getFullYear(), t.getMonth(), 1)), to: end };
    return { from: '', to: '' };   // all time
  }
  reports() {
    const { from, to, basis, range } = this.rep;
    const rep = buildReport(this.allOrders(), { from, to, basis }), t = rep.totals;
    const span = from || to ? `${from || 'the beginning'} to ${to || 'today'}` : 'all time';
    const chip = (v, text) => `<button class="chip-btn ${range === v ? 'on' : ''}" data-range="${v}">${text}</button>`;
    const bars = (items, fmt) => {
      const max = Math.max(1, ...items.map(i => i.value));
      return items.length ? items.map(i => `<div class="bar-row"><span class="bar-label" title="${esc(i.label)}">${esc(i.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, Math.round(i.value / max * 100))}%"></div></div><span class="bar-val">${fmt(i)}</span></div>`).join('') : '<p class="sub">Nothing in this period.</p>';
    };
    const stat = (num, label, cls = '') => `<div class="stat ${cls}"><span class="stat-num">${num}</span><span class="stat-label">${label}</span></div>`;
    const empty = `<div class="box empty-state"><span class="big">📭</span><b>No orders in this period</b><p class="sub">Try a wider date range.</p></div>`;
    const body = !rep.rows.length ? empty : `
      <div class="stats">
        ${stat(ksh(t.revenue), 'Revenue', 'money')}${stat(t.orders, 'Orders')}${stat(t.items, 'Items sold')}
        ${stat(ksh(t.avgOrder), 'Average order')}${stat(t.cancelled, 'Cancelled orders')}${stat(`${t.pickup} / ${t.delivery}`, 'Pickup / Delivery')}
      </div>
      <div class="panel-grid">
        <div class="panel"><h3>Revenue by day</h3>${bars(rep.byDay.slice(-31).map(d => ({ label: dayLabel(d.day), value: d.revenue, orders: d.orders })), i => `${ksh(i.value)} · ${i.orders} order${i.orders === 1 ? '' : 's'}`)}</div>
        <div class="panel"><h3>Sales by category</h3>${bars(Object.entries(rep.byCategory).map(([c, v]) => ({ label: CAT_LABEL[c] || c, value: v.revenue, qty: v.qty })), i => `${ksh(i.value)} · ${i.qty} items`)}</div>
        <div class="panel"><h3>Top products</h3>${bars(rep.topProducts.map(p => ({ label: p.name, value: p.revenue, qty: p.qty })), i => `${ksh(i.value)} · ×${i.qty}`)}</div>
        <div class="panel"><h3>Items by status</h3>${bars(STATUS_FLOW.map(s => ({ label: STAT_LABEL[s], value: rep.byStatus[s] || 0 })), i => `${i.value}`)}</div>
      </div>
      <p class="sub" style="margin-top:12px">Revenue is quantity × listed price. It leaves out cancelled items and delivery fees (agreed separately with the customer).</p>`;
    return `<div class="print-title"><h2>KCH Bakery — Sales report</h2><p class="sub">${esc(span)} · by ${basis === 'pickup' ? 'pickup date' : 'date ordered'} · generated ${new Date().toLocaleString('en-KE')} by ${esc(this.staff.name)}</p></div>
      <div class="box no-print"><div class="filter-bar">
        ${chip('today', 'Today')}${chip('7', 'Last 7 days')}${chip('month', 'This month')}${chip('all', 'All time')}
      </div>
      <div class="filter-bar" style="margin-top:10px">
        <div class="field"><label>From</label><input type="date" data-rep="from" value="${from}"></div>
        <div class="field"><label>To</label><input type="date" data-rep="to" value="${to}"></div>
        <div class="field"><label>Count orders by</label><select data-rep="basis"><option value="ordered" ${basis === 'ordered' ? 'selected' : ''}>Date ordered</option><option value="pickup" ${basis === 'pickup' ? 'selected' : ''}>Pickup date</option></select></div>
        <button class="primary" data-csv>⬇ Download CSV</button> <button class="ghost" data-printreport>🖨 Print / Save as PDF</button>
      </div></div>
      <p class="sub">Showing ${esc(span)}.</p>${body}`;
  }
  downloadCsv() {
    const rep = buildReport(this.allOrders(), this.rep);
    const blob = new Blob(['\uFEFF' + rowsToCsv(rep.rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kch-bakery-report-${this.rep.from || 'start'}-to-${this.rep.to || 'today'}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---- Staff Accounts (managers and supervisors). Only managers can reset passwords. ----
  accounts() {
    const me = this.staff, canReset = !!me.canResetPasswords;
    const rows = this.directory.list().map(p => {
      const blocker = this.directory.removeBlocker(me, p.id);
      const reset = !canReset ? '' : this.resettingStaff === p.id
        ? `<input type="text" data-pwinput="${p.id}" placeholder="New password (6+ characters)" style="width:200px"> <button class="primary" data-savepw="${p.id}">Save</button> <button class="ghost" data-cancelpw>Cancel</button>`
        : `<button class="ghost" data-resetpw="${p.id}">Reset password</button>`;
      const remove = blocker ? `<small class="sub">${esc(blocker)}</small>` : `<button class="ghost" data-removestaff="${p.id}">Remove</button>`;
      return `<tr><td>${esc(p.name)}${p.id === me.id ? ' <span class="tag-hidden">You</span>' : ''}</td><td>${esc(p.username)}</td><td>${ROLE_LABEL[p.role]}</td><td class="acct-actions">${reset} ${remove}</td></tr>`;
    }).join('');
    const roles = StaffDirectory.manageableRoles(me.role).map(r => `<option value="${r}" ${r === 'baker' ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('');
    return `<p class="sub">Add or remove the people who can sign in to this staff area.${canReset ? ' If someone forgets their password, reset it here and tell them the new one.' : ' Password resets are done by a manager.'}</p>
      <div class="box"><b>Add a person</b>
        <div class="two"><div><label>Full name</label><input data-sf="name"></div><div><label>Username (they sign in with this)</label><input data-sf="username" autocapitalize="off"></div></div>
        <div class="two"><div><label>Role</label><select data-sf="role">${roles}</select></div><div><label>Starting password (6+ characters)</label><input type="text" data-sf="password"></div></div>
        <p></p><button class="primary" data-addstaff>Add account</button></div>
      <div class="box table-wrap"><table><tr><th>Name</th><th>Username</th><th>Role</th><th></th></tr>${rows}</table></div>`;
  }

  addStaff() {
    const f = k => document.querySelector(`[data-sf="${k}"]`);
    try {
      this.directory.add(this.staff, { name: f('name').value, username: f('username').value, role: f('role').value, password: f('password').value });
      this.show('staff');
    } catch (e) { if (e instanceof StaffError) alert(e.message); else throw e; }
  }

  // ---- Scheduling Rules (manager only, enforced in show()). Nothing here is hardcoded:
  // everything is saved to the shared store and read by the customer site. ----
  rules() {
    const r = getRules(), products = this.catalog.list();
    const dayBoxes = DAYS.map((n, i) => `<label class="chk"><input type="checkbox" data-rf-day="${i}" ${r.hours.closedDays.includes(i) ? 'checked' : ''}> ${n}</label>`).join('');
    const prodRow = p => `<div class="row rule-row"><span><b>${p.emoji} ${p.name}</b>${p.hidden ? ' <span class="tag-hidden">Hidden</span>' : ''}<br>
      <small class="sub">${describeTiers(r.productLead?.[p.id])}</small></span>
      <textarea data-rf-plead="${p.id}" rows="2" placeholder="blank = no notice needed">${tiersToText(r.productLead?.[p.id])}</textarea></div>`;
    const prodGroups = CATEGORIES.map(c => {
      const list = products.filter(p => p.category === c);
      return list.length ? `<p class="sub"><b>${c[0].toUpperCase() + c.slice(1)}</b></p>${list.map(prodRow).join('')}` : '';
    }).join('');
    return `<p class="sub">You decide when customers can collect and how much notice each product needs. The customer site follows these rules.</p>
      <div class="box"><b>Opening hours and days off</b>
        <div class="two"><div><label>Opens (hour, 0–23)</label><input type="number" min="0" max="23" data-rf="open" value="${r.hours.open}"></div>
        <div><label>Closes (hour, 1–24)</label><input type="number" min="1" max="24" data-rf="close" value="${r.hours.close}"></div></div>
        <label>No pickups on these days of the week</label><div>${dayBoxes}</div>
        <label>Other closed dates (one per line, YYYY-MM-DD, e.g. 2026-12-25)</label><textarea data-rf="closedDates" rows="3">${(r.closedDates || []).join('\n')}</textarea></div>
      <div class="box"><b>Daily capacity</b><p class="sub">The most orders accepted for one pickup day. Full days are greyed out for customers.</p>
        <input type="number" min="1" data-rf="capacity" value="${r.dailyCapacity}"></div>
      <div class="box"><b>Notice needed — for each product</b>
        <p class="sub">Decide how much notice every product needs. One line per rule, written as <code>more than, days</code>. Example: <code>30, 1</code> means more than 30 of this product need 1 day's notice. Use <code>0, 1</code> for "always 1 day". Leave blank if no notice is needed (same-day pickup).</p>
        ${prodGroups || '<p class="sub">No products yet.</p>'}</div>
      <button class="primary" data-saverules>Save rules</button> <button class="ghost" data-resetrules>Reset to defaults</button>`;
  }

  saveRulesForm() {
    const q = a => document.querySelector(a), f = k => q(`[data-rf="${k}"]`);
    const open = Number(f('open').value), close = Number(f('close').value), capacity = Number(f('capacity').value);
    if (!(open >= 0 && close <= 24 && open < close)) { alert('Opening hour must be earlier than closing hour.'); return; }
    if (!(capacity >= 1)) { alert('Daily capacity must be at least 1.'); return; }
    const bad = [], productLead = {};
    document.querySelectorAll('[data-rf-plead]').forEach(box => {
      const { tiers, errors } = parseTiers(box.value);
      errors.forEach(e => bad.push(`${box.dataset.rfPlead}: "${e}"`));
      if (tiers.length) productLead[box.dataset.rfPlead] = tiers;
    });
    if (bad.length) { alert('Please fix these lines (use “more than, days”, like 30, 1):\n\n' + bad.join('\n')); return; }
    const closedDays = [...document.querySelectorAll('[data-rf-day]')].filter(b => b.checked).map(b => Number(b.dataset.rfDay));
    saveRules({ productLead, hours: { open, close, closedDays }, closedDates: parseDates(f('closedDates').value), dailyCapacity: capacity });
    alert('Saved. The customer site will follow these rules.');
    this.show('rules');
  }

  // ---- Menu Management (manager only, enforced in show()) ----
  menu() {
    const products = this.catalog.list();
    const rows = products.map(p => this.editingProduct === p.id ? this.productForm(p) : `
      <div class="box product-row">
        <div class="product-row-head">
          <div><b>${p.emoji} ${p.name}</b> <span class="sub">(${p.category})</span>${p.hidden ? ' <span class="tag-hidden">Hidden from customers</span>' : ''}</div>
          <span><label class="sub chk"><input type="checkbox" data-visible="${p.id}" ${p.hidden ? '' : 'checked'}> Show on customer menu</label>
          <label class="sub chk"><input type="checkbox" data-soldout="${p.id}" ${p.soldOut ? 'checked' : ''}> Sold out</label></span>
        </div>
        ${p.sizes.map(s => `<div class="row"><span>${s.label}</span><span>${ksh(s.price)}</span></div>`).join('')}
        ${p.flavours.length ? `<p class="sub">Flavours: ${p.flavours.join(', ')}</p>` : ''}
        <button class="ghost" data-editproduct="${p.id}">Edit</button>
        <button class="ghost" data-deleteproduct="${p.id}">Delete</button>
      </div>`).join('');
    return `<p class="sub">Add, edit and price products. Untick “Show on customer menu” to hide an item without deleting it; tick “Sold out” to keep it visible but not orderable. Changes appear on the customer site immediately.</p>
      ${this.editingProduct === 'new' ? this.productForm(null) : `<button class="primary" data-newproduct>+ Add new product</button>`}
      ${rows}`;
  }

  productForm(p) {
    const id = p?.id || '';
    const sizes = p?.sizes || [{ id: 'std', label: 'Standard', price: 0 }];
    return `<div class="box product-form">
      <b>${p ? 'Edit product' : 'New product'}</b>
      <label>Name</label><input data-pf="name" value="${p?.name || ''}">
      <div class="two"><div><label>Emoji</label><input data-pf="emoji" value="${p?.emoji || '🍞'}"></div>
      <div><label>Category</label><select data-pf="category"><option value="bread" ${p?.category === 'bread' ? 'selected' : ''}>bread</option><option value="cake" ${p?.category === 'cake' ? 'selected' : ''}>cake</option><option value="pastry" ${!p || p.category === 'pastry' ? 'selected' : ''}>pastry</option></select></div></div>
      <label>Description</label><input data-pf="desc" value="${p?.desc || ''}">
      <label>Ingredients (comma-separated)</label><input data-pf="ingredients" value="${(p?.ingredients || []).join(', ')}">
      <label>Allergens (comma-separated)</label><input data-pf="allergens" value="${(p?.allergens || []).join(', ')}">
      <label>Flavours (comma-separated, leave blank if none)</label><input data-pf="flavours" value="${(p?.flavours || []).join(', ')}">
      <label><input type="checkbox" data-pf="custom" ${p?.custom ? 'checked' : ''}> Needs the multi-cake wizard (size/flavour/message per unit)</label>
      <label><input type="checkbox" data-pf="visible" ${p?.hidden ? '' : 'checked'}> Show on customer menu</label>
      <label>Sizes (one per line: label, price)</label>
      <textarea data-pf="sizes" rows="3">${sizes.map(s => `${s.label}, ${s.price}`).join('\n')}</textarea>
      <p></p><button class="primary" data-saveproduct="${id}">Save</button> <button class="ghost" data-canceledit>Cancel</button>
    </div>`;
  }

  saveProductForm(existingId) {
    const f = s => document.querySelector(`[data-pf="${s}"]`);
    const name = f('name').value.trim();
    if (!name) { alert('Name is required.'); return; }
    const id = existingId || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `p${Date.now()}`;
    const sizes = f('sizes').value.split('\n').map(l => l.trim()).filter(Boolean).map((l, i) => {
      const [label, price] = l.split(',').map(x => x.trim());
      return { id: `s${i}`, label: label || `Size ${i + 1}`, price: Number(price) || 0 };
    });
    if (!sizes.length) { alert('Add at least one size.'); return; }
    const existing = this.catalog.get(id);
    const product = new Product({
      id, name, emoji: f('emoji').value.trim() || '🍞', category: f('category').value,
      desc: f('desc').value.trim(),
      ingredients: f('ingredients').value.split(',').map(x => x.trim()).filter(Boolean),
      allergens: f('allergens').value.split(',').map(x => x.trim()).filter(Boolean),
      flavours: f('flavours').value.split(',').map(x => x.trim()).filter(Boolean),
      custom: f('custom').checked, soldOut: existing?.soldOut || false, hidden: !f('visible').checked, sizes,
    });
    this.catalog.save(product);
    this.editingProduct = null;
    this.show('menu');
  }

  onClick(e) {
    if (!this.stillSignedIn()) return;
    if (!e.target.closest('.bell-wrap')) $('#notif-panel').hidden = true;   // click anywhere else closes the bell
    const d = e.target.closest('button')?.dataset; if (!d) return;
    if (d.bell !== undefined) this.toggleBell();
    else if (d.markall !== undefined) { const seen = this.loadSeen(); this.notifications().forEach(n => seen.add(n.id)); this.saveSeen(seen); this.refreshBell(); }
    else if (d.notif) {
      const seen = this.loadSeen(); seen.add(d.notif); this.saveSeen(seen);
      $('#notif-panel').hidden = true;
      if (d.view === 'queue') this.filters = { status: '', category: '', date: '' };
      this.show(d.view || 'queue');
    }
    else if (d.cardstatus) { this.filters.status = this.filters.status === d.cardstatus ? '' : d.cardstatus; this.show('queue'); }
    else if (d.range) { this.rep = { ...this.rep, range: d.range, ...this.rangeDates(d.range) }; this.show('reports'); }
    else if (d.csv !== undefined) { if (this.staff.isManager) this.downloadCsv(); }
    else if (d.printreport !== undefined) window.print();
    else if (d.item) { const [category, key] = d.item.split('|'); this.prodItem = { category, key: decodeURIComponent(key) }; this.show('item'); }
    else if (d.lineadvance) {
      const [serial, lineId] = d.lineadvance.split('|');
      this.repo.updateLineStatus(serial, lineId, nextStatus(this.repo.get(serial).lines.find(l => l.id === lineId).status));
      this.show('item');
    }
    else if (d.cancel) { if (confirm(`Cancel order ${d.cancel}? This cancels every item in it.`)) { this.repo.cancelOrder(d.cancel); this.show('queue'); } }
    else if (d.addstaff !== undefined) { this.addStaff(); }
    else if (d.removestaff) {
      const id = Number(d.removestaff), who = this.directory.byId(id);
      if (who && confirm(`Remove ${who.name}? They will no longer be able to sign in.`)) {
        try { this.directory.remove(this.staff, id); } catch (err) { if (err instanceof StaffError) alert(err.message); else throw err; }
        this.show('staff');
      }
    }
    else if (d.resetpw) { this.resettingStaff = Number(d.resetpw); this.show('staff'); }
    else if (d.cancelpw !== undefined) { this.resettingStaff = null; this.show('staff'); }
    else if (d.savepw) {
      const id = Number(d.savepw), who = this.directory.byId(id);
      try {
        this.directory.resetPassword(this.staff, id, document.querySelector(`[data-pwinput="${id}"]`).value);
        this.resettingStaff = null;
        alert(`Password changed for ${who ? who.name : 'this account'}. Tell them the new password.`);
        this.show('staff');
      } catch (err) { if (err instanceof StaffError) alert(err.message); else throw err; }
    }
    else if (d.saverules !== undefined) { this.saveRulesForm(); }
    else if (d.resetrules !== undefined) { if (confirm('Reset every scheduling rule to the original defaults?')) { saveRules(DEFAULT_RULES); this.show('rules'); } }
    else if (d.newproduct !== undefined) { this.editingProduct = 'new'; this.show('menu'); }
    else if (d.editproduct) { this.editingProduct = d.editproduct; this.show('menu'); }
    else if (d.canceledit !== undefined) { this.editingProduct = null; this.show('menu'); }
    else if (d.saveproduct !== undefined) { this.saveProductForm(d.saveproduct || null); }
    else if (d.deleteproduct) { if (confirm(`Delete this product from the menu? This cannot be undone.`)) { this.catalog.remove(d.deleteproduct); this.show('menu'); } }
    else if (d.v) this.show(d.v);
  }
  onChange(e) {
    if (!this.stillSignedIn()) return;
    if (e.target.dataset.filter) { this.filters[e.target.dataset.filter] = e.target.value; this.show('queue'); }
    else if (e.target.dataset.rep) { this.rep = { ...this.rep, [e.target.dataset.rep]: e.target.value, range: e.target.dataset.rep === 'basis' ? this.rep.range : 'custom' }; this.show('reports'); }
    else if (e.target.id === 'prod-date') { this.prodDate = e.target.value; this.show('production'); }
    else if (e.target.dataset.soldout) { this.catalog.setSoldOut(e.target.dataset.soldout, e.target.checked); this.show('menu'); }
    else if (e.target.dataset.visible) { this.catalog.setHidden(e.target.dataset.visible, !e.target.checked); this.show('menu'); }
  }
}

const directory = new LocalStaffDirectory();
const auth = new AuthService(directory, new LocalSessionStore());
const staff = auth.current();
if (!staff) location.href = 'index.html';
else new StaffApp(staff, directory, auth);