// Loads the menu and the scheduling rules from the PHP API (PostgreSQL).
// If the server cannot be reached, app.js falls back to the browser's own data and says so on screen.
import { ProductRepository } from './domain.js';
import { apiUrl } from '../../shared/api.js';   // where the PHP API lives (PHP/api/)

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
