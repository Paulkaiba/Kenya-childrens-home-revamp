import { policyFromRules, Cart, Customer, Scheduler, Clock, OrderService, LocalStorageOrderRepository, LocalStorageProductRepository, ValidationError } from './domain.js';
import { initStore, getRules, isDayFull, onDataChange } from '../../shared/store.js';

initStore();

const $ = s => document.querySelector(s);
const ksh = n => 'Ksh ' + n.toLocaleString();
const when = d => new Date(d).toLocaleString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const CATEGORY_LABELS = { bread: 'Bread', cake: 'Cakes', pastry: 'Pastries' };
const bucketLabel = b => CATEGORY_LABELS[b] || b;
const lineSummary = o => {
  const sts = (o.lines || []).map(l => l.status || o.status);
  const uniq = [...new Set(sts)];
  return uniq.length <= 1 ? (uniq[0] || o.status) : o.lines.map(l => `${l.name}: ${l.status}`).join('<br>');
};

class CalendarPicker {
  constructor(scheduler, onPick) { Object.assign(this, { scheduler, onPick, day: null }); }
  open(bucket, lead) {
    const n = this.scheduler.clock.now();
    Object.assign(this, { bucket, lead, day: null, month: new Date(n.getFullYear(), n.getMonth(), 1) });
    this.render(); $('#modal').hidden = false;
  }
  close() { $('#modal').hidden = true; }
  render() {
    const y = this.month.getFullYear(), m = this.month.getMonth();
    let cells = '<i></i>'.repeat(new Date(y, m, 1).getDay());
    for (let d = 1, n = new Date(y, m + 1, 0).getDate(); d <= n; d++) {
      const day = new Date(y, m, d), sel = this.day && +this.day === +day ? 'sel' : '';
      cells += `<button class="day ${sel}" data-d="${d}" ${this.scheduler.isOpenDay(day, this.lead) ? '' : 'disabled'}>${d}</button>`;
    }
    const slots = this.day ? this.scheduler.slots(this.day, this.lead).map(t => `<button class="slot" data-t="${+t}">${t.getHours()}:00</button>`).join('') : '<p>Choose a day, then a time.</p>';
    $('#modal-body').innerHTML = `<b>${bucketLabel(this.bucket)}</b><div class="cal-head"><button data-nav="-1">‹</button><b>${this.month.toLocaleString('en', { month: 'long', year: 'numeric' })}</b><button data-nav="1">›</button></div><div class="grid">${[...'SMTWTFS'].map(x => `<small>${x}</small>`).join('')}${cells}</div><div class="slots">${slots}</div>`;
  }
  click(e) {
    const d = e.target.dataset;
    if (d.nav) { this.month.setMonth(this.month.getMonth() + +d.nav); this.render(); }
    else if (d.d) { this.day = new Date(this.month.getFullYear(), this.month.getMonth(), +d.d); this.render(); }
    else if (d.t) { this.close(); this.onPick(this.bucket, new Date(+d.t)); }
  }
}

class App {
  constructor() {
    const clock = new Clock();
    this.cart = new Cart(); this.policy = policyFromRules(getRules()); this.scheduler = new Scheduler(clock);
    this.catalog = new LocalStorageProductRepository();   // products: staff Menu Management edits these (sold out, prices...)
    this.service = new OrderService(new LocalStorageOrderRepository(), this.scheduler, this.policy, clock);
    this.loadRules();
    this.picker = new CalendarPicker(this.scheduler, (bucket, d) => { this.form.whenByBucket[bucket] = d; this.show(this.currentView); });
    this.form = { fulfilment: 'pickup', whenByBucket: {} }; this.lookup = {}; this.pending = null;
    // View names are resolved through this map (not this[v]()) so they never collide
    // with same-named instance properties like this.cart.
    this.screens = { menu: this.menu, product: this.product, cart: this.cartScreen, checkout: this.checkout, done: this.done, orders: this.orders };
    document.addEventListener('click', e => this.onClick(e));
    document.addEventListener('input', e => {
      if (e.target.dataset.unit !== undefined) { this.pending.units[+e.target.dataset.unit][e.target.dataset.field] = e.target.value; return; }
      if (e.target.name) this.form[e.target.name] = e.target.value;
    });
    document.addEventListener('change', e => {
      if (e.target.dataset.unit !== undefined) { this.pending.units[+e.target.dataset.unit][e.target.dataset.field] = e.target.value; this.show('product'); return; }
      if (e.target.name === 'fulfilment') this.show('checkout');
      if (e.target.name === 'size' || e.target.name === 'flavour') { this.pending[e.target.name] = e.target.value; this.show('product'); }
    });
    $('#modal-body').addEventListener('click', e => this.picker.click(e));
    // Live updates: when staff change an order, product or rule in another tab.
    onDataChange(() => {
      this.loadRules();
      if (!$('#modal').hidden) this.picker.render();
      else if (['menu', 'orders'].includes(this.currentView)) this.show(this.currentView);
    });
    this.show('menu');
  }

