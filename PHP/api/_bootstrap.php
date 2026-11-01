<?php
// Shared start-up for every API file: settings, the database connection, and JSON helpers.
// Written to run on PHP 7.4 or newer.
declare(strict_types=1);

define('APP_ROOT', dirname(__DIR__));

function config(): array {
    static $cfg = null;
    if ($cfg === null) {
        $file = APP_ROOT . '/config/database.php';
        if (!is_file($file)) {
            throw new RuntimeException('config/database.php is missing. Copy config/database.example.php to config/database.php and fill in the password.');
        }
        $cfg = require $file;
    }
    return $cfg;
}

// One shared connection per request. Every query uses prepared statements (never paste user input into SQL).
function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $c = config();
        $dsn = sprintf('pgsql:host=%s;port=%d;dbname=%s', $c['host'], (int)$c['port'], $c['dbname']);
        $pdo = new PDO($dsn, $c['user'], $c['password'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec("SET client_encoding TO 'UTF8'");
        $pdo->exec("SET TIME ZONE 'Africa/Nairobi'");   // so dates and order serials follow Kenyan time
    }
    return $pdo;
}

// Send JSON and stop.
function json_out($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// Any uncaught error becomes JSON the browser console can show, instead of a blank page.
set_exception_handler(function (Throwable $e): void {
    json_out(['ok' => false, 'error' => $e->getMessage()], 500);
});
