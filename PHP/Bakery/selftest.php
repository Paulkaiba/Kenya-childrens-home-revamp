<?php
// Open http://localhost:8000/PHP/Bakery/selftest.php
// Part A proves the PHP order rules give the same answers as the website's JavaScript (hundreds of cases, no database needed).
// Part B runs a real order through the database and then ROLLS IT BACK, so nothing is left behind.
declare(strict_types=1);
require __DIR__ . '/_init.php';
restore_exception_handler();

$h = function ($s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); };
$tz = kch_tz();
$vec = json_decode((string)@file_get_contents(__DIR__ . '/selftest_vectors.json'), true);

$groups = [];   // name => ['pass' => n, 'fail' => n, 'bad' => [messages]]
function record(array &$groups, string $group, bool $ok, string $detail): void {
    if (!isset($groups[$group])) { $groups[$group] = ['pass' => 0, 'fail' => 0, 'bad' => []]; }
    if ($ok) { $groups[$group]['pass']++; } else { $groups[$group]['fail']++; if (count($groups[$group]['bad']) < 6) { $groups[$group]['bad'][] = $detail; } }
}

// ---------------------------------------------------------------- Part A: rules vs JavaScript
if (!is_array($vec)) {
    record($groups, 'A. Test cases file', false, 'selftest_vectors.json is missing or not valid JSON (it must sit next to this file).');
} else {
    foreach ($vec['phone'] as $v) {
        $cust = ['name' => trim($v['name']), 'phone' => kch_normalize_phone($v['phone']), 'email' => strtolower(trim($v['email']))];
        $ok = $cust['phone'] === $v['normalized'] && $cust['email'] === $v['emailClean'] && kch_customer_errors($cust) === $v['errors'];
        record($groups, 'A1. Customer name, phone and email checks', $ok, json_encode([$v['phone'], $cust['phone'], $v['normalized'], kch_customer_errors($cust), $v['errors']]));
    }
    foreach ($vec['earliest'] as $v) {
        $now = (new DateTimeImmutable($v['now']))->setTimezone($tz);
        $got = kch_earliest($now, (int)$v['lead'], (int)$v['open'])->getTimestamp();
        record($groups, 'A2. Earliest allowed pickup time', $got === $v['expected'], "now {$v['now']} lead {$v['lead']}: PHP $got, JavaScript {$v['expected']}");
    }
    foreach ($vec['slots'] as $v) {
        $now = (new DateTimeImmutable($v['now']))->setTimezone($tz);
        $when = (new DateTimeImmutable($v['when']))->setTimezone($tz);
        $rules = ['hours' => ['open' => $v['rules']['open'], 'close' => $v['rules']['close'], 'closedDays' => $v['rules']['closedDays']], 'closedDates' => $v['rules']['closedDates']];
        $got = kch_slot_valid($when, (int)$v['lead'], $rules, $v['fullDates'], $now);
        record($groups, 'A3. Is this pickup time allowed?', $got === $v['expected'], "now {$v['now']} lead {$v['lead']} pickup {$v['when']}: PHP " . json_encode($got) . ', JavaScript ' . json_encode($v['expected']));
    }
    foreach ($vec['lead'] as $v) {
        $got = kch_lead_hours_for_bucket($v['lines'], $v['bucket'], $v['productLead']);
        record($groups, 'A4. Notice needed for the items', $got === $v['expected'], json_encode($v['lines']) . ": PHP $got, JavaScript {$v['expected']}");
    }
}

// ---------------------------------------------------------------- Part B: the database (everything is rolled back)
$db = [];   // [ok, label, detail]
function dbcheck(array &$db, bool $ok, string $label, string $detail = ''): void { $db[] = [$ok, $label, $detail]; }