  // Pull the latest opening hours, closed dates, lead times and capacity from the shared store.
  loadRules() {
    const r = getRules();
    this.policy = policyFromRules(r);
    this.service.policy = this.policy;
    Object.assign(this.scheduler, {
      open: r.hours.open, close: r.hours.close, closedDays: r.hours.closedDays,
      closedDates: r.closedDates, isFull: d => isDayFull(d),
    });
  }

  // Cart badge always reflects true state first; rendering errors then show a
  // recoverable message instead of silently leaving the old screen in place.
  show(v) {
    this.currentView = v;
    document.querySelectorAll('.side button').forEach(b => b.classList.toggle('active', b.dataset.v === (v === 'product' ? 'menu' : v)));
    $('#cart-count').textContent = this.cart.count;
    $('#fab-count').textContent = this.cart.count;
    $('#fab-cart').hidden = this.cart.isEmpty || ['cart', 'checkout', 'done'].includes(v);
    try {
      $('#view').innerHTML = this.screens[v].call(this);
    } catch (err) {
      console.error(err);
      $('#view').innerHTML = `<div class="box"><b>Something went wrong showing this page.</b><p class="sub">${err.message}</p><button class="primary" data-v="menu">Back to menu</button></div>`;
    }
  }
  findProduct(id) { return this.catalog.get(id); }
  dateButton(bucket, lead) {
    const picked = this.form.whenByBucket[bucket];
    return `<label>Date and time needed — ${bucketLabel(bucket)}</label><button class="ghost" data-cal="${bucket}">${picked ? when(picked) : 'Choose date and time'}</button>${lead ? `<div class="note">${bucketLabel(bucket)} need ${lead / 24} day${lead > 24 ? 's' : ''} notice.</div>` : ''}`;
  }

  menu() {
    const cards = this.catalog.list().filter(p => !p.hidden).map(p => `<div class="card">${p.soldOut ? '<span class="soldout-badge">Sold out</span>' : ''}<div class="emoji">${p.emoji}</div><b>${p.name}</b><div class="price">From ${ksh(p.fromPrice)}</div><small>${p.desc}</small>${p.soldOut ? '<button class="ghost" disabled>Sold out</button>' : `<button class="primary" data-order="${p.id}">Order</button>`}</div>`).join('');
    return `<h2>Menu</h2><p class="sub">Pick a product to see sizes, flavours and allergens before you order.</p><div class="cards">${cards}</div>`;
  }

  openProduct(id) {
    const p = this.findProduct(id);
    if (!p || p.soldOut) return this.show('menu');
    this.pending = p.custom
      ? { product: p, step: 'qty', qty: 1, units: null }
      : { product: p, size: p.sizes[0].id, flavour: p.flavours[0] || '', qty: 1 };
    this.show('product');
  }

  product() {
    return this.pending.product.custom ? this.cakeWizard() : this.simpleProduct();
  }

