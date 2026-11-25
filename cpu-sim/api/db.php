<?php
/**
 * PDO connection. Creates the database and table on first use so the app
 * works on a fresh XAMPP install without running SQL by hand
 * (database/schema.sql contains the same DDL).
 */
function cpu_sim_db(): PDO
{
    static $pdo = null;
    if ($pdo) {
        return $pdo;
    }
    $cfg = require __DIR__ . '/config.php';
    $opts = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];
    $dsn = sprintf('mysql:host=%s;port=%d;charset=utf8mb4', $cfg['host'], $cfg['port']);
    $pdo = new PDO($dsn, $cfg['username'], $cfg['password'], $opts);

    $db = preg_replace('/[^A-Za-z0-9_]/', '', $cfg['database']);
    $pdo->exec("CREATE DATABASE IF NOT EXISTS `$db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $pdo->exec("USE `$db`");
    foreach (array_filter(array_map('trim', explode(';', file_get_contents(__DIR__ . '/../database/table.sql')))) as $sql) {
        $pdo->exec($sql);
    }
    return $pdo;
}
