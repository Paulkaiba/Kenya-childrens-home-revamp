<?php
// POST /PHP/Staff/delete_product.php : delete a product
declare(strict_types=1);

require __DIR__ . '/../Bakery/_init.php';

header('Cache-Control: no-store');
header('Content-Type: application/json; charset=utf-8'); // Force JSON

try {
    kch_require_post();
    $in = kch_read_json();
    $id = (string)($in['id'] ?? '');

    if (!$id) {
        echo json_encode(['ok' => false, 'error' => 'Missing product ID']);
        exit;
    }

    $pdo = db();
    $pdo->beginTransaction();

    // 1. Manually delete the related sizes and flavours first
    // (This prevents Foreign Key constraint errors)
    $pdo->prepare("DELETE FROM product_size WHERE product_id = :id")->execute([':id' => $id]);
    $pdo->prepare("DELETE FROM product_flavour WHERE product_id = :id")->execute([':id' => $id]);
    
    // If you have a product_notice_rule table, we should delete from there too
    // $pdo->prepare("DELETE FROM product_notice_rule WHERE product_id = :id")->execute([':id' => $id]);

    // 2. Now delete the product itself
    $pdo->prepare("DELETE FROM product WHERE id = :id")->execute([':id' => $id]);

    $pdo->commit();
    echo json_encode(['ok' => true]);
    exit;

} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) { 
        $pdo->rollBack(); 
    }
    // Return the exact PHP error so the frontend can show it
    http_response_code(500);
    echo json_encode([
        'ok' => false, 
        'error' => 'PHP Error: ' . $e->getMessage(),
        'file' => $e->getFile(),
        'line' => $e->getLine()
    ]);
    exit;
}