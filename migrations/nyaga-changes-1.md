# Customer accounts and order tracking (Nyaga)

Customers can now register, sign in, follow their orders live, confirm arrival,
request a cancellation, reset a forgotten password and verify their email.
Guest ordering and the phone + email "My orders" lookup still work as before.

## Before merging or deploying

1. Run the two files in `migrations/`, in order (001, then 002), on the live database as `postgres`.
2. Set the environment variable `KCH_BASE_URL` to the real site address (for example `https://bakery.example.org`).
   Email links are built from it. It defaults to `http://localhost:8000`.
3. `PHP/config/mailer.php` holds the Gmail password in the file. Make sure the real password is not in Git.
   If it was ever committed, revoke that Gmail app password and create a new one.
4. In `PHP/Customer/_boot.php`, the `set_exception_handler` block returns the PHP error message to the browser.
   Change the message to a generic "Server error" before going live.
5. `PHP/api/status.php` prints a staff test login. Remove it or protect it before going live.
6. Needs PHP 8.1 or newer (the code uses the `never` return type) and the `pdo_pgsql` extension.

## What was added

**Database** (`migrations/`)
- `customer` table (name, email, phone, password hash, `email_verified_at`).
- `customer_order.customer_id` links an order to an account. It stays empty for guest orders.
- `order_pickup.customer_confirmed_at` records when the customer confirmed a collection.
- `customer_token` stores hashed one-time tokens for email verification and password reset.

**New PHP, in `PHP/Customer/`**
- `_boot.php`: shared setup. Reuses `Bakery/_init.php` for `db()`, `json_out()`, `kch_read_json()`, `kch_require_post()`, `kch_throttle()`.
- `register.php`, `login.php` (GET = who is signed in, POST = sign in), `logout.php`.
- `orders.php`: the signed-in customer's orders, grouped by collection (bread / cake / pastry), with a tracker stage.
- `confirm.php`: the customer confirms a collection arrived.
- `request_cancel.php`: the customer asks to cancel.
- `changes.php`: tiny "has anything changed?" check used for live updates.
- `_mail.php`, `request_reset.php`, `reset_password.php`, `send_verification.php`, `verify_email.php`.

**New front end**
- `Bakery/js/account.js`: sign-in / create account, My Orders tracker, forgot password, reset and verify pages.
- `Styles/Bakery/account.css`: styles for the above, using the existing brand variables.

## Existing files changed

- `PHP/Bakery/place_order.php`: after an order is saved, links it to the signed-in customer (taken from the session, never from the browser).
- `PHP/config/mailer.php`: one word. `getMailerInstance()` changed from `private` to `public` so `_mail.php` can reuse the SMTP settings.
- `PHP/Staff/cancle_order.php` renamed to `cancel_order.php`, because `Staff/js/api.js` calls `cancel_order.php`.
- `Bakery/index.html`: loads `account.css`; header now has a Sign in button next to the cart.
- `Bakery/js/app.js`: My Orders shows the account view first and the old phone + email lookup below it (now `guestOrders()`),
  checkout is prefilled for signed-in customers, links from emails (`#reset=...`, `#verify=...`) are handled,
  and the unused `startLive` block at the bottom was removed.

## How it works

- **Sign in:** email or Kenyan phone number (07..., +254..., 7... are all accepted and stored as 254...). Passwords use `password_hash()`.
  The session key is `customer_id`, separate from the staff session. Customer logout only removes that key, so a staff session in the same browser is unaffected.
- **Tracking:** status comes from `order_line.status`, per collection. The page polls `changes.php` every 3 seconds and redraws only when something changed.
- **Confirm:** only when every active line in that collection is `Ready`. It sets those lines to `Collected` (the staff app's final status; the tracker labels it "Delivered" for delivery orders),
  stamps `customer_confirmed_at`, closes the order when all lines are collected, and sends the same feedback email as the staff flow.
- **Cancel request:** same rule as the guest flow (Received/Confirmed, not already requested, at least 24 hours before pickup). Staff approve it as before.
- **Reset and verify:** tokens are random, only the SHA-256 hash is stored, each works once, reset links last 1 hour and verify links 24 hours.
  "Forgot password" always gives the same answer, so it cannot be used to discover accounts.
  Verifying an email also attaches earlier guest orders that used the same email (`customer_id IS NULL`). A password reset counts as proof of the email too.
- All attempts are rate limited with the existing `kch_throttle()`.

## How to test

1. Register, sign out, sign in by phone, sign in by email. A wrong password is refused.
2. Give an account an order, set its lines to `Ready`: the "I have collected it" button appears. Change the status in SQL or the staff app and the tracker follows within about 3 seconds.
3. Confirm: lines become `Collected` and the order closes.
4. Request a cancellation (pickup more than 24 hours away). The staff bell shows it, and approving it shows Cancelled on the customer side.
5. Forgot password: the emailed link works once. Verify: the earlier guest order with that email appears in My Orders.

## Known limits

- Old guest orders are linked only after the customer verifies the same email address.
- After a password reset, sessions already signed in on other browsers stay signed in until they end.
- There is no profile page yet (changing name, phone or email).