<?php
require __DIR__ . '/_boot.php';
require __DIR__ . '/_mail.php';
kch_require_post();
kch_throttle('customer_register', 10, 600);
$b = kch_read_json();
$name  = trim((string)($b['name'] ?? ''));
$email = strtolower(trim((string)($b['email'] ?? '')));
$phone = normPhone((string)($b['phone'] ?? ''));
$pw    = (string)($b['password'] ?? '');

$errs = [];
if ($name === '') $errs[] = 'Enter your full name';
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) $errs[] = 'Enter a valid email address';
if (!$phone) $errs[] = 'Enter a valid Kenyan phone number, like 0712 345 678';
if (strlen($pw) < 8) $errs[] = 'Password must be at least 8 characters';
if ($errs) fail(implode('. ', $errs) . '.');

try {
    $st = db()->prepare('INSERT INTO customer (name, email, phone, password_hash) VALUES (?, ?, ?, ?) RETURNING id');
    $st->execute([$name, $email, $phone, password_hash($pw, PASSWORD_DEFAULT)]);
} catch (PDOException $e) {
    if ($e->getCode() === '23505') fail('An account with that email or phone number already exists. Try signing in.', 409);
    throw $e;
}
session_regenerate_id(true);
$id = (int)$st->fetchColumn();
$_SESSION['customer_id'] = $id;
// Ask them to verify their email (a mail problem must never block registration).
try {
    $tok = issueToken(db(), $id, 'verify_email', 24 * 60);
    AccountMailer::sendVerification($email, $name, baseUrl() . '/Bakery/index.html#verify=' . $tok);
} catch (Throwable $e) { error_log('Verification email failed: ' . $e->getMessage()); }
json_out(['ok' => true, 'customer' => publicCustomer(['id' => $id, 'name' => $name, 'email' => $email, 'phone' => $phone])]);
