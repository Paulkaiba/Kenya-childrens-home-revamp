<?php
// POST {token} : the link from the verification email. Works even if the email is opened in another browser.
require __DIR__ . '/_boot.php';
require __DIR__ . '/_mail.php';
kch_require_post();
kch_throttle('customer_verify_use', 10, 600);

$token = (string)(kch_read_json()['token'] ?? '');
$pdo = db();
$pdo->beginTransaction();
try {
    $cid = consumeToken($pdo, $token, 'verify_email');
    if (!$cid) { $pdo->rollBack(); fail('This link is not valid any more. Sign in and ask for a new one.', 410); }
    $linked = markVerifiedAndLink($pdo, $cid);
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    throw $e;
}
json_out(['ok' => true, 'linked' => $linked]);
