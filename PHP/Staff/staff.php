<?php
// GET /PHP/Staff/staff.php : list all staff
// POST /PHP/Staff/staff.php : add a new staff member
declare(strict_types=1);

header('Cache-Control: no-store');
header('Content-Type: application/json; charset=utf-8');

try {
    require __DIR__ . '/../Bakery/_init.php';

    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
    
    $me = $_SESSION['staff'] ?? null;
    if (!$me) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Unauthorized. Please log in.']);
        exit;
    }

    $pdo = db();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $st = $pdo->query("SELECT id, name, username, role FROM staff ORDER BY id");
        echo json_encode(['ok' => true, 'staff' => $st->fetchAll(PDO::FETCH_ASSOC)]);
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        if ($me['role'] !== 'manager') {
            echo json_encode(['ok' => false, 'error' => 'Only managers can add staff']);
            exit;
        }

        $in = kch_read_json();
        $name = trim($in['name'] ?? '');
        $username = trim(strtolower($in['username'] ?? ''));
        $role = $in['role'] ?? 'baker';
        $password = $in['password'] ?? '';

        if (!$name || !$username || !$password) {
            echo json_encode(['ok' => false, 'error' => 'Name, username and password are required']);
            exit;
        }
        if (strlen($password) < 6) {
            echo json_encode(['ok' => false, 'error' => 'Password must be at least 6 characters']);
            exit;
        }
        if (!in_array($role, ['manager', 'supervisor', 'baker'])) {
            echo json_encode(['ok' => false, 'error' => 'Invalid role']);
            exit;
        }

        // Check if username is taken
        $check = $pdo->prepare("SELECT id FROM staff WHERE username = :u");
        $check->execute([':u' => $username]);
        if ($check->fetch()) {
            echo json_encode(['ok' => false, 'error' => 'That username is already taken']);
            exit;
        }

        // Hash the password securely using PHP's built-in bcrypt
        $hash = password_hash($password, PASSWORD_DEFAULT);

        $sql = "INSERT INTO staff (name, username, password_hash, role) VALUES (:n, :u, :p, :r)";
        $pdo->prepare($sql)->execute([':n' => $name, ':u' => $username, ':p' => $hash, ':r' => $role]);

        echo json_encode(['ok' => true]);
        exit;
    }
    
    // If it's neither GET nor POST
    echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
    exit;

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false, 
        'error' => 'PHP Error: ' . $e->getMessage(),
        'file' => $e->getFile(),
        'line' => $e->getLine()
    ]);
    exit;
}