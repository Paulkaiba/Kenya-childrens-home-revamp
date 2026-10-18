// Staff/js/api.js
// Handles all communication with the PHP/PostgreSQL backend.
import { Product } from '../../Bakery/js/domain.js';

const apiUrl = name => `/PHP/Staff/${name}`;

export class RemoteStaffRepository {
  constructor() {
    this.db = { orders: [], products: [] };
  }
  
  async fetchFromServer() {
    const res = await fetch(apiUrl('orders.php'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Failed to fetch orders');
    this.db.orders = data.orders;
    // Note: we will get products from RemoteProductRepository soon, 
    // but keeping it here for backward compatibility with the old code.
    this.db.products = data.products; 
  }
  
  load() { return this.db; }
  
  async updateLineStatus(serial, lineId, status) {
    const res = await fetch(apiUrl('update_status.php'), {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ serial, lineId, status })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Update failed');
    await this.fetchFromServer();
  }
  
  async cancelOrder(serial) {
    const res = await fetch(apiUrl('cancel_order.php'), {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ serial })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Cancel failed');
    await this.fetchFromServer();
  }
}

export class RemoteProductRepository {
  constructor() { this.db = []; }
  
  async fetchFromServer() {
    const res = await fetch(apiUrl('menu.php'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Failed to fetch products');
    this.db = data.products;
  }
  
  load() { return this.db; }
  list() { return this.db.map(p => new Product(p)); }
  get(id) { const p = this.db.find(p => p.id === id); return p ? new Product(p) : undefined; }
  
  async save(product) {
    const res = await fetch(apiUrl('menu.php'), {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ product })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Save failed');
    await this.fetchFromServer();
  }
  
  async remove(id) {
    const res = await fetch(apiUrl('delete_product.php'), {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Delete failed');
    await this.fetchFromServer();
  }
  
  async setSoldOut(id, soldOut) {
    const p = this.get(id);
    if (p) { p.soldOut = soldOut; await this.save(p); }
  }
  
  async setHidden(id, hidden) {
    const p = this.get(id);
    if (p) { p.hidden = hidden; await this.save(p); }
  }
}
