<?php
// GET /PHP/Staff/rules.php : fetch scheduling rules
// POST /PHP/Staff/rules.php : save scheduling rules
declare(strict_types=1);

require __DIR__ . '/../Bakery/_init.php';

header('Cache-Control: no-store');
header('Content-Type: application/json; charset=utf-8');

try {
    $pdo = db();
    
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $rules = load_rules($pdo);
        echo json_encode(['ok' => true, 'rules' => $rules]);
        exit;
    }
    
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $in = kch_read_json();
        $r = $in['rules'] ?? null;
        
        if (!$r) {
            echo json_encode(['ok' => false, 'error' => 'Missing rules data']);
            exit;
        }
        
        $pdo->beginTransaction();
        
        $pdo->prepare("UPDATE schedule_setting SET open_hour = :o, close_hour = :c, daily_capacity = :cap WHERE id = 1")
            ->execute([':o' => $r['hours']['open'], ':c' => $r['hours']['close'], ':cap' => $r['dailyCapacity']]);
            
        $pdo->exec("DELETE FROM closed_weekday");
        if (!empty($r['hours']['closedDays'])) {
            $stmt = $pdo->prepare("INSERT INTO closed_weekday (weekday) VALUES (:d)");
            foreach ($r['hours']['closedDays'] as $d) { $stmt->execute([':d' => (int)$d]); }
        }
        
        $pdo->exec("DELETE FROM closed_date");
        if (!empty($r['closedDates'])) {
            $stmt = $pdo->prepare("INSERT INTO closed_date (closed_on) VALUES (:d)");
            foreach ($r['closedDates'] as $d) { $stmt->execute([':d' => $d]); }
        }
        
        $pdo->exec("DELETE FROM product_notice_rule");
        if (!empty($r['productLead'])) {
            $stmt = $pdo->prepare("INSERT INTO product_notice_rule (product_id, over_qty, notice_hours) VALUES (:pid, :over, :hours)");
            foreach ($r['productLead'] as $pid => $tiers) {
                foreach ($tiers as $tier) {
                    $stmt->execute([':pid' => $pid, ':over' => $tier['over'], ':hours' => $tier['hours']]);
                }
            }
        }
        
        $pdo->commit();
        echo json_encode(['ok' => true]);
        exit;
    }
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) { $pdo->rollBack(); }
    http_response_code(500);
    echo json_encode([
        'ok' => false, 
        'error' => 'PHP Error: ' . $e->getMessage(),
        'file' => $e->getFile(),
        'line' => $e->getLine()
    ]);
    exit;
}