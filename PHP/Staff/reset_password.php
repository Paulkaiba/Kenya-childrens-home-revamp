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
        echo json_encode(['ok' => false, 'error' => 'Only managers can reset passwords.']);
        exit;
    }

    $in = kch_read_json();
    $id = (int)($in['id'] ?? 0);
    $password = (string)($in['password'] ?? '');

    if (strlen($password) < 6) {
        echo json_encode(['ok' => false, 'error' => 'Password must be at least 6 characters.']);
        exit;
    }

    $pdo = db();
    $hash = password_hash($password, PASSWORD_DEFAULT);
    $pdo->prepare("UPDATE staff SET password_hash = :h WHERE id = :id")->execute([':h' => $hash, ':id' => $id]);
    
    echo json_encode(['ok' => true]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'PHP Error: ' . $e->getMessage()]);
}