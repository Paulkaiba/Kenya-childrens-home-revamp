<?php
require __DIR__ . '/_boot.php';
kch_require_post();
$cid = requireCustomer();
$b = kch_read_json();
$serial = (string)($b['serial'] ?? '');
$bucket = (string)($b['bucket'] ?? '');

$pdo = db();
$pdo->beginTransaction();
$closed = false;
try {
    // The order must belong to the signed-in customer (taken from the session, never from the browser).
    $own = $pdo->prepare("SELECT 1 FROM customer_order WHERE serial = ? AND customer_id = ? AND status <> 'Cancelled' FOR UPDATE");
    $own->execute([$serial, $cid]);
    if (!$own->fetchColumn()) { $pdo->rollBack(); fail('Order not found.', 404); }

    $st = $pdo->prepare("SELECT status FROM order_line WHERE serial = ? AND bucket = ? AND status <> 'Cancelled'");
    $st->execute([$serial, $bucket]);
    $sts = $st->fetchAll(PDO::FETCH_COLUMN);
    if (!$sts || array_diff($sts, ['Ready', 'Collected', 'Delivered']) || !in_array('Ready', $sts, true)) {
        $pdo->rollBack(); fail('This part of your order is not ready to confirm yet.', 409);
    }

    $pdo->prepare("UPDATE order_line SET status = 'Collected' WHERE serial = ? AND bucket = ? AND status = 'Ready'")->execute([$serial, $bucket]);
    $pdo->prepare('UPDATE order_pickup SET customer_confirmed_at = now() WHERE serial = ? AND bucket = ?')->execute([$serial, $bucket]);

    // Same rule as PHP/Staff/update_status.php: when every line is Collected, the whole order is Collected.
    $left = $pdo->prepare("SELECT count(*) FROM order_line WHERE serial = ? AND status NOT IN ('Collected', 'Cancelled')");
    $left->execute([$serial]);
    $closed = (int)$left->fetchColumn() === 0;
    $pdo->prepare($closed
        ? "UPDATE customer_order SET status = 'Collected', updated_at = now() WHERE serial = ?"
        : 'UPDATE customer_order SET updated_at = now() WHERE serial = ?')->execute([$serial]);
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    throw $e;
}

// Same email the staff screen sends when an order becomes Collected. A mail problem must not undo the confirmation.
if ($closed) {
    try {
        $q = $pdo->prepare('SELECT customer_name, customer_email FROM customer_order WHERE serial = ?');
        $q->execute([$serial]);
        $o = $q->fetch(PDO::FETCH_ASSOC);
        if ($o && $o['customer_email']) {
            require_once __DIR__ . '/../config/mailer.php';
            OrderMailer::sendFeedbackRequest($o['customer_email'], $o['customer_name'], $serial);
        }
    } catch (Throwable $e) { error_log('Feedback email failed: ' . $e->getMessage()); }
}
json_out(['ok' => true]);