<?php
/**
 * Simulation history REST endpoint.
 *
 *   GET    api/history.php          -> { ok, items: [...] }   (latest 100)
 *   POST   api/history.php          -> { ok, id, created_at } (JSON body)
 *   DELETE api/history.php?id=N     -> { ok }
 *   DELETE api/history.php?all=1    -> { ok }
 *
 * Only stores what the client computed for display/reload. The scheduling
 * engine itself runs in the browser (js/engine) and is not trusted here for
 * anything security-relevant; all values are validated and bound as
 * prepared-statement parameters.
 */
declare(strict_types=1);
require __DIR__ . '/db.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const ALGORITHMS = ['FCFS', 'SJF', 'SRTF', 'NPP', 'PP', 'RR', 'MLQ', 'MLFQ'];
const MAX_BODY = 200000;

function respond(int $status, array $data): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function num($v, float $min, float $max): float
{
    if (!is_int($v) && !is_float($v)) {
        respond(422, ['ok' => false, 'error' => 'Invalid numeric field.']);
    }
    $f = (float) $v;
    if (!is_finite($f) || $f < $min || $f > $max) {
        respond(422, ['ok' => false, 'error' => 'Numeric field out of range.']);
    }
    return $f;
}

try {
    $pdo = cpu_sim_db();
} catch (Throwable $e) {
    respond(503, ['ok' => false, 'error' => 'MySQL is not reachable. Start MySQL in XAMPP and check api/config.php.']);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    if ($method === 'GET') {
        $rows = $pdo->query(
            'SELECT id, created_at, algorithm, algorithm_name, process_count, awt, att, art, cpu_util, makespan, payload
             FROM simulation_history ORDER BY id DESC LIMIT 100'
        )->fetchAll();
        foreach ($rows as &$r) {
            $r['id'] = (int) $r['id'];
            $r['process_count'] = (int) $r['process_count'];
            $r['makespan'] = (int) $r['makespan'];
            foreach (['awt', 'att', 'art', 'cpu_util'] as $k) {
                $r[$k] = (float) $r[$k];
            }
            $r['payload'] = json_decode($r['payload'], true);
        }
        respond(200, ['ok' => true, 'items' => $rows]);
    }

    if ($method === 'POST') {
        $raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
        if ($raw === false || strlen($raw) > MAX_BODY) {
            respond(413, ['ok' => false, 'error' => 'Request too large.']);
        }
        $b = json_decode($raw, true);
        if (!is_array($b)) {
            respond(400, ['ok' => false, 'error' => 'Invalid JSON.']);
        }
        $algo = $b['algorithm'] ?? '';
        if (!in_array($algo, ALGORITHMS, true)) {
            respond(422, ['ok' => false, 'error' => 'Unknown algorithm.']);
        }
        $name = substr(trim((string) ($b['algorithm_name'] ?? $algo)), 0, 64);
        $count = (int) num($b['process_count'] ?? null, 1, 1000);
        $payload = $b['payload'] ?? null;
        if (!is_array($payload) || !isset($payload['processes']) || !is_array($payload['processes'])
            || count($payload['processes']) !== $count) {
            respond(422, ['ok' => false, 'error' => 'Invalid payload.']);
        }
        $stmt = $pdo->prepare(
            'INSERT INTO simulation_history (algorithm, algorithm_name, process_count, awt, att, art, cpu_util, makespan, payload)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $algo, $name, $count,
            num($b['awt'] ?? null, 0, 1e9),
            num($b['att'] ?? null, 0, 1e9),
            num($b['art'] ?? null, 0, 1e9),
            num($b['cpu_util'] ?? null, 0, 100),
            (int) num($b['makespan'] ?? null, 0, 1e9),
            json_encode($payload, JSON_UNESCAPED_UNICODE),
        ]);
        $id = (int) $pdo->lastInsertId();
        $created = $pdo->query('SELECT created_at FROM simulation_history WHERE id = ' . $id)->fetchColumn();
        respond(201, ['ok' => true, 'id' => $id, 'created_at' => $created]);
    }

    if ($method === 'DELETE') {
        if (isset($_GET['all']) && $_GET['all'] === '1') {
            $pdo->exec('DELETE FROM simulation_history');
            respond(200, ['ok' => true]);
        }
        $id = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($id === false) {
            respond(422, ['ok' => false, 'error' => 'Missing or invalid id.']);
        }
        $stmt = $pdo->prepare('DELETE FROM simulation_history WHERE id = ?');
        $stmt->execute([$id]);
        respond(200, ['ok' => true, 'deleted' => $stmt->rowCount()]);
    }

    header('Allow: GET, POST, DELETE');
    respond(405, ['ok' => false, 'error' => 'Method not allowed.']);
} catch (Throwable $e) {
    respond(500, ['ok' => false, 'error' => 'Database error.']);
}
