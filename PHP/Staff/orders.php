<?php
// GET /PHP/Staff/orders.php : returns all orders for the staff dashboard and queue.
declare(strict_types=1);

Include( __DIR__ . '/../Bakery/_init.php');

header('Cache-Control: no-store');
header('Content-Type: application/json; charset=utf-8'); // Force JSON header

try {
    $pdo = db();
    
    // We reuse the excellent kch_fetch_orders function from the Bakery code!
    // By passing '1=1', it fetches ALL orders in the database.
    $orders = kch_fetch_orders($pdo, '1=1', [], 1000); 
    
    // The staff app also needs the products
    $products = load_catalog($pdo, true); 
    
    echo json_encode([
        'ok' => true, 
        'orders' => $orders,
        'products' => $products
    ]);
    exit;
} catch (Throwable $e) {
    // If something crashes, return it as raw JSON text
    http_response_code(500);
    echo json_encode([
        'ok' => false, 
        'error' => 'PHP Error: ' . $e->getMessage(),
        'file' => $e->getFile(),
        'line' => $e->getLine()
    ]);
    exit;
}