<?php
// POST {token, password} : set a new password using the link from the email.
require __DIR__ . '/_boot.php';
require __DIR__ . '/_mail.php';
kch_require_post();
kch_throttle('customer_reset_use', 10, 600);

$b = kch_read_json();
$token = (string)($b['token'] ?? '');
$pw = (string)($b['password'] ?? '');
if (strlen($pw) < 8) fail('Password must be at least 8 characters.');

$pdo = db();
$pdo->beginTransaction();
try {
    $cid = consumeToken($pdo, $token, 'reset_password');
    if (!$cid) { $pdo->rollBack(); fail('This reset link is not valid any more. Please ask for a new one.', 410); }
    $pdo->prepare('UPDATE customer SET password_hash = ? WHERE id = ?')->execute([password_hash($pw, PASSWORD_DEFAULT), $cid]);
    markVerifiedAndLink($pdo, $cid);      // they just proved they own this email address
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    throw $e;
}
json_out(['ok' => true]);
