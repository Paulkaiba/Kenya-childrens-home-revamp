import { StaffDirectory, AuthService, LocalSessionStore, LocalStorageOrderRepository, flattenLines, filterLines, nextStatus, productionSummary, STATUS_FLOW } from './staffDomain.js';

const $ = s => document.querySelector(s);
const ksh = n => 'Ksh ' + n.toLocaleString();
const when = iso => new Date(iso).toLocaleString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const today = () => new Date().toISOString().slice(0, 10);
const itemLabel = l => `${l.name} (${l.size}${l.flavour ? ', ' + l.flavour : ''})${l.message ? ' — “' + l.message + '”' : ''}`;
// Manager-only sections that exist in the sidebar but aren't built yet — shown
// locked for everyone right now so the role model is visible either way.
const MANAGER_ONLY = ['menu', 'rules', 'staff'];

class StaffApp {
  constructor(staff) {
    this.staff = staff;
    this.repo = new LocalStorageOrderRepository();
    this.filters = { status: '', category: '', date: '' };
    this.prodDate = today();
    this.prodItem = null; // { category, key } when drilled into one item
    $('#who').textContent = `${staff.name} · ${staff.isManager ? 'Manager' : 'Baker'}`;
    $('#role-banner').textContent = staff.isManager
      ? 'Manager access — full visibility and controls.'
      : 'Baker access — you can view and update orders, but not menu, rules or staff.';
    document.querySelectorAll('.side button').forEach(b => b.addEventListener('click', () => this.go(b.dataset.v)));
    $('#logout').addEventListener('click', e => { e.preventDefault(); new AuthService(new StaffDirectory(), new LocalSessionStore()).logout(); location.href = 'index.html'; });
    document.addEventListener('click', e => this.onClick(e));
    document.addEventListener('change', e => this.onChange(e));
    this.show('queue');
  }
  go(v) {
    if (MANAGER_ONLY.includes(v) && !this.staff.isManager) { alert('Manager access only — ask your manager for this.'); return; }
    this.show(v);
  }
  show(v) {
    document.querySelectorAll('.side button').forEach(b => b.classList.toggle('active', b.dataset.v === (v === 'item' ? 'production' : v)));
    $('#view').innerHTML = this[v] ? this[v]() : this.locked();
  }
  locked() { return `<div class="box"><b>Manager access only</b><p class="sub">This section is for managers. It is not built yet in this prototype — next step after the order queue and production view.</p></div>`; }

  allOrders() { return this.repo.load().orders; }

