<?php
// POST {serial} : a signed-in customer asks the bakery to cancel one of THEIR orders. Staff approve it from the staff app.
require __DIR__ . '/_boot.php';
kch_require_post();
$cid = requireCustomer();
$serial = (string)(kch_read_json()['serial'] ?? '');

$st = db()->prepare('SELECT status, cancel_requested, earliest_pickup FROM customer_order WHERE serial = ? AND customer_id = ?');
$st->execute([$serial, $cid]);
$o = $st->fetch(PDO::FETCH_ASSOC);
if (!$o) fail('Order not found.', 404);
if (!in_array($o['status'], ['Received', 'Confirmed'], true) || isTrue($o['cancel_requested'])) fail('This order cannot be cancelled.', 409);
if (!canRequestCancel($o['status'], $o['cancel_requested'], (string)$o['earliest_pickup'])) fail('Orders can only be cancelled 24 hours before pickup.', 409);

db()->prepare('UPDATE customer_order SET cancel_requested = true, updated_at = now() WHERE serial = ? AND customer_id = ?')->execute([$serial, $cid]);
json_out(['ok' => true]);