import { StaffDirectory, AuthService, LocalSessionStore, LocalStorageOrderRepository, filterOrders, nextStatus, productionSummary, STATUS_FLOW } from './staffDomain.js';

const $ = s => document.querySelector(s);
const ksh = n => 'Ksh ' + n.toLocaleString();
const when = iso => new Date(iso).toLocaleString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const today = () => new Date().toISOString().slice(0, 10);
// Manager-only sections that exist in the sidebar but aren't built yet — shown
// locked for everyone right now so the role model is visible either way.
const MANAGER_ONLY = ['menu', 'rules', 'staff'];

class StaffApp {
  constructor(staff) {
    this.staff = staff;
    this.repo = new LocalStorageOrderRepository();
    this.filters = { status: '', category: '', date: '' };
    this.prodDate = today();
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
    document.querySelectorAll('.side button').forEach(b => b.classList.toggle('active', b.dataset.v === v));
    $('#view').innerHTML = this[v] ? this[v]() : this.locked();
  }
  locked() { return `<div class="box"><b>Manager access only</b><p class="sub">This section is for managers. It is not built yet in this prototype — next step after the order queue and production view.</p></div>`; }

  allOrders() { return this.repo.load().orders; }

  // ---- Order queue ----
  queue() {
    const f = this.filters, orders = filterOrders(this.allOrders(), { status: f.status || undefined, category: f.category || undefined, date: f.date || undefined })
      .slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const rows = orders.map(o => `<tr>
      <td>${o.serial}</td>
      <td>${o.customer.name}<br><small>${o.customer.phone}</small></td>
      <td>${o.lines.map(l => `${l.name} ×${l.qty}`).join('<br>')}</td>
      <td>${Object.entries(o.pickups || {}).map(([b, t]) => `${b}: ${when(t)}`).join('<br>')}</td>
      <td>${ksh(o.total)}</td>
      <td><span class="status status-${o.status}">${o.status}</span></td>
      <td>${nextStatus(o.status) ? `<button class="ghost" data-advance="${o.serial}">Mark ${nextStatus(o.status)}</button>` : ''}
      ${this.staff.isManager && o.status !== 'Cancelled' ? `<button class="ghost" data-cancel="${o.serial}">Cancel</button>` : ''}</td>
    </tr>`).join('');
    return `<h2>Order Queue</h2><p class="sub">${orders.length} order${orders.length === 1 ? '' : 's'} matching your filters.</p>
      <div class="box"><div class="two">
        <div><label>Status</label><select data-filter="status"><option value="">All</option>${STATUS_FLOW.concat('Cancelled').map(s => `<option ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div><label>Category</label><select data-filter="category"><option value="">All</option>${['bread', 'cake', 'pastry'].map(c => `<option value="${c}" ${f.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div><label>Pickup date</label><input type="date" data-filter="date" value="${f.date}"></div>
      </div></div>
      <div class="box table-wrap"><table><tr><th>Serial</th><th>Customer</th><th>Items</th><th>Pickup</th><th>Total</th><th>Status</th><th></th></tr>${rows || '<tr><td colspan="7" class="sub">No orders match.</td></tr>'}</table></div>`;
  }

  // ---- Production view ----
  production() {
    const summary = productionSummary(this.allOrders(), this.prodDate);
    const card = (label, b) => `<div class="box"><b>${label} — ${b.total} total</b>${Object.entries(b.items).map(([name, qty]) => `<div class="row"><span>${name}</span><span>×${qty}</span></div>`).join('') || '<p class="sub">Nothing scheduled.</p>'}</div>`;
    return `<h2>Production View</h2><p class="sub">What needs to be ready, grouped by category, for the date below.</p>
      <div class="box"><label>Date</label><input type="date" id="prod-date" value="${this.prodDate}"></div>
      ${card('🍞 Bread', summary.bread)}${card('🎂 Cakes', summary.cake)}${card('🥐 Pastries', summary.pastry)}`;
  }

  onClick(e) {
    const d = e.target.closest('button')?.dataset; if (!d) return;
    if (d.advance) { this.repo.update(d.advance, { status: nextStatus(this.repo.get(d.advance).status) }); this.show('queue'); }
    else if (d.cancel) { if (confirm(`Cancel order ${d.cancel}?`)) { this.repo.update(d.cancel, { status: 'Cancelled' }); this.show('queue'); } }
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
