<?php
// POST /PHP/Staff/cancel_order.php : manager cancels an entire order.
declare(strict_types=1);

Include( __DIR__ . '/../Bakery/_init.php');
header('Cache-Control: no-store');
kch_require_post();
$in = kch_read_json();
$serial = (string)($in['serial'] ?? '');

try {
    $pdo = db();
    $pdo->beginTransaction();
    
    $pdo->prepare("UPDATE customer_order SET status = 'Cancelled', cancel_requested = false WHERE serial = :s")->execute([':s' => $serial]);
    $pdo->prepare("UPDATE order_line SET status = 'Cancelled' WHERE serial = :s")->execute([':s' => $serial]);
    
    $pdo->commit();
    json_out(['ok' => true]);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) { $pdo->rollBack(); }
    json_out(['ok' => false, 'error' => $e->getMessage()], 500);
}