# Stage 2: the customer menu and scheduling rules come from PostgreSQL

Your PHP code lives in the `PHP/` folder at the project root. Always start the server from the PROJECT ROOT (the folder that holds Bakery, Staff, PHP, shared):

    php -S localhost:8000

## 1. Protect the password (do this before any commit)
Add this line to the root `.gitignore`. The pattern must include the PHP/ folder, or Git will not ignore the file:

    PHP/config/database.php

Check it:  `git check-ignore -v PHP/config/database.php`  must print a line. If it prints nothing, do not commit.

## 2. Install
Unzip into the project root and say yes to replacing `PHP/api/status.php` and `Bakery/js/app.js`.
The PHP server needs no restart. In the browser press Ctrl+Shift+R.

## 3. Check it (in this order)
1. http://localhost:8000/PHP/api/status.php : two new green lines, "The menu loads" and "The scheduling rules load".
2. http://localhost:8000/PHP/api/catalog.php : the raw menu as JSON (18 products). http://localhost:8000/PHP/api/rules.php : the rules.
3. http://localhost:8000/Bakery/index.html : the menu. Press F12 > Network and reload: `catalog.php` and `rules.php` should show status 200.

## 4. Test that it really reads the database
In pgAdmin, open a Query Tool on kch_bakery, run ONE of these, then look at the Bakery page. It updates on reload, or by itself within 30 seconds.
```sql
UPDATE product SET sold_out = true  WHERE id = 'wb';          -- White Bread shows "Sold out"
UPDATE product SET hidden   = true  WHERE id = 'ck';          -- Celebration Cake disappears
UPDATE product_size SET price = 40  WHERE product_id = 'wb' AND size_id = '200g';
INSERT INTO closed_weekday (weekday) VALUES (6);              -- no pickups on Saturdays
UPDATE product_notice_rule SET notice_hours = 72 WHERE product_id = 'qc' AND over_qty = 5;   -- Queen Cakes: more than 5 need 3 days
```
Undo them:
```sql
UPDATE product SET sold_out = false WHERE id = 'wb';
UPDATE product SET hidden = false WHERE id = 'ck';
UPDATE product_size SET price = 35 WHERE product_id = 'wb' AND size_id = '200g';
DELETE FROM closed_weekday WHERE weekday = 6;
UPDATE product_notice_rule SET notice_hours = 24 WHERE product_id = 'qc' AND over_qty = 5;
```

## 5. Test the fallback
Rename `PHP/config/database.php` to `database.php.off`, reload the Bakery page: a yellow "Server not reachable" bar appears and the built-in menu is shown. Rename it back.

## Where things are
- `shared/api.js` : the single line that says where the API lives (`PHP/api/`).
- `PHP/api/_bootstrap.php` finds `PHP/config/database.php` by itself, so nothing else needs changing.

## What is NOT connected yet
- Staff Menu Management and Scheduling Rules still save in the browser, so a manager's changes will NOT reach customers until Stage 4. Use the SQL above to test.
- Orders are still saved in the browser (Stage 3). The "day is full" greying uses those browser orders.
