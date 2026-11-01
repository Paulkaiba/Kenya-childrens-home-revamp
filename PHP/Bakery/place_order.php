<?php
// POST /PHP/Bakery/place_order.php : save a customer's order. The server re-checks prices, notice times, opening hours and capacity.
declare(strict_types=1);
require __DIR__ . '/_init.php';

header('Cache-Control: no-store');
kch_require_post();
$result = kch_create_order(db(), kch_read_json());
if (!$result['ok']) { json_out(['ok' => false, 'errors' => $result['errors']], 422); }
json_out(['ok' => true, 'order' => $result['order']]);
