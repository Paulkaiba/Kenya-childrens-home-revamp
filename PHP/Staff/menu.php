<?php
// GET /PHP/Staff/menu.php : get all products
// POST /PHP/Staff/menu.php : save a product
declare(strict_types=1);

require __DIR__ . '/../Bakery/_init.php';

header('Cache-Control: no-store');
header('Content-Type: application/json; charset=utf-8');

try {
    $pdo = db();
    
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        // Fetch EVERYTHING, including hidden items
        $products = load_catalog($pdo, true); 
        echo json_encode(['ok' => true, 'products' => $products]);
        exit;
    }
    
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $in = kch_read_json();
        $p = $in['product'] ?? null;
        
        if (!$p || !isset($p['id'])) {
            echo json_encode(['ok' => false, 'error' => 'Missing product data']);
            exit;
        }
        
        $pdo->beginTransaction();
        
        // 1. Check if product exists
        $check = $pdo->prepare("SELECT id FROM product WHERE id = :id");
        $check->execute([':id' => $p['id']]);
        $exists = $check->fetchColumn();
        
        if ($exists) {
            // Update existing product
            $sql = "UPDATE product SET 
                        name = :name, category = :cat, emoji = :emoji, description = :desc, 
                        ingredients = :ing, allergens = :alg, is_custom = :custom, 
                        sold_out = :soldout, hidden = :hidden, image_url = :img
                    WHERE id = :id";
            $pdo->prepare($sql)->execute([
    ':id' => $p['id'], ':name' => $p['name'], ':cat' => $p['category'], 
    ':emoji' => $p['emoji'] ?? '', ':desc' => $p['desc'] ?? '', 
    ':ing' => '{' . implode(',', $p['ingredients'] ?? []) . '}', 
    ':alg' => '{' . implode(',', $p['allergens'] ?? []) . '}',
    ':custom' => !empty($p['custom']) ? 'true' : 'false', ':soldout' => !empty($p['soldOut']) ? 'true' : 'false', 
    ':hidden' => !empty($p['hidden']) ? 'true' : 'false', ':img' => $p['image'] ?? ''
]);
            // Clear old sizes/flavours
            $pdo->prepare("DELETE FROM product_size WHERE product_id = :id")->execute([':id' => $p['id']]);
            $pdo->prepare("DELETE FROM product_flavour WHERE product_id = :id")->execute([':id' => $p['id']]);
        } else {
            // Insert new product
            $sql = "INSERT INTO product (id, name, category, emoji, description, ingredients, allergens, is_custom, sold_out, hidden, image_url)
                    VALUES (:id, :name, :cat, :emoji, :desc, :ing, :alg, :custom, :soldout, :hidden, :img)";
            $pdo->prepare($sql)->execute([
    ':id' => $p['id'], ':name' => $p['name'], ':cat' => $p['category'], 
    ':emoji' => $p['emoji'] ?? '', ':desc' => $p['desc'] ?? '', 
    ':ing' => '{' . implode(',', $p['ingredients'] ?? []) . '}', 
    ':alg' => '{' . implode(',', $p['allergens'] ?? []) . '}',
    ':custom' => !empty($p['custom']) ? 'true' : 'false', ':soldout' => !empty($p['soldOut']) ? 'true' : 'false', 
    ':hidden' => !empty($p['hidden']) ? 'true' : 'false', ':img' => $p['image'] ?? ''
]);
        }
        
        // 2. Insert sizes
        if (!empty($p['sizes'])) {
            $sizeStmt = $pdo->prepare("INSERT INTO product_size (product_id, size_id, label, price, sort_order) VALUES (:pid, :sid, :label, :price, :sort)");
            foreach ($p['sizes'] as $i => $sz) {
                $sizeStmt->execute([
                    ':pid' => $p['id'], ':sid' => $sz['id'], ':label' => $sz['label'], 
                    ':price' => $sz['price'], ':sort' => $i
                ]);
            }
        }
        
        // 3. Insert flavours
        if (!empty($p['flavours'])) {
            $flavStmt = $pdo->prepare("INSERT INTO product_flavour (product_id, flavour, sort_order) VALUES (:pid, :flav, :sort)");
            foreach ($p['flavours'] as $i => $flav) {
                $flavStmt->execute([':pid' => $p['id'], ':flav' => $flav, ':sort' => $i]);
            }
        }
        
        $pdo->commit();
        echo json_encode(['ok' => true]);
        exit;
    }
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) { $pdo->rollBack(); }
    // Return the exact PHP error so the frontend can show it
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'PHP Error: ' . $e->getMessage(), 'file' => $e->getFile(), 'line' => $e->getLine()]);
    exit;
}