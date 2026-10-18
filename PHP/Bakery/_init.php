<?php
// Loads everything the Bakery endpoints share: the database connection (PHP/api/_bootstrap.php), the menu code and the order code.
// Every Stage 3 endpoint starts with:  require __DIR__ . '/_init.php';
declare(strict_types=1);

$kchBoot = is_file(__DIR__ . '/../api/_bootstrap.php') ? __DIR__ . '/../api/_bootstrap.php' : __DIR__ . '/_bootstrap.php';
if (!is_file($kchBoot)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Cannot find _bootstrap.php. It should be in PHP/api/.']);
    exit;
}
require_once $kchBoot;
require_once __DIR__ . '/_data.php';
require_once __DIR__ . '/_orders.php';
