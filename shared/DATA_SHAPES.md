# KCH Bakery: Shared Data

Access data **only** through `shared/store.js`. Serve both apps from the repo root on the same
port (`http://localhost:5500`) so they share localStorage.

## Order (stored in `kch-bakery` as `{ orders: [], seq: {} }`)
```js
{
  serial: 'KBK-20261004-0001',
  status: 'Received',        // Received → Confirmed → Baking → Ready → Collected | Delivered, or Cancelled
  cancelRequested: false,    // customer sets true; status does NOT change
  fulfilment: 'pickup',      // 'pickup' | 'delivery'
  location: '', fee: 0, notes: '', total: 0,
  customer: { name, phone: '2547XXXXXXXX', email },
  lines: [{ name, size, flavour, message, qty, price, bucket }],   // bucket = 'bread'|'cake'|'pastry'
  pickups: { cake: ISO string, bread: ISO string },                // one time per category
  when: ISO string,          // earliest pickup
  createdAt: ISO string, updatedAt: ISO string
}
```
**Cancellation:** staff approve with `updateOrder(serial, { status: 'Cancelled' })`
or reject with `updateOrder(serial, { cancelRequested: false })`. Cancelled orders free up capacity.

## Product (`kch-products`)
`{ id, name, category: 'bread'|'cake'|'pastry', emoji, desc, ingredients[], allergens[],
   flavours[], custom: bool (true = cake wizard), soldOut: bool (visible but not orderable),
   hidden: bool (true = customers never see it; manager still does),
   sizes: [{ id, label, price }] }`

## Rules (`kch-rules`)
`{ productLead: { productId: [{ over, hours }] },     // notice per PRODUCT: more than `over` needs `hours`. No entry = no notice
   hours: { open: 8, close: 18, closedDays: [0] },   // 0 = Sunday
   closedDates: ['YYYY-MM-DD'], dailyCapacity: 20 }`

## store.js functions
`initStore, getProducts, saveProducts, getRules, saveRules, getOrders, updateOrder(serial, changes),
requestCancellation(serial), ordersOnDate('YYYY-MM-DD'), isDayFull(date), onDataChange(cb)`