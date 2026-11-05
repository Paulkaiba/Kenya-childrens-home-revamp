<?php
// Shared setup for every customer endpoint. Reuses your partner's helpers from PHP/Bakery/_init.php:
// db(), json_out(), kch_read_json(), kch_require_post(), kch_throttle().
declare(strict_types=1);
require __DIR__ . '/../Bakery/_init.php';

// Any crash comes back as readable JSON (and goes to the PHP server log) instead of a blank 500.
// While developing the message helps; before going live, replace it with a generic "Server error".
set_exception_handler(function (Throwable $e) {
    error_log((string)$e);
    json_out(['ok' => false, 'error' => 'Server error: ' . $e->getMessage()], 500);
    exit;
});

header('Cache-Control: no-store');
header('Content-Type: application/json; charset=utf-8');
if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax', 'secure' => !empty($_SERVER['HTTPS'])]);
    session_start();
}

function fail(string $msg, int $code = 400): never { json_out(['ok' => false, 'error' => $msg], $code); exit; }
function customerId(): ?int { return isset($_SESSION['customer_id']) ? (int)$_SESSION['customer_id'] : null; }
function requireCustomer(): int { return customerId() ?? fail('Please sign in.', 401); }
function publicCustomer(array $r): array { return ['id' => (int)$r['id'], 'name' => $r['name'], 'email' => $r['email'], 'phone' => $r['phone'], 'verified' => !empty($r['email_verified_at'])]; }

// 0712 345 678, +254 712 345 678, 712345678 -> 254712345678 (null if it is not a Kenyan mobile number)
function normPhone(string $raw): ?string {
    $d = preg_replace('/\D+/', '', $raw);
    if (preg_match('/^0([17]\d{8})$/', $d, $m)) $d = '254' . $m[1];
    elseif (preg_match('/^[17]\d{8}$/', $d)) $d = '254' . $d;
    return preg_match('/^254[17]\d{8}$/', $d) ? $d : null;
}
// Staff statuses -> tracker position
function stageOf(string $s): int {
    return ['Received' => 0, 'Confirmed' => 0, 'Baking' => 1, 'Ready' => 2, 'Collected' => 3, 'Delivered' => 3][$s] ?? 0;
}

function isTrue($v): bool { return $v === true || $v === 't' || $v === '1' || $v === 1; }
// Same rule as the guest flow: only Received/Confirmed orders, not already requested, and at least 24 hours before the earliest pickup.
function canRequestCancel(string $status, $cancelRequested, string $earliestPickup): bool {
    return in_array($status, ['Received', 'Confirmed'], true)
        && !isTrue($cancelRequested)
        && (strtotime($earliestPickup) - time()) >= 24 * 3600;
}
