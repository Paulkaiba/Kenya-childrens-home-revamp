<?php
require __DIR__ . '/_boot.php';
$cid = requireCustomer();
$st = db()->prepare("
  SELECT o.serial, o.status, o.fulfilment, o.location, o.total, o.created_at, o.cancel_requested, o.earliest_pickup,
         l.id AS line_id, l.name, l.size_label, l.flavour, l.message, l.qty, l.unit_price, l.bucket, l.status AS line_status,
         p.pickup_at, p.customer_confirmed_at
  FROM customer_order o
  JOIN order_line l ON l.serial = o.serial
  LEFT JOIN order_pickup p ON p.serial = o.serial AND p.bucket = l.bucket
  WHERE o.customer_id = ?
  ORDER BY o.created_at DESC, o.serial, l.id");
$st->execute([$cid]);
$st->setFetchMode(PDO::FETCH_ASSOC);

$orders = [];
foreach ($st as $r) {
    $s = $r['serial']; $b = $r['bucket'];
    if (!isset($orders[$s])) $orders[$s] = [
        'serial' => $s, 'status' => $r['status'], 'fulfilment' => $r['fulfilment'], 'location' => $r['location'],
        'total' => (float)$r['total'], 'createdAt' => $r['created_at'],
        'cancelRequested' => isTrue($r['cancel_requested']),
        'canCancel' => canRequestCancel($r['status'], $r['cancel_requested'], (string)$r['earliest_pickup']),
        'collections' => [],
    ];
    if (!isset($orders[$s]['collections'][$b])) $orders[$s]['collections'][$b] = [
        'bucket' => $b, 'pickupAt' => $r['pickup_at'], 'confirmedAt' => $r['customer_confirmed_at'], 'lines' => [],
    ];
    $orders[$s]['collections'][$b]['lines'][] = [
        'id' => $r['line_id'], 'name' => $r['name'], 'size' => $r['size_label'], 'flavour' => $r['flavour'],
        'message' => $r['message'], 'qty' => (int)$r['qty'], 'price' => (float)$r['unit_price'], 'status' => $r['line_status'],
    ];
}
foreach ($orders as &$o) {
    foreach ($o['collections'] as &$c) {
        $live = array_filter($c['lines'], fn($l) => $l['status'] !== 'Cancelled');
        if (!$live || $o['status'] === 'Cancelled') { $c['stage'] = -1; $c['canConfirm'] = false; continue; }
        $c['stage'] = min(array_map(fn($l) => stageOf($l['status']), $live));
        $c['canConfirm'] = $c['stage'] === 2;                          // everything Ready: waiting for the customer
        if ($c['stage'] < 3) $c['confirmedAt'] = null;                  // an old confirmation means nothing once the items are not collected
    }
    unset($c);
    $o['collections'] = array_values($o['collections']);
}
unset($o);
json_out(['ok' => true, 'orders' => array_values($orders)]);