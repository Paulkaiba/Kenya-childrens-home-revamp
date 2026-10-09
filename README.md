# Kenya Children's Homes — Kelvin Loaf Bakery Revamp

An online ordering system for **Kelvin Loaf Bakery**, an income-generating project of [Kenya Children's Homes (KCH)](https://kch.co.ke). Customers can browse the bakery's products and place orders online, and the bakery team manages production, scheduling and reports from a staff app. This was our group's redesign of the bakery's web presence.

<!-- [Landing page](docs/screenshots/landing.png)
![Customer ordering](docs/screenshots/ordering.png)
![Staff dashboard](docs/screenshots/staff-dashboard.png)
-->

## What's inside

| App | Path | Purpose |
|---|---|---|
| Landing page | `Landing/` | Introduces the bakery, its products and contact details |
| Customer app | `Bakery/` | Browse the catalogue, build an order and check out |
| Staff app | `Staff/` | Run the bakery day to day, with role-based access |

## Features

**Customers**
- Product catalogue (breads, cakes, pastries) with sizes, flavours and allergen information
- Custom cake ordering
- Pickup or delivery, with a pickup time per product category
- Order serial numbers (e.g. `KBK-20261004-0001`) and a request-to-cancel option

**Bakery rules**
- Minimum notice time per product, depending on order size
- Opening hours, closed days and closed dates
- Daily order capacity, so full days stop accepting orders

**Staff**
- Three roles: **manager**, **supervisor** and **baker**
- Order workflow: Received → Baking → Ready → Collected (or Delivered)
- Production summary by day and category
- Approve or reject cancellation requests
- Notification bell for items that need attention
- Manage products, mark items sold out or hidden, and edit scheduling rules
- Manager-only reports with CSV export
- Add and remove staff accounts, with permissions that depend on role

## Tech stack

- Vanilla JavaScript (ES modules), HTML and CSS, with no framework
- Browser `localStorage` as a shared data store (`shared/store.js`), so the customer and staff apps see the same data
- Node.js built-in test runner

## Getting started

**Requirements:** Node.js 18+ and any static file server.

```bash
git clone https://github.com/Paulkaiba/Kenya-childrens-home-revamp.git
cd Kenya-childrens-home-revamp

# serve from the repo root, on port 5500, so both apps share localStorage
npx serve -l 5500 .
```

Then open:
- Landing page: `http://localhost:5500/Landing/`
- Customer app: `http://localhost:5500/Bakery/`
- Staff app: `http://localhost:5500/Staff/`

**Demo staff logins** (prototype data only)

| Role | Username | Password |
|---|---|---|
| Manager | `amina` | `manager123` |
| Supervisor | `supervisor` | `super123` |
| Baker | `peter` | `baker123` |

## Running the tests

```bash
npm test
```

The suite covers ordering rules, scheduling and capacity, staff accounts and permissions, and reports.

## Project structure

```
Landing/   Public landing page
Bakery/    Customer ordering app
Staff/     Staff app (login and dashboard)
shared/    Shared data store and data-shape docs (DATA_SHAPES.md)
Styles/    Stylesheets for the customer and staff apps
tests/     Unit tests
```

## Status and limitations

**In development.** The apps currently run as a front-end prototype: data is stored in the browser and staff passwords are kept in plain text for demonstration only.

Next steps:
- [ ] Connect a database so orders, products and staff accounts are stored on a server
- [ ] Hash staff passwords and add server-side authentication
- [ ] Deploy the customer and staff apps

## Team

- **Paul Kaiba** — [@Paulkaiba](https://github.com/Paulkaiba)
- **Nyaga Gacheru** — [@NyagaGacheru](https://github.com/NyagaGacheru)

## License

[MIT](LICENSE)
