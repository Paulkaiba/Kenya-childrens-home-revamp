<?php
// POST /PHP/Bakery/request_cancel.php {serial, phone, email} : ask the bakery to cancel. Serial, phone AND email must all match.
declare(strict_types=1);
require __DIR__ . '/_init.php';

header('Cache-Control: no-store');
kch_require_post();
$in = kch_read_json();
kch_throttle('cancel', 15, 600);
$r = kch_request_cancel(db(), (string)($in['serial'] ?? ''), (string)($in['phone'] ?? ''), (string)($in['email'] ?? ''));
if (!$r['ok']) { json_out(['ok' => false, 'errors' => $r['errors']], 422); }
json_out(['ok' => true, 'order' => $r['order']]);
