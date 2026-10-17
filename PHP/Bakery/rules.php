<?php
// GET /api/rules.php : opening hours, days off, capacity and the notice needed per product.
declare(strict_types=1);
include(__DIR__ . '/../api/_bootstrap.php');
require __DIR__ . '/_data.php';

header('Cache-Control: no-store');
json_out(['ok' => true, 'rules' => load_rules(db())]);
