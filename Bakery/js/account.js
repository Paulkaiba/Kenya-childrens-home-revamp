// Customer accounts + order tracking. Plain ES module, same style as the staff app.
import { startLive } from '../../shared/live.js';

const api = name => `/PHP/Customer/${name}`;
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ksh = n => 'Ksh ' + Number(n).toLocaleString();
const when = iso => new Date(iso).toLocaleString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const BUCKET = { bread: '🍞 Bread', cake: '🎂 Cakes', pastry: '🥐 Pastries' };
const LABELS = {
  pickup:   ['Order received', 'Baking', 'Ready to collect', 'Collected'],
  delivery: ['Order received', 'Baking', 'Ready for delivery', 'Delivered'],
};

async function call(name, body) {
  const res = await fetch(api(name), body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  let d;
  try { d = await res.json(); } catch { throw Object.assign(new Error('Something went wrong. Please try again.'), { status: res.status }); }
  if (!d.ok) throw Object.assign(new Error(d.error || 'Something went wrong.'), { status: res.status });
  return d;
}

let idleTimer = null;
const IDLE_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

function resetIdleTimer() {
  clearTimeout(idleTimer);
  if (Account.customer) {
    idleTimer = setTimeout(() => Account.logout(), IDLE_MS);
  }
}

// Reset the 5-minute timer whenever the user moves the mouse, clicks, types, or scrolls
['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach(evt =>
  document.addEventListener(evt, resetIdleTimer, { passive: true })
);

export const Account = {
  customer: null,
  async init() {
    try { const r = await fetch(api('login.php')); const d = await r.json(); setCustomer(d.ok ? d.customer : null); }
    catch { setCustomer(null); }
    return this.customer;
  },
  async logout() {
    stopLive();
    clearTimeout(idleTimer);
    try { await call('logout.php', {}); } catch { /* ignore network errors on logout */ }
    setCustomer(null);
  },
};

function setCustomer(c) {
  Account.customer = c;
  resetIdleTimer();
  document.dispatchEvent(new CustomEvent('account-changed'));
}


let live = null;
export const stopLive = () => { if (live) live.stop(); live = null; };

// ---------- Sign in / Create account ----------
export function renderAuth(view, onDone, mode = 'in') {
  const up = mode === 'up';
  view.innerHTML = `<h2>${up ? 'Create your account' : 'Sign in'}</h2>
    <p class="sub">${up ? 'Track your orders and confirm when they arrive.' : 'Use your email or your phone number.'}</p>
    <div class="box auth-box">
      <div class="chips"><button class="chip ${up ? '' : 'on'}" data-mode="in">Sign in</button><button class="chip ${up ? 'on' : ''}" data-mode="up">Create account</button></div>
      <form id="auth-form" novalidate>
        ${up ? `<label>Full name</label><input name="name" autocomplete="name">
                <label>Email</label><input name="email" type="email" autocomplete="email">
                <label>Phone number</label><input name="phone" type="tel" autocomplete="tel" placeholder="0712 345 678">`
             : `<label>Email or phone number</label><input name="identifier" autocomplete="username">`}
        <label>Password</label><input name="password" type="password" autocomplete="${up ? 'new-password' : 'current-password'}" ${up ? 'placeholder="At least 8 characters"' : ''}>
        <p class="auth-err" role="alert" hidden></p>
        <p></p><button class="primary" type="submit">${up ? 'Create account' : 'Sign in'}</button>
        ${up ? '' : '<p class="sub"><a href="#" data-forgot>Forgot your password?</a></p>'}
      </form></div>`;
  view.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => renderAuth(view, onDone, b.dataset.mode));
  const forgot = view.querySelector('[data-forgot]');
  if (forgot) forgot.onclick = e => { e.preventDefault(); renderForgot(view, onDone); };
  view.querySelector('#auth-form').onsubmit = async e => {
    e.preventDefault();
    const err = view.querySelector('.auth-err'), btn = e.target.querySelector('button[type=submit]');
    err.hidden = true; btn.disabled = true;
    try {
      const d = await call(up ? 'register.php' : 'login.php', Object.fromEntries(new FormData(e.target)));
      setCustomer(d.customer); onDone(d.customer);
    } catch (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; }
  };
}