  simpleProduct() {
    const s = this.pending, p = s.product, lead = this.policy.hoursForProduct(p.id, s.qty);
    return `<h2>${p.emoji} ${p.name}</h2><p class="sub">${p.desc}</p><div class="two"><div class="box">
      <label>Size</label><select name="size">${p.sizes.map(sz => `<option value="${sz.id}" ${sz.id === s.size ? 'selected' : ''}>${sz.label} — ${ksh(sz.price)}</option>`).join('')}</select>
      ${p.flavours.length ? `<label>Flavour</label><select name="flavour">${p.flavours.map(f => `<option ${f === s.flavour ? 'selected' : ''}>${f}</option>`).join('')}</select>` : ''}
      <label>Quantity</label><div class="qty"><button data-pdec>−</button><span>${s.qty}</span><button data-pinc>+</button></div>
      ${this.dateButton(p.category, lead)}
      <label>Ingredients</label><small>${p.ingredients.join(', ')}</small>
      <label>Allergens</label><small>${p.allergens.join(', ') || 'None listed'}</small>
      </div><div class="box"><b>${p.size(s.size).label}${s.flavour ? ' · ' + s.flavour : ''}</b><div class="row total"><span>×${s.qty}</span><span>${ksh(p.size(s.size).price * s.qty)}</span></div>
      <button class="primary" data-add>Add to order</button><button class="ghost" data-v="menu">Back to menu</button>${this.cart.isEmpty ? '' : ' <button class="ghost" data-v="cart">View cart</button>'}</div></div>`;
  }

  // Step 1: how many cakes. Step 2: each cake's own size, flavour and message.
  // Step 3: date and time for the cakes only — it never affects other items.
  cakeWizard() {
    const s = this.pending, p = s.product;
    if (s.step === 'qty') {
      return `<h2>${p.emoji} ${p.name}</h2><p class="sub">${p.desc}</p><div class="box">
        <label>How many cakes would you like?</label><div class="qty"><button data-pdec>−</button><span>${s.qty}</span><button data-pinc>+</button></div>
        <p></p><button class="primary" data-cakenext>Continue</button> <button class="ghost" data-v="menu">Back to menu</button></div>`;
    }
    if (s.step === 'details') {
      const lead = this.policy.hoursForProduct(p.id, s.qty);
      const units = s.units.map((u, i) => `<div class="box"><b>Cake ${i + 1}</b>
        <label>Size</label><select data-unit="${i}" data-field="size">${p.sizes.map(sz => `<option value="${sz.id}" ${sz.id === u.size ? 'selected' : ''}>${sz.label} — ${ksh(sz.price)}</option>`).join('')}</select>
        <label>Flavour</label><select data-unit="${i}" data-field="flavour">${p.flavours.map(f => `<option ${f === u.flavour ? 'selected' : ''}>${f}</option>`).join('')}</select>
        <label>Message on the cake</label><input data-unit="${i}" data-field="message" value="${u.message || ''}" placeholder="e.g. Happy Birthday Amina"></div>`).join('');
      return `<h2>${p.emoji} ${p.name}</h2><p class="sub">Tell us the size, flavour and message for each cake.</p>
        ${lead ? `<div class="note">Cakes need ${lead / 24} day${lead > 24 ? 's' : ''} notice. This does not affect other items in your order.</div>` : ''}
        ${units}
        <div class="box"><label>Ingredients</label><small>${p.ingredients.join(', ')}</small><label>Allergens</label><small>${p.allergens.join(', ') || 'None listed'}</small></div>
        <p></p><button class="ghost" data-cakeback>‹ Back</button> <button class="primary" data-cakenext>Continue</button></div>`;
    }
    // step === 'when' — this date only governs the cakes.
    const total = s.units.reduce((sum, u) => sum + p.size(u.size).price, 0);
    const lead = this.policy.hoursForProduct(p.id, s.qty);
    return `<h2>${p.emoji} ${p.name}</h2><p class="sub">Choose when you need the cakes.</p><div class="box">
      ${s.units.map((u, i) => `<div class="row"><span>Cake ${i + 1}: ${p.size(u.size).label} · ${u.flavour}${u.message ? ' · “' + u.message + '”' : ''}</span><span>${ksh(p.size(u.size).price)}</span></div>`).join('')}
      <div class="row total"><span>Subtotal</span><span>${ksh(total)}</span></div>
      ${this.dateButton('cake', lead)}
      <p></p><button class="ghost" data-cakeback>‹ Back</button> <button class="primary" data-add>Add to order</button>${this.cart.isEmpty ? '' : ' <button class="ghost" data-v="cart">View cart</button>'}</div>`;
  }

  cakeNext() {
    const s = this.pending;
    if (s.step === 'qty') {
      s.units = Array.from({ length: s.qty }, (_, i) => s.units?.[i] || { size: s.product.sizes[0].id, flavour: s.product.flavours[0], message: '' });
      s.step = 'details';
    } else if (s.step === 'details') s.step = 'when';
    this.show('product');
  }
  cakeBack() {
    this.pending.step = this.pending.step === 'when' ? 'details' : 'qty';
    this.show('product');
  }

