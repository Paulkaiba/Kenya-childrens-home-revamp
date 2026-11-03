<?php
// GET /PHP/Staff/changes.php?scope=orders,menu,rules : returns a lightweight version hash of the database state.
declare(strict_types=1);

$boot = is_file(__DIR__ . '/../api/_bootstrap.php') ? __DIR__ . '/../api/_bootstrap.php' : __DIR__ . '/_bootstrap.php';
if (!is_file($boot)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Cannot find _bootstrap.php.']);
    exit;
}
require_once $boot;

// Session validation
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$me = $_SESSION['staff'] ?? null;
$scope = $_GET['scope'] ?? '';
$requestedScopes = explode(',', $scope);

if (in_array('orders', $requestedScopes) || in_array('staff', $requestedScopes)) {
    if (!$me) {
        http_response_code(401);
        echo json_encode(['ok' => false, 'error' => 'Not signed in']);
        exit;
    }
}

$pdo = db();
$combinedString = "";

// 1. ORDERS SCOPE FINGERPRINT
if (in_array('orders', $requestedScopes)) {
    $st = $pdo->query("SELECT md5(
        coalesce((SELECT string_agg(serial || ':' || status || ':' || cancel_requested::text || ':' || updated_at::text, ',' ORDER BY serial)
                  FROM customer_order WHERE created_at > now() - interval '60 days' OR status NOT IN ('Collected', 'Cancelled', 'Delivered')), '')
        || '|' ||
        coalesce((SELECT string_agg(l.id || ':' || l.status, ',' ORDER BY l.id)
                  FROM order_line l JOIN customer_order o ON o.serial = l.serial
                  WHERE o.created_at > now() - interval '60 days' OR o.status NOT IN ('Collected', 'Cancelled', 'Delivered')), ''))");
    $combinedString .= (string)$st->fetchColumn();
}

// 2. MENU SCOPE FINGERPRINT
if (in_array('menu', $requestedScopes)) {
    $st = $pdo->query("SELECT md5(
        coalesce((SELECT string_agg(id || ':' || sold_out::text || ':' || hidden::text || ':' || name || ':' || updated_at::text, ',' ORDER BY id) FROM product), '')
        || '|' ||
        coalesce((SELECT string_agg(product_id || ':' || size_id || ':' || price::text, ',' ORDER BY product_id, size_id) FROM product_size), ''))");
    $combinedString .= (string)$st->fetchColumn();
}

// 3. RULES SCOPE FINGERPRINT (CLEANED FROM SYNTAX ERRORS)
if (in_array('rules', $requestedScopes)) {
    $st = $pdo->query("SELECT md5(
        coalesce((SELECT open_hour || ':' || close_hour || ':' || daily_capacity FROM schedule_setting WHERE id = 1), '')
        || '|' || coalesce((SELECT string_agg(weekday::text, ',' ORDER BY weekday) FROM closed_weekday), '')
        || '|' || coalesce((SELECT string_agg(closed_on::text, ',' ORDER BY closed_on) FROM closed_date), '')
        || '|' || coalesce((SELECT string_agg(product_id || ':' || over_qty || ':' || notice_hours::text, ',' ORDER BY product_id) FROM product_notice_rule), ''))");
    $combinedString .= (string)$st->fetchColumn();
}

// Generate the final version master token
$finalVersionToken = md5($combinedString);

header('Content-Type: application/json; charset=utf-8');
echo json_encode(['ok' => true, 'version' => $finalVersionToken]);
exit;