// ---------- My Orders: tracker + "it arrived" button, refreshed live ----------
const track = (stage, labels) => `<ol class="track">${labels.map((t, i) =>
  `<li class="${i < stage ? 'done' : i === stage ? (stage === 3 ? 'done' : 'now') : ''}">${t}</li>`).join('')}</ol>`;

const collectionHtml = (o, c) => `<div class="collection">
  <div class="row"><b>${BUCKET[c.bucket] || esc(c.bucket)}</b><span>${c.pickupAt ? (o.fulfilment === 'delivery' ? 'Delivery ' : 'Pickup ') + when(c.pickupAt) : ''}</span></div>
  <small class="sub">${c.lines.map(l => `${l.qty} × ${esc(l.name)} (${esc(l.size)}${l.flavour ? ', ' + esc(l.flavour) : ''})${l.message ? ' — “' + esc(l.message) + '”' : ''}`).join(', ')}</small>
  ${c.stage < 0 ? '<p class="cancelled-note">Cancelled</p>' : track(c.stage, LABELS[o.fulfilment] || LABELS.pickup)}
  <div class="actions">${c.canConfirm
    ? `<button class="primary" data-confirm="${esc(o.serial)}|${esc(c.bucket)}">${o.fulfilment === 'delivery' ? 'My order arrived' : 'I have collected it'}</button>`
    : c.confirmedAt ? `<small class="sub">You confirmed this on ${when(c.confirmedAt)}. Thank you!</small>` : ''}</div>
</div>`;

const orderHtml = o => `<div class="box">
  <div class="order-head"><b class="serial">${esc(o.serial)}</b><small class="sub">Placed ${when(o.createdAt)} · ${ksh(o.total)}${o.cancelRequested ? ' · Cancellation requested' : ''}</small></div>
  ${o.canCancel ? `<div class="actions"><button class="ghost small" data-acct-cancel="${esc(o.serial)}">Request cancellation</button><small class="sub">Ask at least a day before pickup. The bakery confirms it, and we do not offer refunds.</small></div>` : ''}
  ${o.collections.map(c => collectionHtml(o, c)).join('')}</div>`;

export async function renderOrders(view) {
  stopLive();
  const toAuth = () => { stopLive(); renderAuth(view, () => renderOrders(view)); };

  const draw = async () => {
    let d;
    try { d = await call('orders.php'); }
    catch (e) { if (e.status === 401) return toAuth(); view.innerHTML = `<div class="box"><b>Could not load your orders</b><p class="sub">${esc(e.message)}</p></div>`; return; }
    view.innerHTML = `<div class="order-head"><h2>My Orders</h2><button class="ghost small" data-signout>Sign out</button></div>
      <p class="sub">${esc(Account.customer?.name || '')} · this page updates by itself as the bakery works on your order.</p>
      ${verifyBanner()}
      ${d.orders.length ? d.orders.map(orderHtml).join('')
        : '<div class="box"><b>No orders yet</b><p class="sub">When you place an order while signed in, you can follow it here.</p><button class="cta" data-v="menu">Browse the menu</button></div>'}`;
    view.querySelector('[data-signout]').onclick = async () => {
      stopLive(); await call('logout.php', {}); setCustomer(null); toAuth();
    };
    const resend = view.querySelector('[data-resend]');
    if (resend) resend.onclick = async () => {
      resend.disabled = true;
      try { await call('send_verification.php', {}); resend.textContent = 'Email sent. Check your inbox.'; }
      catch (e) { alert(e.message); resend.disabled = false; }
    };
    view.querySelectorAll('[data-confirm]').forEach(b => b.onclick = async () => {
      if (!confirm('Confirm that you have received this part of your order?')) return;
      const [serial, bucket] = b.dataset.confirm.split('|');
      b.disabled = true;
      try { await call('confirm.php', { serial, bucket }); await draw(); }
      catch (e) { alert(e.message); b.disabled = false; }
    });
    view.querySelectorAll('[data-acct-cancel]').forEach(b => b.onclick = async () => {
      if (!confirm('Send a cancellation request to the bakery? Note that we do not offer refunds.')) return;
      b.disabled = true;
      try { await call('request_cancel.php', { serial: b.dataset.acctCancel }); await draw(); }
      catch (e) { alert(e.message); b.disabled = false; }
    });
  };

  await draw();
  if (!Account.customer) return;
  live = startLive({
    url: new URL('../../PHP/Customer/changes.php', import.meta.url),
    intervalMs: 3000,
    onChange: draw,
    onUnauthorized: toAuth,
  });
}

