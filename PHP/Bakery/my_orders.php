<?php
// POST /PHP/Bakery/my_orders.php {phone, email} : the customer's orders. Shown ONLY when the phone number AND the email both match.
declare(strict_types=1);
require __DIR__ . '/_init.php';

header('Cache-Control: no-store');
kch_require_post();
$in = kch_read_json();
kch_throttle('lookup', 15, 600);
json_out(['ok' => true, 'orders' => kch_find_orders(db(), (string)($in['phone'] ?? ''), (string)($in['email'] ?? ''))]);
