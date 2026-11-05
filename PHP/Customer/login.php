<?php
require __DIR__ . '/_boot.php';

// GET = "who is signed in?" (same pattern as the staff login.php)
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $id = customerId();
    if (!$id) json_out(['ok' => false]);
    $st = db()->prepare('SELECT id, name, email, phone, email_verified_at FROM customer WHERE id = ?');
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) { unset($_SESSION['customer_id']); json_out(['ok' => false]); }
    json_out(['ok' => true, 'customer' => publicCustomer($row)]);
}

// POST = sign in with email OR phone
kch_throttle('customer_login', 10, 600);
$b = kch_read_json();
$ident = trim((string)($b['identifier'] ?? ''));
$pw = (string)($b['password'] ?? '');
$isEmail = str_contains($ident, '@');
$key = $isEmail ? strtolower($ident) : normPhone($ident);
if (!$key || $pw === '') fail('Enter your email or phone number, and your password.');

$st = db()->prepare('SELECT id, name, email, phone, email_verified_at, password_hash FROM customer WHERE ' . ($isEmail ? 'lower(email) = ?' : 'phone = ?'));
$st->execute([$key]);
$row = $st->fetch(PDO::FETCH_ASSOC);
if (!$row || !password_verify($pw, $row['password_hash'])) {

    fail('That email, phone number or password is not right.', 401);
}
session_regenerate_id(true);
$_SESSION['customer_id'] = (int)$row['id'];
json_out(['ok' => true, 'customer' => publicCustomer($row)]);
