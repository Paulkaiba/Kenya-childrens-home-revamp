<?php
// Open http://localhost:8000/api/status.php : a checklist that shows what works and how to fix what doesn't.
declare(strict_types=1);
require __DIR__ . '/_bootstrap.php';
require __DIR__ . '/_data.php';
restore_exception_handler();                      // this page prints its own errors

// ---- session test: refresh the page and "visits" should go up by one each time ----
session_start();
$_SESSION['visits'] = ($_SESSION['visits'] ?? 0) + 1;

$checks = [];
function add(array &$checks, bool $ok, string $label, string $detail = '', string $fix = ''): void {
    $checks[] = ['ok' => $ok, 'label' => $label, 'detail' => $detail, 'fix' => $fix];
}
$h = function ($s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); };

add($checks, version_compare(PHP_VERSION, '7.4.0', '>='), 'PHP version', PHP_VERSION,
    'Install PHP 7.4 or newer (8.x is best).');
add($checks, extension_loaded('pdo_pgsql'), 'PostgreSQL driver (pdo_pgsql) is switched on', extension_loaded('pdo_pgsql') ? 'loaded' : 'not loaded',
    'Run  php --ini  to find php.ini, remove the ";" in front of  extension=pdo_pgsql  and  extension=pgsql, save, and restart the PHP server.');
add($checks, is_file(APP_ROOT . '/config/database.php'), 'Settings file config/database.php exists', '',
    'Copy config/database.example.php to config/database.php and put your password in it.');

$pdo = null;
if (extension_loaded('pdo_pgsql') && is_file(APP_ROOT . '/config/database.php')) {
    $c = config();
    try {
        $pdo = db();
        $row = $pdo->query('SELECT current_database() AS db, current_user AS usr, version() AS v')->fetch();
        add($checks, true, 'Connected to PostgreSQL', "database \"{$row['db']}\" as user \"{$row['usr']}\" on {$c['host']}:{$c['port']}");
        add($checks, $row['db'] === 'kch_bakery', 'It is the kch_bakery database', $row['db'], 'Check "dbname" in config/database.php.');
    } catch (Throwable $e) {
        $m = $e->getMessage(); $fix = 'Read the message above.';
        if (stripos($m, 'password authentication') !== false) $fix = 'Wrong user or password in config/database.php. In pgAdmin, Login/Group Roles > kch_app: check it exists and set its password.';
        elseif (stripos($m, 'does not exist') !== false)       $fix = 'The database or user name is wrong, or the setup SQL was not run on kch_bakery.';
        elseif (stripos($m, 'could not connect') !== false || stripos($m, 'Connection refused') !== false) $fix = 'PostgreSQL is not running or the port is wrong. Check "port" (usually 5432) in config/database.php.';
        add($checks, false, 'Connected to PostgreSQL', $m, $fix);
    }
}

if ($pdo) {
    try {
        $counts = $pdo->query("SELECT (SELECT count(*) FROM product) AS products, (SELECT count(*) FROM product_size) AS sizes,
                                      (SELECT count(*) FROM product_flavour) AS flavours, (SELECT count(*) FROM product_notice_rule) AS notice_rules,
                                      (SELECT count(*) FROM staff) AS staff, (SELECT count(*) FROM customer_order) AS orders")->fetch();
        $okData = (int)$counts['products'] === 18 && (int)$counts['staff'] === 4;
        add($checks, $okData, 'Tables are filled', json_encode($counts), 'Expected 18 products and 4 staff. Run kch_bakery_setup.sql on the kch_bakery database.');
        $hash = $pdo->query("SELECT password_hash FROM staff WHERE username = 'amina'")->fetchColumn();
        add($checks, $hash !== false && password_verify('manager123', (string)$hash), 'PHP can verify the staff password hashes', 'amina / manager123',
            'The hashes were made by the database (bcrypt). If this fails, tell me the PHP version above.');
    } catch (Throwable $e) {
        add($checks, false, 'Tables are filled', $e->getMessage(), 'The tables are missing or kch_app lacks permission. Re-run kch_bakery_setup.sql as postgres on kch_bakery.');
    }
}

if ($pdo) {
    try {
        $cat = load_catalog($pdo);
        $withSizes = count(array_filter($cat, function ($p) { return count($p['sizes']) > 0; }));
        $first = $cat ? $cat[0] : null;
        $firstText = ($first && $first['sizes']) ? ($first['name'] . ' from Ksh ' . min(array_column($first['sizes'], 'price'))) : 'none';
        add($checks, count($cat) > 0 && $withSizes === count($cat), 'The menu loads (what catalog.php sends)',
            count($cat) . ' visible products, ' . $withSizes . ' with sizes. First: ' . $firstText,
            'Run kch_bakery_setup.sql on the kch_bakery database.');
        $rules = load_rules($pdo);
        add($checks, true, 'The scheduling rules load (what rules.php sends)',
            'open ' . $rules['hours']['open'] . ':00 to ' . $rules['hours']['close'] . ':00, closed weekdays ' . json_encode($rules['hours']['closedDays']) .
            ', capacity ' . $rules['dailyCapacity'] . ', ' . count((array)$rules['productLead']) . ' products have notice rules');
    } catch (Throwable $e) {
        add($checks, false, 'The menu and rules load', $e->getMessage(), 'Read the message, or send me a screenshot of this page.');
    }
}

$cookieOk = session_status() === PHP_SESSION_ACTIVE;
add($checks, $cookieOk, 'PHP sessions work', 'visits this session: ' . $_SESSION['visits'] . '  (session id ' . substr(session_id(), 0, 8) . '...)',
    'Refresh this page: "visits" must go up by one each time. If it stays at 1, the browser is blocking the cookie.');

$allOk = !in_array(false, array_column($checks, 'ok'), true);
?><!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KCH Bakery: connection status</title>
<style>
 body{font-family:system-ui,Segoe UI,sans-serif;max-width:860px;margin:30px auto;padding:0 16px;color:#1f2937}
 h1{margin-bottom:4px} .banner{padding:12px 16px;border-radius:8px;margin:14px 0;font-weight:600}
 .good{background:#e7f6ec;color:#14532d} .bad{background:#fdecec;color:#7f1d1d}
 .row{display:flex;gap:12px;padding:12px 0;border-top:1px solid #e5e7eb} .mark{font-size:20px;width:26px}
 .detail{color:#4b5563;font-size:14px;word-break:break-word} .fix{color:#92400e;font-size:14px;margin-top:4px}
</style></head><body>
<h1>KCH Bakery: PHP and database status</h1>
<div class="banner <?= $allOk ? 'good' : 'bad' ?>"><?= $allOk ? 'Everything is connected. Refresh once more to confirm the session counter goes up.' : 'Something needs fixing. Start with the first red item.' ?></div>
<?php foreach ($checks as $c): ?>
  <div class="row"><div class="mark"><?= $c['ok'] ? '✅' : '❌' ?></div>
    <div><b><?= $h($c['label']) ?></b>
      <?php if ($c['detail'] !== ''): ?><div class="detail"><?= $h($c['detail']) ?></div><?php endif; ?>
      <?php if (!$c['ok'] && $c['fix'] !== ''): ?><div class="fix">Fix: <?= $h($c['fix']) ?></div><?php endif; ?>
    </div></div>
<?php endforeach; ?>
<p style="margin-top:20px;color:#4b5563">Look at the raw data: <a href="catalog.php">catalog.php</a> &middot; <a href="rules.php">rules.php</a></p>
</body></html>
