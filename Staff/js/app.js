import { StaffDirectory, AuthService, LocalSessionStore, LocalStorageOrderRepository, LocalStorageProductRepository, Product, flattenLines, filterLines, nextStatus, productionSummary, STATUS_FLOW } from './staffDomain.js';

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
    this.catalog = new LocalStorageProductRepository();
    this.filters = { status: '', category: '', date: '' };
    this.prodDate = today();
    this.prodItem = null; // { category, key } when drilled into one item
    this.editingProduct = null; // product id currently expanded for editing, or 'new'
    const roleLabel = { manager: 'Manager', supervisor: 'Supervisor', baker: 'Baker' }[staff.role] || staff.role;
    $('#who').textContent = `${staff.name} · ${roleLabel}`;
    $('#role-banner').textContent = {
      manager: 'Manager access — full visibility and controls.',
      supervisor: 'Supervisor access — you can view orders and reports, but cannot change order status, menu, rules or staff.',
      baker: 'Baker access — you can view and update orders, but not menu, rules or staff.',
    }[staff.role] || '';
    if (staff.isManager) { const mb = document.querySelector('[data-v="menu"]'); mb.classList.remove('locked'); mb.textContent = 'Menu Management'; }
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
      <td>${this.staff.canUpdateStatus && nextStatus(e.status) ? `<button class="ghost" data-lineadvance="${e.serial}|${e.lineId}">Mark ${nextStatus(e.status)}</button>` : ''}</td></tr>`).join('');
    return `<button class="ghost" data-v="production">‹ Back to Production View</button>
      <h2>${key}</h2><p class="sub">${data.qty} total needed on ${this.prodDate}.</p>
      <div class="box table-wrap"><table><tr><th>Serial</th><th>Customer</th><th>Qty</th><th>Specification</th><th>Status</th><th></th></tr>${rows}</table></div>`;
  }

  // ---- Menu Management (manager only, enforced in go()) ----
  menu() {
    const products = this.catalog.list();
    const rows = products.map(p => this.editingProduct === p.id ? this.productForm(p) : `
      <div class="box product-row">
        <div class="product-row-head">
          <div><b>${p.emoji} ${p.name}</b> <span class="sub">(${p.category})</span></div>
          <label class="sub"><input type="checkbox" data-soldout="${p.id}" ${p.soldOut ? 'checked' : ''}> Sold out</label>
        </div>
        ${p.sizes.map(s => `<div class="row"><span>${s.label}</span><span>${ksh(s.price)}</span></div>`).join('')}
        ${p.flavours.length ? `<p class="sub">Flavours: ${p.flavours.join(', ')}</p>` : ''}
        <button class="ghost" data-editproduct="${p.id}">Edit</button>
        <button class="ghost" data-deleteproduct="${p.id}">Delete</button>
      </div>`).join('');
    return `<h2>Menu Management</h2><p class="sub">Add, edit, price and sell out products — changes appear on the customer site immediately.</p>
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
      custom: f('custom').checked, soldOut: existing?.soldOut || false, sizes,
    });
    this.catalog.save(product);
    this.editingProduct = null;
    this.show('menu');
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
    else if (d.newproduct !== undefined) { this.editingProduct = 'new'; this.show('menu'); }
    else if (d.editproduct) { this.editingProduct = d.editproduct; this.show('menu'); }
    else if (d.canceledit !== undefined) { this.editingProduct = null; this.show('menu'); }
    else if (d.saveproduct !== undefined) { this.saveProductForm(d.saveproduct || null); }
    else if (d.deleteproduct) { if (confirm(`Delete this product from the menu? This cannot be undone.`)) { this.catalog.remove(d.deleteproduct); this.show('menu'); } }
    else if (d.v) this.show(d.v);
  }
  onChange(e) {
    if (e.target.dataset.filter) { this.filters[e.target.dataset.filter] = e.target.value; this.show('queue'); }
    else if (e.target.id === 'prod-date') { this.prodDate = e.target.value; this.show('production'); }
    else if (e.target.dataset.soldout) { this.catalog.setSoldOut(e.target.dataset.soldout, e.target.checked); this.show('menu'); }
  }
}

const auth = new AuthService(new StaffDirectory(), new LocalSessionStore());
const staff = auth.current();
if (!staff) location.href = 'index.html';
else new StaffApp(staff);
