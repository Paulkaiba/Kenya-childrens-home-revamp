<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

try {
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
    
    // Clear all session data
    $_SESSION = [];
    
    // Destroy the session cookie
    if (ini_get("session.use_cookies")) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params["path"], $params["domain"],
            $params["secure"], $params["httponly"]
        );
    }
    
    session_destroy();
    
    echo json_encode(['ok' => true]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'PHP Error: ' . $e->getMessage()]);
}