  // ---- Order Queue: one row per item. Status is read-only here — it's set from
  // the Production View drill-down instead, since that's where the baker is
  // actually working through a specific item across every order that needs it. ----
  queue() {
    const f = this.filters;
    const rows = filterLines(flattenLines(this.allOrders()), { status: f.status || undefined, category: f.category || undefined, date: f.date || undefined })
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const seen = new Set();
    const trs = rows.map(r => {
      const firstOfOrder = !seen.has(r.serial); seen.add(r.serial);
      const cancelBtn = firstOfOrder && this.staff.isManager && r.orderStatus !== 'Cancelled'
        ? `<button class="ghost" data-cancel="${r.serial}">Cancel order</button>` : '';
      return `<tr><td>${r.serial}</td><td>${r.customer.name}<br><small>${r.customer.phone}</small></td>
        <td>${itemLabel(r)} ×${r.qty}</td><td>${r.pickup ? when(r.pickup) : '—'}</td><td>${ksh(r.qty * r.price)}</td>
        <td><span class="status status-${r.status}">${r.status}</span></td><td>${cancelBtn}</td></tr>`;
    }).join('');
    return `<h2>Order Queue</h2><p class="sub">${rows.length} item${rows.length === 1 ? '' : 's'} matching your filters. Update status from Production View.</p>
      <div class="box"><div class="two">
        <div><label>Status</label><select data-filter="status"><option value="">All</option>${STATUS_FLOW.concat('Cancelled').map(s => `<option ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div><label>Category</label><select data-filter="category"><option value="">All</option>${['bread', 'cake', 'pastry'].map(c => `<option value="${c}" ${f.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div><label>Pickup date</label><input type="date" data-filter="date" value="${f.date}"></div>
      </div></div>
      <div class="box table-wrap"><table><tr><th>Serial</th><th>Customer</th><th>Item</th><th>Pickup</th><th>Price</th><th>Status</th><th></th></tr>${trs || '<tr><td colspan="7" class="sub">No items match.</td></tr>'}</table></div>`;
  }

  // ---- Production View: category totals, drill into one item variant to see
  // every order that needs it and update status from there. ----
  production() {
    const summary = productionSummary(this.allOrders(), this.prodDate);
    const card = (label, category, b) => `<div class="box"><b>${label} — ${b.total} total</b>${Object.entries(b.items).map(([name, v]) => `<button class="item-row" data-item="${category}|${encodeURIComponent(name)}"><span>${name}</span><span>×${v.qty} ›</span></button>`).join('') || '<p class="sub">Nothing scheduled.</p>'}</div>`;
    return `<h2>Production View</h2><p class="sub">What needs to be ready, grouped by category, for the date below. Click an item to see each order and set its status.</p>
      <div class="box"><label>Date</label><input type="date" id="prod-date" value="${this.prodDate}"></div>
      ${card('🍞 Bread', 'bread', summary.bread)}${card('🎂 Cakes', 'cake', summary.cake)}${card('🥐 Pastries', 'pastry', summary.pastry)}`;
  }

  item() {
    const { category, key } = this.prodItem;
    const bucket = productionSummary(this.allOrders(), this.prodDate)[category];
    const data = bucket.items[key];
    if (!data) return `<p class="sub">This item is no longer scheduled for this date.</p><button class="ghost" data-v="production">‹ Back to Production View</button>`;
    const rows = data.entries.map(e => `<tr><td>${e.serial}</td><td>${e.customer}</td><td>×${e.qty}</td><td>${e.message ? '“' + e.message + '”' : '—'}</td>
      <td><span class="status status-${e.status}">${e.status}</span></td>
      <td>${nextStatus(e.status) ? `<button class="ghost" data-lineadvance="${e.serial}|${e.lineId}">Mark ${nextStatus(e.status)}</button>` : ''}</td></tr>`).join('');
    return `<button class="ghost" data-v="production">‹ Back to Production View</button>
      <h2>${key}</h2><p class="sub">${data.qty} total needed on ${this.prodDate}.</p>
      <div class="box table-wrap"><table><tr><th>Serial</th><th>Customer</th><th>Qty</th><th>Specification</th><th>Status</th><th></th></tr>${rows}</table></div>`;
  }

  onClick(e) {
    const d = e.target.closest('button')?.dataset; if (!d) return;
    if (d.item) { const [category, key] = d.item.split('|'); this.prodItem = { category, key: decodeURIComponent(key) }; this.show('item'); }
    else if (d.lineadvance) {
      const [serial, lineId] = d.lineadvance.split('|');
      this.repo.updateLineStatus(serial, lineId, nextStatus(this.repo.get(serial).lines.find(l => l.id === lineId).status));
      this.show('item');
    }
    else if (d.cancel) { if (confirm(`Cancel order ${d.cancel}? This cancels every item in it.`)) { this.repo.cancelOrder(d.cancel); this.show('queue'); } }
    else if (d.v) this.show(d.v);
  }
  onChange(e) {
    if (e.target.dataset.filter) { this.filters[e.target.dataset.filter] = e.target.value; this.show('queue'); }
    else if (e.target.id === 'prod-date') { this.prodDate = e.target.value; this.show('production'); }
  }
}

const auth = new AuthService(new StaffDirectory(), new LocalSessionStore());
const staff = auth.current();
if (!staff) location.href = 'index.html';
else new StaffApp(staff);