  addToCart() {
    const s = this.pending, p = s.product;
    if (p.custom) s.units.forEach(u => this.cart.add(p, u.size, u.flavour, 1, u.message));
    else this.cart.add(p, s.size, s.flavour, s.qty);
    this.show('menu');
  }

  cartScreen() {
    if (this.cart.isEmpty) return `<h2>Your cart</h2><p class="sub">Nothing here yet.</p><button class="primary" data-v="menu">Browse the menu</button>`;
    const lines = this.cart.lines.map(l => `<div class="row"><span>${l.product.name} (${l.size.label}${l.flavour ? ', ' + l.flavour : ''})${l.message ? ' — “' + l.message + '”' : ''} ×${l.qty}</span><span>${ksh(l.qty * l.size.price)}</span></div>`).join('');
    return `<h2>Your cart</h2><div class="box">${lines}<div class="row total"><span>Subtotal</span><span>${ksh(this.cart.subtotal)}</span></div>
      ${this.cart.buckets.map(b => this.dateButton(b, this.cart.leadHoursFor(b, this.policy))).join('')}<p></p>
      <button class="ghost" data-v="menu">Add more items</button> <button class="primary" data-v="checkout">Continue</button></div>`;
  }

  checkout() {
    if (this.cart.isEmpty) return this.cartScreen();
    const f = this.form, isDelivery = f.fulfilment === 'delivery';
    const rows = this.cart.lines.map(l => `<div class="row"><span>${l.product.name} (${l.size.label}${l.flavour ? ', ' + l.flavour : ''})${l.message ? ' — “' + l.message + '”' : ''} ×${l.qty}</span><span>${ksh(l.qty * l.size.price)} <button class="icon-btn" data-remove="${l.key}" title="Remove item" aria-label="Remove item">🗑</button></span></div>`).join('');
    return `<h2>Pre-order form</h2><p class="sub">Add your details and choose when you need the order.</p><button class="ghost" data-v="cart">‹ Back to cart</button><div class="two"><div class="box">
      <label>Full name</label><input name="name" value="${f.name || ''}">
      <div class="two"><div><label>Phone (M-Pesa)</label><input name="phone" placeholder="07XX XXX XXX" value="${f.phone || ''}"></div><div><label>Email</label><input name="email" value="${f.email || ''}"></div></div>
      <label>Pickup or delivery</label><div class="choice"><label><input type="radio" name="fulfilment" value="pickup" ${isDelivery ? '' : 'checked'}> Pickup</label><label><input type="radio" name="fulfilment" value="delivery" ${isDelivery ? 'checked' : ''}> Delivery — price agreed with you after ordering</label></div>
      ${isDelivery ? `<label>Delivery location</label><input name="location" placeholder="Estate, street, landmark" value="${f.location || ''}">` : ''}
      ${this.cart.buckets.map(b => this.dateButton(b, this.cart.leadHoursFor(b, this.policy))).join('')}
      <label>Notes</label><textarea name="notes">${f.notes || ''}</textarea><ul id="errors"></ul></div>
      <div class="box"><b>Order summary</b>${rows}<div class="row total"><span>Total</span><span>${ksh(this.cart.subtotal)}</span></div>${isDelivery ? '<p class="sub">Delivery fee is not included — our manager will contact you by SMS/WhatsApp to agree a delivery price.</p>' : ''}<button class="primary" data-place>Place order via M-Pesa</button></div></div>`;
  }

  place() {
    try {
      const f = this.form;
      this.order = this.service.place(this.cart, new Customer(f.name || '', f.phone || '', f.email || ''), { fulfilment: f.fulfilment, location: f.location || '', whenByBucket: f.whenByBucket, notes: f.notes });
      this.form = { fulfilment: 'pickup', whenByBucket: {} };
      this.show('done');
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      $('#errors').innerHTML = e.list.map(x => `<li>${x}</li>`).join('');
    }
  }

