<?php
// POST {identifier} : email OR phone. Emails a one-hour reset link if an account matches.
require __DIR__ . '/_boot.php';
require __DIR__ . '/_mail.php';
kch_require_post();
kch_throttle('customer_reset', 5, 600);

$ident = trim((string)(kch_read_json()['identifier'] ?? ''));
$isEmail = str_contains($ident, '@');
$key = $isEmail ? strtolower($ident) : normPhone($ident);
if ($key) {
    $st = db()->prepare('SELECT id, name, email FROM customer WHERE ' . ($isEmail ? 'lower(email) = ?' : 'phone = ?'));
    $st->execute([$key]);
    if ($c = $st->fetch(PDO::FETCH_ASSOC)) {
        $token = issueToken(db(), (int)$c['id'], 'reset_password', 60);
        AccountMailer::sendPasswordReset($c['email'], $c['name'], baseUrl() . '/Bakery/index.html#reset=' . $token);
    }
}
// Same answer whether or not an account matched, so this cannot be used to find out who has an account.
json_out(['ok' => true]);
