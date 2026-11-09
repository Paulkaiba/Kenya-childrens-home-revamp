<?php
// POST (signed in) : email the customer a new verification link.
require __DIR__ . '/_boot.php';
require __DIR__ . '/_mail.php';
kch_require_post();
kch_throttle('customer_verify_send', 5, 600);
$cid = requireCustomer();

$st = db()->prepare('SELECT name, email, email_verified_at FROM customer WHERE id = ?');
$st->execute([$cid]);
$c = $st->fetch(PDO::FETCH_ASSOC);
if (!$c) fail('Account not found.', 404);
if ($c['email_verified_at']) json_out(['ok' => true, 'already' => true]);

$token = issueToken(db(), $cid, 'verify_email', 24 * 60);
if (!AccountMailer::sendVerification($c['email'], $c['name'], baseUrl() . '/Bakery/index.html#verify=' . $token))
    fail('We could not send the email right now. Please try again later.', 502);
json_out(['ok' => true]);