// ---------- Email verification banner, forgot password, reset link, verify link ----------
const verifyBanner = () => Account.customer && !Account.customer.verified
  ? '<div class="note">Verify your email to add your earlier orders to this account. <button class="ghost small" data-resend>Send the email</button></div>' : '';

// NOTE: these forms use id="auth-form" on purpose: app.js ignores typing inside #auth-form, so passwords never reach the checkout form.
export function renderForgot(view, onDone) {
  view.innerHTML = `<h2>Reset your password</h2>
    <p class="sub">Enter your email or phone number. If an account matches, we will email you a link that works for one hour.</p>
    <div class="box auth-box"><form id="auth-form" novalidate>
      <label>Email or phone number</label><input name="identifier" autocomplete="username">
      <p class="auth-err" role="alert" hidden></p>
      <p></p><button class="primary" type="submit">Send reset link</button> <button class="ghost" type="button" data-back>Back to sign in</button>
    </form></div>`;
  view.querySelector('[data-back]').onclick = () => renderAuth(view, onDone, 'in');
  view.querySelector('#auth-form').onsubmit = async e => {
    e.preventDefault();
    const err = view.querySelector('.auth-err'), btn = e.target.querySelector('button[type=submit]');
    err.hidden = true; btn.disabled = true;
    try {
      await call('request_reset.php', Object.fromEntries(new FormData(e.target)));
      view.querySelector('.auth-box').innerHTML = '<b>Check your email</b><p class="sub">If an account matches, we have sent a reset link. It works for one hour. Look in your spam folder if it does not arrive.</p>';
    } catch (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; }
  };
}

export function renderReset(view, token, onDone) {
  view.innerHTML = `<h2>Choose a new password</h2>
    <div class="box auth-box"><form id="auth-form" novalidate>
      <label>New password</label><input name="password" type="password" autocomplete="new-password" placeholder="At least 8 characters">
      <label>Repeat the password</label><input name="again" type="password" autocomplete="new-password">
      <p class="auth-err" role="alert" hidden></p>
      <p></p><button class="primary" type="submit">Save new password</button>
    </form></div>`;
  view.querySelector('#auth-form').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), err = view.querySelector('.auth-err'), btn = e.target.querySelector('button[type=submit]');
    err.hidden = true;
    if (f.password !== f.again) { err.textContent = 'The two passwords do not match.'; err.hidden = false; return; }
    btn.disabled = true;
    try {
      await call('reset_password.php', { token, password: f.password });
      view.innerHTML = '<div class="box auth-box"><b>Password changed</b><p class="sub">You can now sign in with your new password.</p><button class="primary" data-go>Sign in</button></div>';
      view.querySelector('[data-go]').onclick = onDone;
    } catch (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; }
  };
}

export async function renderVerify(view, token, onDone) {
  view.innerHTML = '<p class="sub">Verifying your email…</p>';
  try {
    const d = await call('verify_email.php', { token });
    view.innerHTML = `<div class="box auth-box"><b>Email verified ✅</b><p class="sub">${d.linked ? `We added ${d.linked} earlier order${d.linked === 1 ? '' : 's'} to your account.` : 'Your account is ready.'}</p><button class="primary" data-go>Go to My Orders</button></div>`;
  } catch (e) {
    view.innerHTML = `<div class="box auth-box"><b>Could not verify</b><p class="sub">${esc(e.message)}</p><button class="primary" data-go>Continue</button></div>`;
  }
  view.querySelector('[data-go]').onclick = onDone;
}