try {
    $pdo = db();
    $before = (int)$pdo->query('SELECT count(*) FROM customer_order')->fetchColumn();
    $counterBefore = (string)$pdo->query('SELECT coalesce(sum(last_number), 0) FROM order_serial_counter')->fetchColumn();
    dbcheck($db, true, 'Connected to the database', "orders before the test: $before");

    $rules = load_rules($pdo);
    $now = kch_now();
    $prod = $pdo->query("SELECT p.id, s.size_id FROM product p JOIN product_size s ON s.product_id = p.id
                         WHERE p.category = 'bread' AND p.sold_out = false AND p.hidden = false ORDER BY p.sort_order, s.sort_order LIMIT 1")->fetch();
    if (!$prod) { throw new RuntimeException('No bread product is available to test with.'); }
    $lead = kch_lead_hours_for_bucket([['productId' => $prod['id'], 'bucket' => 'bread', 'qty' => 2]], 'bread', (array)$rules['productLead']);
    $when = null;
    for ($d = 0; $d < 21 && !$when; $d++) {
        for ($hr = (int)$rules['hours']['open']; $hr < (int)$rules['hours']['close'] && !$when; $hr++) {
            $cand = $now->setTime($hr, 0)->modify("+$d day");
            if (kch_slot_valid($cand, $lead, $rules, [], $now)) { $when = $cand; }
        }
    }
    if (!$when) { throw new RuntimeException('Could not find any open pickup time in the next 3 weeks. Check the opening hours and closed days.'); }
    $isoUtc = $when->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.000\Z');
    dbcheck($db, true, 'Found the first open pickup slot', $when->format('D j M Y, H:i') . " (needs $lead hours' notice)");

    $good = ['customer' => ['name' => 'Self Test', 'phone' => '0712 345 678', 'email' => 'SelfTest@Example.com'], 'fulfilment' => 'pickup', 'notes' => 'selftest <b>tags</b> removed',
             'lines' => [['productId' => $prod['id'], 'size' => $prod['size_id'], 'flavour' => '', 'message' => '', 'qty' => 2]], 'pickups' => ['bread' => $isoUtc]];

    $inTx = function (PDO $pdo, array $order) use (&$db, $when, $now) {
        $far = $when->modify('-3 days');
        $wrong = kch_request_cancel($pdo, $order['serial'], '0712345678', 'wrong@example.com', $far);
        dbcheck($db, !$wrong['ok'], 'Cancel request is refused when the email does not match', json_encode($wrong['errors'] ?? []));
        $none = kch_find_orders($pdo, '0712345678', 'wrong@example.com');
        dbcheck($db, count($none) === 0, 'My Orders shows nothing when the email does not match', 'orders found: ' . count($none));
        $found = kch_find_orders($pdo, '+254 712 345 678', ' SELFTEST@example.com ');
        dbcheck($db, count($found) === 1 && $found[0]['serial'] === $order['serial'], 'My Orders finds the order when phone AND email match (any spacing or capitals)', 'orders found: ' . count($found));
        $soon = kch_request_cancel($pdo, $order['serial'], '0712345678', 'selftest@example.com', $when->modify('-2 hours'));
        dbcheck($db, !$soon['ok'] && ($soon['errors'][0] ?? '') === 'Orders can only be cancelled 24 hours before pickup', 'Cancel request is refused less than 24 hours before pickup', json_encode($soon['errors'] ?? []));
        $ok = kch_request_cancel($pdo, $order['serial'], '0712345678', 'selftest@example.com', $far);
        dbcheck($db, $ok['ok'] && $ok['order']['cancelRequested'] === true && $ok['order']['status'] === 'Received', 'Cancel request is saved as a request (status stays Received)', json_encode($ok['errors'] ?? $ok['order']['status']));
        $again = kch_request_cancel($pdo, $order['serial'], '0712345678', 'selftest@example.com', $far);
        dbcheck($db, !$again['ok'], 'A second cancel request is refused', json_encode($again['errors'] ?? []));
    };

    $r = kch_create_order($pdo, $good, null, true, $inTx);
    if (!$r['ok']) {
        dbcheck($db, false, 'A valid order is accepted', json_encode($r['errors']));
    } else {
        $o = $r['order'];
        dbcheck($db, (bool)preg_match('/^KBK-\d{8}-\d{4}$/', $o['serial']), 'Order number has the right format', $o['serial']);
        dbcheck($db, $o['customer']['phone'] === '254712345678' && $o['customer']['email'] === 'selftest@example.com', 'Phone and email are saved in the standard form', json_encode($o['customer']));
        $line = $o['lines'][0] ?? [];
        $dbPrice = $pdo->prepare('SELECT price FROM product_size WHERE product_id = :p AND size_id = :s');
        $dbPrice->execute([':p' => $prod['id'], ':s' => $prod['size_id']]);
        $unit = to_num($dbPrice->fetchColumn());
        dbcheck($db, ($line['price'] ?? null) === $unit && $o['total'] === $unit * 2, 'Price and total come from the database', 'unit ' . json_encode($line['price'] ?? null) . ', total ' . json_encode($o['total']));
        dbcheck($db, strpos($o['notes'], '<') === false, 'HTML tags are stripped from notes', $o['notes']);
        dbcheck($db, isset($o['pickups']->bread) && $o['when'] === $o['pickups']->bread && $o['when'] === $isoUtc, 'Pickup time is saved and read back in the same format the website uses', $o['when']);
        dbcheck($db, $o['status'] === 'Received' && ($line['status'] ?? '') === 'Received' && $o['cancelRequested'] === false, 'New order and its item start as Received', $o['status']);
    }

    $bad = [
        'An empty cart is refused'                      => [array_merge($good, ['lines' => []]), 'Your cart is empty'],
        'A bad phone number is refused'                 => [array_merge($good, ['customer' => ['name' => 'Self Test', 'phone' => '12345', 'email' => 'a@b.co']]), 'Enter a valid Kenyan phone number'],
        'A pickup time in the past is refused'          => [array_merge($good, ['pickups' => ['bread' => $now->modify('-1 day')->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.000\Z')]]), 'Pick an available date and time'],
        'A missing pickup time is refused'              => [array_merge($good, ['pickups' => []]), 'Pick an available date and time'],
        'An unknown product is refused'                 => [array_merge($good, ['lines' => [['productId' => 'nope', 'size' => 'x', 'qty' => 1]]]), 'no longer on the menu'],
        'A wrong size is refused'                       => [array_merge($good, ['lines' => [['productId' => $prod['id'], 'size' => 'nope', 'qty' => 1]]]), 'size chosen'],
        'A delivery with no address is refused'         => [array_merge($good, ['fulfilment' => 'delivery', 'location' => '']), 'Enter your delivery location'],
        'A quantity of 0 is refused'                    => [array_merge($good, ['lines' => [['productId' => $prod['id'], 'size' => $prod['size_id'], 'qty' => 0]]]), 'quantity'],
    ];
    foreach ($bad as $label => $case) {
        $res = kch_create_order($pdo, $case[0], null, true);
        $msg = json_encode($res['errors'] ?? 'accepted');
        dbcheck($db, !$res['ok'] && strpos((string)$msg, $case[1]) !== false, $label, $msg);
    }

    $full = load_full_dates($pdo, (int)$rules['dailyCapacity']);
    dbcheck($db, is_array($full), 'The list of full days can be read (rules.php)', 'full days now: ' . json_encode($full));
    $after = (int)$pdo->query('SELECT count(*) FROM customer_order')->fetchColumn();
    $counterAfter = (string)$pdo->query('SELECT coalesce(sum(last_number), 0) FROM order_serial_counter')->fetchColumn();
    dbcheck($db, $after === $before && $counterAfter === $counterBefore, 'Test orders were rolled back (nothing left behind)', "orders $before -> $after, order-number counter $counterBefore -> $counterAfter");
} catch (Throwable $e) {
    dbcheck($db, false, 'Database test stopped with an error', get_class($e) . ': ' . $e->getMessage() . '  (' . basename($e->getFile()) . ' line ' . $e->getLine() . ')');
}

$aFail = array_sum(array_column($groups, 'fail'));
$bFail = count(array_filter($db, function ($r) { return !$r[0]; }));
?><!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KCH Bakery: order rules self-test</title>
<style>
 body{font-family:system-ui,Segoe UI,sans-serif;max-width:900px;margin:30px auto;padding:0 16px;color:#1f2937}
 .banner{padding:12px 16px;border-radius:8px;margin:14px 0;font-weight:600} .good{background:#e7f6ec;color:#14532d} .bad{background:#fdecec;color:#7f1d1d}
 .row{display:flex;gap:12px;padding:10px 0;border-top:1px solid #e5e7eb} .mark{width:26px;font-size:18px} .detail{color:#4b5563;font-size:13px;word-break:break-word}
 code{background:#f3f4f6;padding:1px 4px;border-radius:4px}
</style></head><body>
<h1>Order rules self-test</h1>
<div class="banner <?= ($aFail + $bFail) === 0 ? 'good' : 'bad' ?>"><?= ($aFail + $bFail) === 0 ? 'Everything passed.' : ($aFail + $bFail) . ' check(s) failed. Send me a screenshot of this page.' ?></div>

<h2>Part A: do the PHP rules match the website's JavaScript?</h2>
<?php foreach ($groups as $name => $g): $ok = $g['fail'] === 0; ?>
  <div class="row"><div class="mark"><?= $ok ? '✅' : '❌' ?></div><div><b><?= $h($name) ?></b>: <?= $g['pass'] ?> of <?= $g['pass'] + $g['fail'] ?> match
    <?php foreach ($g['bad'] as $b): ?><div class="detail">Mismatch: <?= $h($b) ?></div><?php endforeach; ?></div></div>
<?php endforeach; ?>

<h2>Part B: the database (test orders are rolled back)</h2>
<?php foreach ($db as $r): ?>
  <div class="row"><div class="mark"><?= $r[0] ? '✅' : '❌' ?></div><div><b><?= $h($r[1]) ?></b><?php if ($r[2] !== ''): ?><div class="detail"><?= $h($r[2]) ?></div><?php endif; ?></div></div>
<?php endforeach; ?>
</body></html>
