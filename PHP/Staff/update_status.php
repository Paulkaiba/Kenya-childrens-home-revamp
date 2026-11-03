<?php
// POST /PHP/Staff/update_status.php : update the status of an order line or the whole order.
declare(strict_types=1);

require __DIR__ . '/../Bakery/_init.php';

header('Cache-Control: no-store');
header('Content-Type: application/json; charset=utf-8');

try {
    // Force session check
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
    
    $me = $_SESSION['staff'] ?? null;
    if (!$me) {
        echo json_encode(['ok' => false, 'error' => 'Unauthorized. Please log in.']);
        exit;
    }

    $in = kch_read_json();
    $serial = (string)($in['serial'] ?? '');
    $lineId = (string)($in['lineId'] ?? '');
    $newStatus = (string)($in['status'] ?? '');

    if (!$serial || !$newStatus) {
        echo json_encode(['ok' => false, 'error' => 'Missing serial or status']);
        exit;
    }

    $pdo = db();
    $pdo->beginTransaction();
    
    if ($lineId) {
        // Update a specific line item
        $st = $pdo->prepare("UPDATE order_line SET status = :s WHERE serial = :ser AND id = :id");
        $st->execute([':s' => $newStatus, ':ser' => $serial, ':id' => $lineId]);
    } else {
        // Update the whole order
        $st = $pdo->prepare("UPDATE customer_order SET status = :s WHERE serial = :ser");
        $st->execute([':s' => $newStatus, ':ser' => $serial]);
        // Also update all lines
        $st = $pdo->prepare("UPDATE order_line SET status = :s WHERE serial = :ser");
        $st->execute([':s' => $newStatus, ':ser' => $serial]);
    }
    
    // If every line is collected, mark the whole order as Collected
    $check = $pdo->prepare("SELECT count(*) FROM order_line WHERE serial = :ser AND status != 'Collected'");
    $check->execute([':ser' => $serial]);
    if ((int)$check->fetchColumn() === 0) {
        $pdo->prepare("UPDATE customer_order SET status = 'Collected' WHERE serial = :ser")->execute([':ser' => $serial]);
        $triggeredStatus = 'Collected';
    } else {
        $triggeredStatus = $newStatus;
    }

    // ---- START PRODUCTION EMAIL DISPATCH LINE ----
    // Query directly from your schema columns layout: customer_name, customer_email
    $query = $pdo->prepare("SELECT customer_name, customer_email FROM customer_order WHERE serial = :ser LIMIT 1");
    $query->execute([':ser' => $serial]);
    $orderRow = $query->fetch(PDO::FETCH_ASSOC);

    if ($orderRow && !empty($orderRow['customer_email'])) {
        $customerEmail = $orderRow['customer_email'];
        $customerName  = $orderRow['customer_name'];

        require_once __DIR__ . '/../config/mailer.php';
        
        $normalizedStatus = strtolower(trim($triggeredStatus));

        if ($normalizedStatus === 'ready') {
            OrderMailer::sendOrderReady($customerEmail, $customerName, $serial);
        } 
        elseif ($normalizedStatus === 'collected' || $normalizedStatus === 'delivered') {
            OrderMailer::sendFeedbackRequest($customerEmail, $customerName, $serial);
        }
    }
    // ---- END PRODUCTION EMAIL DISPATCH LINE ----

    $pdo->commit();
    
    echo json_encode(['ok' => true]);
    exit;
    
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) { $pdo->rollBack(); }
    http_response_code(500);
    echo json_encode([
        'ok' => false, 
        'error' => 'PHP Error: ' . $e->getMessage()
    ]);
    exit;
}
