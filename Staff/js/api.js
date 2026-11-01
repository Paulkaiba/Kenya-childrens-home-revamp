import { Product } from '../../Bakery/js/domain.js';
const apiUrl = name => `/PHP/Staff/${name}`;

export class RemoteStaffRepository {
  constructor() {
    this.db = { orders: [], products: [], staff: [] };
  }
  
  load() { return this.db; }

  async fetchFromServer() {
    const resOrders = await fetch(apiUrl('orders.php'));
    const dataOrders = await resOrders.json();
    if (!dataOrders.ok) throw new Error(dataOrders.error || 'Failed to fetch orders');
    this.db.orders = dataOrders.orders;
    this.db.products = dataOrders.products; 

    const resStaff = await fetch(apiUrl('staff.php'));
    const dataStaff = await resStaff.json();
    if (dataStaff.ok) this.db.staff = dataStaff.staff;
  }
  
    async updateLineStatus(serial, lineId, status) {
    // Add a check to ensure data is valid before sending
    if (!serial || !lineId || !status) {
      console.error("Missing data for update:", { serial, lineId, status });
      throw new Error("Missing data for update. Check console.");
    }

    const res = await fetch(apiUrl('update_status.php'), {
      method: 'POST', 
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ serial, lineId, status })
    });
    
    // Check if the response is valid JSON before parsing
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("Server returned HTML/Error instead of JSON:", text);
      throw new Error("Server crashed. See console.");
    }

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

    async login(username, password) {
    const res = await fetch(apiUrl('login.php'), {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Login failed');
    return data.staff;
  }

  async getCurrentSession() {
    const res = await fetch(apiUrl('login.php'));
    const data = await res.json();
    return data.ok ? data.staff : null;
  }

  async logout() {
    await fetch(apiUrl('logout.php'));
  }

    async addStaff(staffData) {
    const res = await fetch(apiUrl('staff.php'), {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(staffData)
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    await this.fetchFromServer(); // Refresh the cache immediately
    return data;
  }

    async removeStaff(id) {
    const res = await fetch(apiUrl('delete_staff.php'), {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    await this.fetchFromServer();
  }

  async resetPassword(id, password) {
    const res = await fetch(apiUrl('reset_password.php'), {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ id, password })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
  }
}

export class RemoteProductRepository {
  constructor() { this.db = []; }
  async fetchFromServer() {
    const res = await fetch(apiUrl('menu.php'));
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

export class RemoteRulesRepository {
  async fetchFromServer() {
    const res = await fetch(apiUrl('rules.php'));
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Failed to fetch rules');
    return data.rules;
  }
  async save(rules) {
    const res = await fetch(apiUrl('rules.php'), {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ rules })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Save failed');
  }
}