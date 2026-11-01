<?php
declare(strict_types=1);

header('Cache-Control: no-store');
header('Content-Type: application/json; charset=utf-8');

try {
    require __DIR__ . '/../Bakery/_init.php';

    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
    
    $me = $_SESSION['staff'] ?? null;
    if (!$me || $me['role'] !== 'manager') {
        echo json_encode(['ok' => false, 'error' => 'Only managers can remove staff.']);
        exit;
    }

    $in = kch_read_json();
    $id = (int)($in['id'] ?? 0);
    
    if ($id === (int)$me['id']) {
        echo json_encode(['ok' => false, 'error' => 'You cannot remove yourself.']);
        exit;
    }

    $pdo = db();
    $pdo->prepare("DELETE FROM staff WHERE id = :id")->execute([':id' => $id]);
    
    echo json_encode(['ok' => true]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false, 
        'error' => 'PHP Error: ' . $e->getMessage()
    ]);
}