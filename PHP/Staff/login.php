<?php
// POST /PHP/Staff/login.php : verify credentials and start session
declare(strict_types=1);

// Turn on error reporting so we can see what's breaking
error_reporting(E_ALL);
ini_set('display_errors', '0'); // Don't print HTML errors, we want JSON

header('Cache-Control: no-store');
header('Content-Type: application/json; charset=utf-8');

try {
    require __DIR__ . '/../Bakery/_init.php';

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        // Check if a session already exists
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
        
        if (isset($_SESSION['staff'])) {
            echo json_encode(['ok' => true, 'staff' => $_SESSION['staff']]);
        } else {
            echo json_encode(['ok' => false, 'error' => 'Not logged in']);
        }
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $in = kch_read_json();
        $username = trim(strtolower($in['username'] ?? ''));
        $password = (string)($in['password'] ?? '');

        if (!$username || !$password) {
            echo json_encode(['ok' => false, 'error' => 'Username and password required']);
            exit;
        }

        $pdo = db();
        $st = $pdo->prepare("SELECT id, name, username, password_hash, role FROM staff WHERE username = :u");
        $st->execute([':u' => $username]);
        $staff = $st->fetch();

        // Verify the password against the bcrypt hash in the database
        if (!$staff || !password_verify($password, $staff['password_hash'])) {
            echo json_encode(['ok' => false, 'error' => 'Incorrect username or password']);
            exit;
        }

        // Start the session and save the staff data (except the password)
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
        unset($staff['password_hash']);
        
        // Add the permissions the frontend expects
        $staff['isManager'] = $staff['role'] === 'manager';
        $staff['canManageStaff'] = in_array($staff['role'], ['manager', 'supervisor']);
        $staff['canResetPasswords'] = $staff['role'] === 'manager';
        $staff['canUpdateStatus'] = in_array($staff['role'], ['manager', 'baker']);

        $_SESSION['staff'] = $staff;

        echo json_encode(['ok' => true, 'staff' => $staff]);
        exit;
    }
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