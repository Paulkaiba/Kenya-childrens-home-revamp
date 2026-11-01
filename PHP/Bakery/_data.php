<?php
// Reads the menu and the scheduling rules from PostgreSQL and shapes them EXACTLY like the data the website
// already uses (the same fields as CATALOG in Bakery/js/domain.js and DEFAULT_RULES in shared/store.js).
// Used by catalog.php, rules.php and the status page. Written for PHP 7.4 or newer.
declare(strict_types=1);

// PDO can hand booleans back as true/false or as 't'/'f' depending on the PHP version: accept both.
function to_bool($v): bool {
    return $v === true || $v === 't' || $v === 1 || $v === '1' || $v === 'true';
}

// numeric(10,2) arrives as the text "35.00": turn it into 35 (or 35.5 when there really are cents).
function to_num($v) {
    $f = (float)$v;
    return floor($f) == $f ? (int)$f : $f;
}

// $includeHidden = false for customers: products the manager hid are never sent to them.
function load_catalog(PDO $pdo, bool $includeHidden = false): array {
    $sql = 'SELECT id, name, category, emoji, description, to_json(ingredients) AS ingredients, to_json(allergens) AS allergens,
                   is_custom, sold_out, hidden, image_url
            FROM product ' . ($includeHidden ? '' : 'WHERE hidden = false ') . 'ORDER BY sort_order, id';
    $products = [];
    foreach ($pdo->query($sql) as $r) {
        $products[$r['id']] = [
            'id'          => $r['id'],
            'name'        => $r['name'],
            'category'    => $r['category'],
            'emoji'       => (string)$r['emoji'],
            'desc'        => (string)$r['description'],
            'ingredients' => json_decode((string)$r['ingredients'], true) ?: [],
            'allergens'   => json_decode((string)$r['allergens'], true) ?: [],
            'custom'      => to_bool($r['is_custom']),
            'soldOut'     => to_bool($r['sold_out']),
            'hidden'      => to_bool($r['hidden']),
            'image'       => (string)($r['image_url'] ?? ''),   // NULL in the database = no photo = ''
            'sizes'       => [],
            'flavours'    => [],
        ];
    }
    foreach ($pdo->query('SELECT product_id, size_id, label, price FROM product_size ORDER BY product_id, sort_order') as $r) {
        if (isset($products[$r['product_id']])) {
            $products[$r['product_id']]['sizes'][] = ['id' => $r['size_id'], 'label' => $r['label'], 'price' => to_num($r['price'])];
        }
    }
    foreach ($pdo->query('SELECT product_id, flavour FROM product_flavour ORDER BY product_id, sort_order') as $r) {
        if (isset($products[$r['product_id']])) {
            $products[$r['product_id']]['flavours'][] = $r['flavour'];
        }
    }
    return array_values($products);
}

function load_rules(PDO $pdo): array {
    $s = $pdo->query('SELECT open_hour, close_hour, daily_capacity FROM schedule_setting WHERE id = 1')->fetch();
    if (!$s) {
        throw new RuntimeException('The schedule_setting table is empty. Run kch_bakery_setup.sql on the kch_bakery database.');
    }
    $closedDays  = array_map('intval', $pdo->query('SELECT weekday FROM closed_weekday ORDER BY weekday')->fetchAll(PDO::FETCH_COLUMN));
    $closedDates = $pdo->query("SELECT to_char(closed_on, 'YYYY-MM-DD') FROM closed_date ORDER BY closed_on")->fetchAll(PDO::FETCH_COLUMN);
    $lead = [];
    foreach ($pdo->query('SELECT product_id, over_qty, notice_hours FROM product_notice_rule ORDER BY product_id, over_qty') as $r) {
        $lead[$r['product_id']][] = ['over' => (int)$r['over_qty'], 'hours' => (int)$r['notice_hours']];
    }
    return [
        'productLead'   => (object)$lead,               // { productId: [{ over, hours }] }  (an object, even when empty)
        'hours'         => ['open' => (int)$s['open_hour'], 'close' => (int)$s['close_hour'], 'closedDays' => $closedDays],
        'closedDates'   => $closedDates,
        'dailyCapacity' => (int)$s['daily_capacity'],
    ];
}