  done() {
    const o = this.order;
    const deliveryNote = o.fulfilment === 'delivery'
      ? `<div class="note">An SMS has been sent to ${o.customer.phone} with a WhatsApp link to agree your delivery price with the bakery (simulated in this prototype).</div>` : '';
    return `<div class="box receipt"><div class="emoji">✅</div><h2>Order confirmed</h2><div class="sub">An M-Pesa prompt is sent to ${o.customer.phone} (simulated in this prototype). Payment is required to confirm the order.</div><div class="serial">${o.serial}</div>${o.lines.map(l => `<div class="row"><span>${l.name} (${l.size}${l.flavour ? ', ' + l.flavour : ''})${l.message ? ' — “' + l.message + '”' : ''} ×${l.qty}</span><span>${ksh(l.qty * l.price)}</span></div>`).join('')}<div class="row total"><span>Total</span><span>${ksh(o.total)}</span></div>${Object.entries(o.pickups).map(([b, t]) => `<div class="row"><span>${bucketLabel(b)} — ${o.fulfilment === 'delivery' ? 'Delivery to ' + o.location : 'Pickup'}</span><span>${when(t)}</span></div>`).join('')}${deliveryNote}<p class="sub">Keep this serial number. Use it with your phone and email to find your order. You can request a cancellation from My Orders at least a day before pickup — note that we do not offer refunds.</p><button class="ghost" data-print>Print receipt</button> <button class="primary" data-v="menu">New order</button></div>`;
  }

  orders() {
    const l = this.lookup, found = l.lphone && l.lemail ? this.service.repo.find(l.lphone, l.lemail) : null;
    const canRequest = o => ['Received', 'Confirmed'].includes(o.status) && !o.cancelRequested;
    const table = found && (found.length ? `<table><tr><th>Serial</th><th>Earliest</th><th>Total</th><th>Status</th><th></th></tr>${found.map(o => `<tr><td>${o.serial}</td><td>${when(o.when)}</td><td>${ksh(o.total)}</td><td>${o.status === 'Cancelled' ? 'Cancelled' : lineSummary(o)}${o.cancelRequested ? '<br><small>Cancellation requested</small>' : ''}</td><td>${canRequest(o) ? `<button class="ghost" data-cancel="${o.serial}">Request cancellation</button>` : ''}</td></tr>`).join('')}</table><p class="sub">To cancel, send a request at least a day before pickup. The bakery will confirm it. We do not offer refunds.</p>` : '<p class="sub">No orders found for these details.</p>');
    return `<h2>My orders</h2><p class="sub">Enter the phone number and email you ordered with.</p><div class="box"><div class="two"><div><label>Phone</label><input name="lphone" value="${l.lphone || ''}"></div><div><label>Email</label><input name="lemail" value="${l.lemail || ''}"></div></div><p></p><button class="primary" data-find>Find my orders</button></div>${table ? `<div class="box">${table}</div>` : ''}`;
  }

  onClick(e) {
    const d = e.target.closest('button')?.dataset; if (!d) return;
    if (d.order) this.openProduct(d.order);
    else if (d.pinc !== undefined) { this.pending.qty++; this.show('product'); }
    else if (d.pdec !== undefined) { this.pending.qty = Math.max(1, this.pending.qty - 1); this.show('product'); }
    else if (d.cakenext !== undefined) this.cakeNext();
    else if (d.cakeback !== undefined) this.cakeBack();
    else if (d.add !== undefined) this.addToCart();
    else if (d.remove) { this.cart.remove(d.remove); this.show(this.currentView === 'checkout' ? 'checkout' : 'cart'); }
    else if (d.v) this.show(d.v);
    else if (d.cal) {
      let lead = this.cart.leadHoursFor(d.cal, this.policy);
      if (this.currentView === 'product') {
        const s = this.pending;
        const pendingLead = this.policy.hoursForProduct(s.product.id, s.qty);
        lead = Math.max(lead, pendingLead);
      }
      this.picker.open(d.cal, lead);
    }
    else if (d.place !== undefined) this.place();
    else if (d.find !== undefined) { this.lookup = { lphone: this.form.lphone, lemail: this.form.lemail }; this.show('orders'); }
    else if (d.cancel) {
      // Cancellation is a request: staff approve it from the staff app.
      if (!confirm('Send a cancellation request to the bakery? Note that we do not offer refunds.')) return;
      try { this.service.requestCancel(d.cancel); } catch (x) { alert(x.message); }
      this.show('orders');
    }
    else if (d.print !== undefined) window.print();
    else if (d.close !== undefined) this.picker.close();
  }
}
new App();