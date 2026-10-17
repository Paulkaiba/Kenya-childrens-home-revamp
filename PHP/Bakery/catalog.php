<?php
// GET /api/catalog.php : the menu the customer app shows (hidden products are left out).
declare(strict_types=1);

include(__DIR__ . '/../api/_bootstrap.php');

include('_data.php');

header('Cache-Control: no-store');
json_out(['ok' => true, 'products' => load_catalog(db())]);
