<?php
// Order rules on the SERVER. They repeat the rules the website applies in the browser (Bakery/js/domain.js), because the server
// must never trust the browser: prices, notice times, opening hours and daily capacity are all checked again here.
// PHP 7.4 or newer. The pure rule functions (kch_earliest, kch_slot_valid, ...) are proven against the JavaScript by selftest.php.
declare(strict_types=1);

const KCH_TZ = 'Africa/Nairobi';
const KCH_MIN_PREP_HOURS = 2;       // same numbers as the Scheduler in Bakery/js/domain.js
const KCH_LATE_CUTOFF_HOUR = 17;
const KCH_LATE_FLOOR_HOUR = 15;
const KCH_CANCEL_HOURS = 24;
const KCH_MAX_LINES = 50;
const KCH_MAX_QTY = 200;
const KCH_ISO_FMT = "YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"";   // how the database prints times so JavaScript can read them

// ---------------------------------------------------------------- small helpers
function kch_tz(): DateTimeZone { static $tz = null; if ($tz === null) { $tz = new DateTimeZone(KCH_TZ); } return $tz; }
function kch_now(): DateTimeImmutable { return new DateTimeImmutable('now', kch_tz()); }

// Only accept proper ISO times like 2026-10-05T09:00:00.000Z (what JavaScript's toISOString() sends).
function kch_parse_time($v): ?DateTimeImmutable {
    if (!is_string($v) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/', $v)) { return null; }
    try { return (new DateTimeImmutable($v))->setTimezone(kch_tz()); } catch (Exception $e) { return null; }
}
function kch_strlen(string $s): int { return function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') : strlen($s); }
function kch_substr(string $s, int $n): string { return function_exists('mb_substr') ? mb_substr($s, 0, $n, 'UTF-8') : substr($s, 0, $n); }
// Free text from a customer: no HTML tags (staff screens will show it), one line, limited length.
function kch_clean($v, int $max): string {
    $s = trim(strip_tags((string)$v));
    $s = preg_replace('/\s+/u', ' ', $s);
    return kch_substr($s === null ? '' : $s, $max);
}

// ---------------------------------------------------------------- customer (same rules as the Customer class in domain.js)
function kch_normalize_phone($p): string {
    $d = preg_replace('/\D/', '', (string)$p);
    return strpos($d, '254') === 0 ? $d : '254' . preg_replace('/^0/', '', $d);
}
function kch_customer_errors(array $c): array {
    $e = [];
    if (kch_strlen(trim((string)($c['name'] ?? ''))) < 2) { $e[] = 'Enter your full name'; }
    if (!preg_match('/^254[17]\d{8}$/', (string)($c['phone'] ?? ''))) { $e[] = 'Enter a valid Kenyan phone number'; }
    if (!preg_match('/^\S+@\S+\.\S+$/', (string)($c['email'] ?? ''))) { $e[] = 'Enter a valid email address'; }
    return $e;
}

// ---------------------------------------------------------------- notice times (same maths as TieredLead / Cart.leadHoursFor)
// $tiers = [['over' => 30, 'hours' => 24], ...]: the tier with the highest "over" that qty is MORE than wins.
function kch_tier_hours(array $tiers, int $qty): int {
    usort($tiers, function ($a, $b) { return $b['over'] <=> $a['over']; });
    foreach ($tiers as $t) {
        if ($qty > $t['over']) { return (int)$t['hours']; }
    }
    return 0;
}
// $lines = [['productId' => 'qc', 'bucket' => 'pastry', 'qty' => 3], ...]. Each product is judged on its own total in the bucket.
function kch_lead_hours_for_bucket(array $lines, string $bucket, array $productLead): int {
    $qty = [];
    foreach ($lines as $l) {
        if ($l['bucket'] === $bucket) { $qty[$l['productId']] = ($qty[$l['productId']] ?? 0) + (int)$l['qty']; }
    }
    $max = 0;
    foreach ($qty as $id => $q) {
        $tiers = $productLead[$id] ?? [];
        $max = max($max, kch_tier_hours(is_array($tiers) ? $tiers : [], (int)$q));
    }
    return $max;
}

// ---------------------------------------------------------------- pickup times (same maths as Scheduler in domain.js)
function kch_earliest(DateTimeImmutable $now, int $leadHours, int $open): DateTimeImmutable {
    $t = $now->modify('+' . max($leadHours, KCH_MIN_PREP_HOURS) . ' hours');
    $h = (int)$now->format('G');
    if ($h >= KCH_LATE_CUTOFF_HOUR) {            // evening order: not before 3pm tomorrow
        $floor = $now->setTime(KCH_LATE_FLOOR_HOUR, 0)->modify('+1 day');
        if ($t < $floor) { $t = $floor; }
    } elseif ($h < $open) {                      // early-morning order: not before opening tomorrow
        $floor = $now->setTime($open, 0)->modify('+1 day');
        if ($t < $floor) { $t = $floor; }
    }
    return $t;
}
// $rules = ['hours' => ['open', 'close', 'closedDays' => [0]], 'closedDates' => ['YYYY-MM-DD']]; $fullDates = days at capacity.
function kch_slot_valid(DateTimeImmutable $when, int $leadHours, array $rules, array $fullDates, DateTimeImmutable $now): bool {
    $h = $rules['hours'];
    if ($when->format('i:s') !== '00:00') { return false; }               // pickups are on the hour
    $hour = (int)$when->format('G');
    if ($hour < (int)$h['open'] || $hour >= (int)$h['close']) { return false; }
    if (in_array((int)$when->format('w'), array_map('intval', $h['closedDays']), true)) { return false; }
    $ymd = $when->format('Y-m-d');
    if (in_array($ymd, $rules['closedDates'], true) || in_array($ymd, $fullDates, true)) { return false; }
    return $when >= kch_earliest($now, $leadHours, (int)$h['open']);
}

// ---------------------------------------------------------------- capacity
// Days (from $ymds) that already hold the daily maximum of active orders. Cancelled orders do not count.
function kch_full_dates_for(PDO $pdo, array $ymds, int $capacity): array {
    $full = [];
    $st = $pdo->prepare("SELECT count(DISTINCT p.serial) FROM order_pickup p JOIN customer_order o ON o.serial = p.serial
                         WHERE o.status <> 'Cancelled' AND (p.pickup_at AT TIME ZONE 'Africa/Nairobi')::date = CAST(:d AS date)");
    foreach (array_unique($ymds) as $d) {
        $st->execute([':d' => $d]);
        if ((int)$st->fetchColumn() >= $capacity) { $full[] = $d; }
    }
    return $full;
}
// Upcoming full days, sent to the website so its calendar can grey them out.
function load_full_dates(PDO $pdo, int $capacity): array {
    $st = $pdo->prepare("SELECT to_char(d, 'YYYY-MM-DD') FROM (
                            SELECT (p.pickup_at AT TIME ZONE 'Africa/Nairobi')::date AS d, count(DISTINCT p.serial) AS n
                            FROM order_pickup p JOIN customer_order o ON o.serial = p.serial
                            WHERE o.status <> 'Cancelled' AND (p.pickup_at AT TIME ZONE 'Africa/Nairobi')::date >= (now() AT TIME ZONE 'Africa/Nairobi')::date
                            GROUP BY 1) x
                         WHERE n >= :cap ORDER BY d");
    $st->execute([':cap' => $capacity]);
    return $st->fetchAll(PDO::FETCH_COLUMN);
}

// ---------------------------------------------------------------- reading orders back, shaped like the orders the website already uses
function kch_iso(string $col): string { return "to_char($col AT TIME ZONE 'UTC', '" . KCH_ISO_FMT . "')"; }

// $whereSql uses the alias "o" and named parameters, e.g. 'o.serial = :s'.
function kch_fetch_orders(PDO $pdo, string $whereSql, array $params, int $limit = 50): array {
    $sql = 'SELECT o.serial, o.status, o.cancel_requested, o.fulfilment, o.location, o.delivery_fee, o.notes, o.total,
                   o.customer_name, o.customer_phone, o.customer_email, ' .
                   kch_iso('o.earliest_pickup') . ' AS earliest, ' . kch_iso('o.created_at') . ' AS created, ' . kch_iso('o.updated_at') . ' AS updated
            FROM customer_order o WHERE ' . $whereSql . ' ORDER BY o.created_at DESC, o.serial DESC LIMIT ' . (int)$limit;
    $st = $pdo->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll();
    if (!$rows) { return []; }
    $serials = array_column($rows, 'serial');
    $marks = implode(',', array_fill(0, count($serials), '?'));

    $pickups = [];
    $st = $pdo->prepare('SELECT serial, bucket, ' . kch_iso('pickup_at') . " AS pick_at FROM order_pickup WHERE serial IN ($marks) ORDER BY bucket");
    $st->execute($serials);
    foreach ($st->fetchAll() as $r) { $pickups[$r['serial']][$r['bucket']] = $r['pick_at']; }

    $lines = [];
    $st = $pdo->prepare("SELECT id, serial, name, size_label, flavour, message, qty, unit_price, bucket, status FROM order_line
                         WHERE serial IN ($marks) ORDER BY serial, length(id), id");
    $st->execute($serials);
    foreach ($st->fetchAll() as $r) {
        $lines[$r['serial']][] = ['id' => $r['id'], 'name' => $r['name'], 'size' => $r['size_label'], 'flavour' => $r['flavour'], 'message' => $r['message'],
                                  'qty' => (int)$r['qty'], 'price' => to_num($r['unit_price']), 'bucket' => $r['bucket'], 'status' => $r['status']];
    }

    $out = [];
    foreach ($rows as $r) {
        $out[] = [
            'serial' => $r['serial'], 'fulfilment' => $r['fulfilment'], 'location' => (string)$r['location'], 'fee' => to_num($r['delivery_fee']),
            'notes' => (string)$r['notes'], 'status' => $r['status'], 'cancelRequested' => to_bool($r['cancel_requested']), 'total' => to_num($r['total']),
            'customer' => ['name' => $r['customer_name'], 'phone' => $r['customer_phone'], 'email' => $r['customer_email']],
            'lines' => $lines[$r['serial']] ?? [],
            'pickups' => (object)($pickups[$r['serial']] ?? []),
            'when' => $r['earliest'], 'createdAt' => $r['created'], 'updatedAt' => $r['updated'],
        ];
    }
    return $out;
}

// ---------------------------------------------------------------- placing an order
// $in = what the website sends: customer, fulfilment, location, notes, lines [{productId,size,flavour,message,qty}], pickups {bucket: ISO time}.
// $dryRun = do everything, then ROLL BACK (used by selftest.php, so tests leave no trace). $inTx = optional extra checks inside the transaction.
// Returns ['ok' => true, 'order' => ...] or ['ok' => false, 'errors' => [...]]. Uses the same error wording as the website.
function kch_create_order(PDO $pdo, array $in, ?DateTimeImmutable $now = null, bool $dryRun = false, ?callable $inTx = null): array {
    $now = $now ?: kch_now();
    $pdo->beginTransaction();
    try {
        // One order at a time: this keeps "daily capacity" and the order numbers exact even if two customers click together.
        $pdo->query('SELECT pg_advisory_xact_lock(727001)')->closeCursor();
        $errors = [];

        // ---- customer
        $raw = is_array($in['customer'] ?? null) ? $in['customer'] : [];
        $cust = ['name' => kch_clean($raw['name'] ?? '', 80), 'phone' => kch_normalize_phone($raw['phone'] ?? ''),
                 'email' => strtolower(trim((string)($raw['email'] ?? '')))];
        $errors = kch_customer_errors($cust);

        // ---- items: names, sizes and prices come from the DATABASE, never from the browser
        $fulfilment = (($in['fulfilment'] ?? '') === 'delivery') ? 'delivery' : 'pickup';
        $location = $fulfilment === 'delivery' ? kch_clean($in['location'] ?? '', 200) : '';
        $notes = kch_clean($in['notes'] ?? '', 500);
        $inLines = is_array($in['lines'] ?? null) ? array_values($in['lines']) : [];
        $lines = [];
        $pStmt = $pdo->prepare('SELECT id, name, category, sold_out, hidden FROM product WHERE id = :id');
        $sStmt = $pdo->prepare('SELECT label, price FROM product_size WHERE product_id = :id AND size_id = :s');
        $fStmt = $pdo->prepare('SELECT flavour FROM product_flavour WHERE product_id = :id');
        if (!$inLines) { $errors[] = 'Your cart is empty'; }
        elseif (count($inLines) > KCH_MAX_LINES) { $errors[] = 'There are too many items in one order. Please split it into two orders'; }
        else {
            foreach ($inLines as $l) {
                if (!is_array($l)) { $errors[] = 'One of the items in your cart is not valid'; continue; }
                $pid = (string)($l['productId'] ?? '');
                $qty = (int)($l['qty'] ?? 0);
                $pStmt->execute([':id' => $pid]);
                $p = $pStmt->fetch();
                if (!$p || to_bool($p['hidden'])) { $errors[] = 'An item in your cart is no longer on the menu'; continue; }
                if (to_bool($p['sold_out'])) { $errors[] = $p['name'] . ' is sold out'; continue; }
                if ($qty < 1 || $qty > KCH_MAX_QTY) { $errors[] = 'Choose a quantity between 1 and ' . KCH_MAX_QTY . ' for ' . $p['name']; continue; }
                $sStmt->execute([':id' => $pid, ':s' => (string)($l['size'] ?? '')]);
                $s = $sStmt->fetch();
                if (!$s) { $errors[] = 'The size chosen for ' . $p['name'] . ' is not available'; continue; }
                $fStmt->execute([':id' => $pid]);
                $flavours = $fStmt->fetchAll(PDO::FETCH_COLUMN);
                $flavour = kch_clean($l['flavour'] ?? '', 60);
                if ($flavours && !in_array($flavour, $flavours, true)) { $errors[] = 'Choose a flavour for ' . $p['name']; continue; }
                $message = kch_clean($l['message'] ?? '', 120);
                $lines[] = ['productId' => $p['id'], 'name' => $p['name'], 'bucket' => $p['category'], 'size' => $s['label'], 'price' => to_num($s['price']),
                            'flavour' => $flavour === '' ? null : $flavour, 'message' => $message === '' ? null : $message, 'qty' => $qty];
            }
        }

        // ---- pickup time for each group of items (bread / cakes / pastries)
        $rules = load_rules($pdo);
        $productLead = (array)$rules['productLead'];
        $pickupsIn = is_array($in['pickups'] ?? null) ? $in['pickups'] : [];
        $buckets = array_values(array_unique(array_column($lines, 'bucket')));
        $whens = [];
        foreach ($buckets as $b) { $whens[$b] = kch_parse_time($pickupsIn[$b] ?? null); }
        $dates = [];
        foreach ($whens as $w) { if ($w) { $dates[] = $w->format('Y-m-d'); } }
        $full = $dates ? kch_full_dates_for($pdo, $dates, (int)$rules['dailyCapacity']) : [];
        foreach ($buckets as $b) {
            $lead = kch_lead_hours_for_bucket($lines, $b, $productLead);
            if (!$whens[$b] || !kch_slot_valid($whens[$b], $lead, $rules, $full, $now)) {
                $errors[] = 'Pick an available date and time for ' . ($b === 'cake' ? 'the cakes' : 'the rest of your order');
            }
        }
        if ($fulfilment === 'delivery' && $location === '') { $errors[] = 'Enter your delivery location'; }

        if ($errors) { $pdo->rollBack(); return ['ok' => false, 'errors' => array_values(array_unique($errors))]; }

        // ---- save
        $total = 0;
        foreach ($lines as $l) { $total += $l['price'] * $l['qty']; }
        $earliest = null;
        foreach ($whens as $w) { if ($earliest === null || $w < $earliest) { $earliest = $w; } }
        $serial = (string)$pdo->query('SELECT next_order_serial()')->fetchColumn();

        $pdo->prepare('INSERT INTO customer_order (serial, status, cancel_requested, fulfilment, location, delivery_fee, notes, total,
                                                   customer_name, customer_phone, customer_email, earliest_pickup)
                       VALUES (:serial, \'Received\', false, :f, :loc, 0, :notes, :total, :n, :p, :e, :earliest)')
            ->execute([':serial' => $serial, ':f' => $fulfilment, ':loc' => $location, ':notes' => $notes, ':total' => $total,
                       ':n' => $cust['name'], ':p' => $cust['phone'], ':e' => $cust['email'], ':earliest' => $earliest->format('c')]);
        $pk = $pdo->prepare('INSERT INTO order_pickup (serial, bucket, pickup_at) VALUES (:s, :b, :t)');
        foreach ($whens as $b => $w) { $pk->execute([':s' => $serial, ':b' => $b, ':t' => $w->format('c')]); }
        $ln = $pdo->prepare('INSERT INTO order_line (id, serial, product_id, name, size_label, flavour, message, qty, unit_price, bucket, status)
                             VALUES (:id, :s, :pid, :name, :size, :fl, :msg, :qty, :price, :b, \'Received\')');
        foreach ($lines as $i => $l) {
            $ln->execute([':id' => $serial . '-L' . ($i + 1), ':s' => $serial, ':pid' => $l['productId'], ':name' => $l['name'], ':size' => $l['size'],
                          ':fl' => $l['flavour'], ':msg' => $l['message'], ':qty' => $l['qty'], ':price' => $l['price'], ':b' => $l['bucket']]);
        }
        $order = kch_fetch_orders($pdo, 'o.serial = :s', [':s' => $serial], 1)[0];
        if ($inTx) { $inTx($pdo, $order); }
        if ($dryRun) { $pdo->rollBack(); } else { $pdo->commit(); }
        return ['ok' => true, 'order' => $order];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) { $pdo->rollBack(); }
        throw $e;
    }
}

// ---------------------------------------------------------------- looking orders up and asking to cancel
// An order is only shown when the phone number AND the email both match what was entered when it was placed.
function kch_find_orders(PDO $pdo, string $phone, string $email): array {
    $p = kch_normalize_phone($phone); $e = strtolower(trim($email));
    if ($p === '254' || $e === '') { return []; }
    return kch_fetch_orders($pdo, 'o.customer_phone = :p AND lower(o.customer_email) = :e', [':p' => $p, ':e' => $e]);
}

// A cancellation is a REQUEST: the status does not change; staff approve or reject it. Needs serial + phone + email to all match.
function kch_request_cancel(PDO $pdo, string $serial, string $phone, string $email, ?DateTimeImmutable $now = null): array {
    $now = $now ?: kch_now();
    $own = !$pdo->inTransaction();
    if ($own) { $pdo->beginTransaction(); }
    try {
        $st = $pdo->prepare("SELECT status, cancel_requested, floor(extract(epoch FROM earliest_pickup))::bigint AS pickup_ts FROM customer_order
                             WHERE serial = :s AND customer_phone = :p AND lower(customer_email) = :e FOR UPDATE");
        $st->execute([':s' => $serial, ':p' => kch_normalize_phone($phone), ':e' => strtolower(trim($email))]);
        $o = $st->fetch();
        if (!$o || !in_array($o['status'], ['Received', 'Confirmed'], true) || to_bool($o['cancel_requested'])) {
            if ($own) { $pdo->rollBack(); }
            return ['ok' => false, 'errors' => ['This order cannot be cancelled']];
        }
        if ((int)$o['pickup_ts'] - $now->getTimestamp() < KCH_CANCEL_HOURS * 3600) {
            if ($own) { $pdo->rollBack(); }
            return ['ok' => false, 'errors' => ['Orders can only be cancelled 24 hours before pickup']];
        }
        $pdo->prepare('UPDATE customer_order SET cancel_requested = true, updated_at = now() WHERE serial = :s')->execute([':s' => $serial]);
        $order = kch_fetch_orders($pdo, 'o.serial = :s', [':s' => $serial], 1)[0];
        if ($own) { $pdo->commit(); }
        return ['ok' => true, 'order' => $order];
    } catch (Throwable $e) {
        if ($own && $pdo->inTransaction()) { $pdo->rollBack(); }
        throw $e;
    }
}

// ---------------------------------------------------------------- request plumbing
function kch_require_post(): void {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { json_out(['ok' => false, 'error' => 'This address only accepts POST requests.'], 405); }
}
function kch_read_json(): array {
    $raw = (string)file_get_contents('php://input');
    if (strlen($raw) > 200000) { json_out(['ok' => false, 'error' => 'That request is too large.'], 413); }
    $d = json_decode($raw, true);
    if (!is_array($d)) { json_out(['ok' => false, 'error' => 'Expected JSON.'], 400); }
    return $d;
}
// Slows down people guessing phone numbers: at most $max tries per $seconds for each browser session.
function kch_throttle(string $key, int $max, int $seconds): void {
    if (session_status() !== PHP_SESSION_ACTIVE) { session_start(); }
    $now = time();
    $tries = array_values(array_filter($_SESSION['throttle'][$key] ?? [], function ($t) use ($now, $seconds) { return $t > $now - $seconds; }));
    if (count($tries) >= $max) { json_out(['ok' => false, 'error' => 'Too many tries. Please wait a few minutes and try again.'], 429); }
    $tries[] = $now;
    $_SESSION['throttle'][$key] = $tries;
}
