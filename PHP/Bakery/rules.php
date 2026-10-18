<?php
// GET /PHP/Bakery/rules.php : opening hours, days off, capacity, notice per product, and the days that are already full.
declare(strict_types=1);
require __DIR__ . '/_init.php';

header('Cache-Control: no-store');
$pdo = db();
$rules = load_rules($pdo);
$rules['fullDates'] = load_full_dates($pdo, (int)$rules['dailyCapacity']);
json_out(['ok' => true, 'rules' => $rules]);
