<?php
// Tiny "has anything changed?" check, same idea as PHP/Staff/changes.php but only for THIS customer's orders.
require __DIR__ . '/_boot.php';
$cid = requireCustomer();
$st = db()->prepare("
  SELECT md5(coalesce(string_agg(o.serial || ':' || l.id || ':' || l.status || ':' || o.status || ':' || o.cancel_requested::text, ',' ORDER BY o.serial, l.id), ''))
  FROM customer_order o JOIN order_line l ON l.serial = o.serial
  WHERE o.customer_id = ?");
$st->execute([$cid]);
json_out(['ok' => true, 'version' => (string)$st->fetchColumn()]);