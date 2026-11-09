<?php
// POST /PHP/Bakery/place_order.php : save a customer's order. The server re-checks prices, notice times, opening hours and capacity.
declare(strict_types=1);
require __DIR__ . '/_init.php';

header('Cache-Control: no-store');
kch_require_post();

$result = kch_create_order(db(), kch_read_json());

if (!$result['ok']) { 
    json_out(['ok' => false, 'errors' => $result['errors']], 422); 
}
if (session_status() === PHP_SESSION_NONE) session_start();
if (!empty($_SESSION['customer_id'])) {
    db()->prepare('UPDATE customer_order SET customer_id = :c WHERE serial = :s')
        ->execute([':c' => (int)$_SESSION['customer_id'], ':s' => $result['order']['serial']]);
}

// ---- START EMAIL INTEGRATION BOUNDARY ----
$savedOrder = $result['order'];

// Extract properties from the nested 'customer' sub-array safely
$customerData = $savedOrder['customer'] ?? [];
$customerEmail = $customerData['email'] ?? '';
$customerName  = $customerData['name'] ?? 'Customer';

// Load the Mailer Class Utility securely
require_once __DIR__ . '/../config/mailer.php';

// Dispatch the invoice mailer populated with the live order structural metrics
OrderMailer::sendReceipt(
    $customerEmail,
    $customerName,
    $savedOrder['serial'] ?? '',
    $savedOrder['lines'] ?? [],   // Maps to your item array lines key
    $savedOrder['total'] ?? 0,
    $savedOrder['fulfilment'] ?? 'pickup'
);
// ---- END EMAIL INTEGRATION BOUNDARY ----

// Return success to the web app frontend client interface
json_out(['ok' => true, 'order' => $savedOrder]);
?>
