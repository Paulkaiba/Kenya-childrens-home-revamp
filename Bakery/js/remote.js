// Loads the menu and the scheduling rules from the PHP API (PostgreSQL).
// If the server cannot be reached, app.js falls back to the browser's own data and says so on screen.
import { ProductRepository, OrderService, ValidationError } from './domain.js';
import { apiUrl } from '../../shared/api.js';   // where the PHP API lives

async function getJson(name) {
  const res = await fetch(apiUrl(name), { headers: { Accept: 'application/json' }, cache: 'no-store' });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  // PHP prints its own warnings and errors as plain text; show the start of it so the cause is visible in the console.
  if (!body) throw new Error(`${name} did not send JSON (HTTP ${res.status}). It sent: ${text.replace(/\s+/g, ' ').trim().slice(0, 300) || '(nothing at all)'}`);
  if (!res.ok || body.ok === false) throw new Error(body.error || `${name} answered HTTP ${res.status}`);
  return body;
}

// Sends JSON to a PHP endpoint. The server answers { ok: false, errors: [...] } for things the customer can fix: those become ValidationError.
async function postJson(name, payload) {
  const res = await fetch(apiUrl(name), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload), cache: 'no-store' });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (!body) throw new Error(`${name} did not send JSON (HTTP ${res.status}). It sent: ${text.replace(/\s+/g, ' ').trim().slice(0, 300) || '(nothing at all)'}`);
  if (body.ok === false && Array.isArray(body.errors)) throw new ValidationError(body.errors);
  if (!res.ok || body.ok === false) throw new Error(body.error || `${name} answered HTTP ${res.status}`);
  return body;
}

// Same as ProductRepository (list, get, ...) but the products come from the server. Read-only for the customer app.
export class RemoteProductRepository extends ProductRepository {
  constructor(products) { super(); this.db = products; }
  load() { return this.db; }
  persist() { throw new Error('The menu is read-only here: staff Menu Management is connected to the database in a later stage.'); }
  replace(products) { this.db = products; }
}

export async function loadServerData() {
  const [catalog, rules] = await Promise.all([getJson('catalog.php'), getJson('rules.php')]);
  return { products: catalog.products, rules: rules.rules };
}

// Orders through the server: the same checks as OrderService (so mistakes show instantly), then PostgreSQL saves the order.
// The server prices the order itself and makes the order number; it never trusts the browser's prices.
export class RemoteOrderService extends OrderService {
  constructor(scheduler, policy, clock) { super(null, scheduler, policy, clock); }

  async place(cart, customer, { fulfilment = 'pickup', location = '', whenByBucket = {}, notes = '' } = {}) {
    this.check(cart, customer, { fulfilment, location, whenByBucket });
    const { order } = await postJson('place_order.php', {
      customer: { name: customer.name, phone: customer.phone, email: customer.email },
      fulfilment, location, notes,
      lines: cart.lines.map(l => ({ productId: l.product.id, size: l.size.id, flavour: l.flavour || '', message: l.message || '', qty: l.qty })),
      pickups: Object.fromEntries(cart.buckets.map(b => [b, whenByBucket[b].toISOString()])),
    });
    cart.clear();                      // only once the server has really saved the order
    return order;
  }

  // The server shows an order only when the phone number AND the email both match.
  async find(phone, email) { return (await postJson('my_orders.php', { phone, email })).orders; }

  // A cancellation is a request; the server needs the serial, phone and email to all match.
  async requestCancel(serial, phone, email) { return (await postJson('request_cancel.php', { serial, phone, email })).order; }
}
