<?php
/**
 * About Us team members.
 *
 *   GET    api/members.php           -> { ok, items: [...] }
 *   POST   api/members.php           -> create  { name, role, bio, photo }
 *   PUT    api/members.php?id=N      -> update  { name, role, bio, photo }  (photo null = remove)
 *   POST   api/members.php?move=N&dir=up|down -> reorder
 *   DELETE api/members.php?id=N
 *
 * photo is a data URL (data:image/jpeg|png|webp;base64,...). The browser
 * resizes pictures before upload; the server re-checks type and size.
 */
declare(strict_types=1);
require __DIR__ . '/db.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const MAX_BODY = 1200000;        // request size
const MAX_PHOTO_BYTES = 700000;  // decoded image (stays below XAMPP's 1 MB max_allowed_packet)

function respond(int $status, array $data): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function text($v, int $max, bool $required, string $label): string
{
    $s = trim(is_string($v) ? $v : '');
    $s = preg_replace('/[\x00-\x1F\x7F]/u', '', $s) ?? '';
    if ($required && $s === '') {
        respond(422, ['ok' => false, 'error' => "$label is required."]);
    }
    if (mb_strlen($s) > $max) {
        respond(422, ['ok' => false, 'error' => "$label must be at most $max characters."]);
    }
    return $s;
}

function photo($v): ?string
{
    if ($v === null || $v === '') {
        return null;
    }
    if (!is_string($v) || !preg_match('#^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$#', $v, $m)) {
        respond(422, ['ok' => false, 'error' => 'Photo must be a JPEG, PNG or WebP image.']);
    }
    $bin = base64_decode($m[2], true);
    if ($bin === false || strlen($bin) > MAX_PHOTO_BYTES) {
        respond(422, ['ok' => false, 'error' => 'Photo is too large (max 700 KB after resizing).']);
    }
    $info = @getimagesizefromstring($bin);
    $allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!$info || !in_array($info['mime'], $allowed, true)) {
        respond(422, ['ok' => false, 'error' => 'Photo is not a valid image.']);
    }
    return $v;
}

function body(): array
{
    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
    if ($raw === false || strlen($raw) > MAX_BODY) {
        respond(413, ['ok' => false, 'error' => 'Request too large.']);
    }
    $b = json_decode($raw, true);
    if (!is_array($b)) {
        respond(400, ['ok' => false, 'error' => 'Invalid JSON.']);
    }
    return $b;
}

function idParam(string $key = 'id'): int
{
    $id = filter_var($_GET[$key] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($id === false) {
        respond(422, ['ok' => false, 'error' => 'Missing or invalid id.']);
    }
    return $id;
}

function fetchOne(PDO $pdo, int $id): array
{
    $s = $pdo->prepare('SELECT id, name, role, bio, photo, sort_order FROM team_members WHERE id = ?');
    $s->execute([$id]);
    $row = $s->fetch();
    if (!$row) {
        respond(404, ['ok' => false, 'error' => 'Member not found.']);
    }
    $row['id'] = (int) $row['id'];
    $row['sort_order'] = (int) $row['sort_order'];
    return $row;
}

try {
    $pdo = cpu_sim_db();
} catch (Throwable $e) {
    respond(503, ['ok' => false, 'error' => 'MySQL is not reachable. Start MySQL in XAMPP and check api/config.php.']);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    if ($method === 'GET') {
        $rows = $pdo->query('SELECT id, name, role, bio, photo, sort_order FROM team_members ORDER BY sort_order, id')->fetchAll();
        foreach ($rows as &$r) {
            $r['id'] = (int) $r['id'];
            $r['sort_order'] = (int) $r['sort_order'];
        }
        respond(200, ['ok' => true, 'items' => $rows]);
    }

    if ($method === 'POST' && isset($_GET['move'])) {
        $id = idParam('move');
        $dir = ($_GET['dir'] ?? '') === 'up' ? -1 : 1;
        $ids = array_map('intval', $pdo->query('SELECT id FROM team_members ORDER BY sort_order, id')->fetchAll(PDO::FETCH_COLUMN));
        $i = array_search($id, $ids, true);
        if ($i === false) {
            respond(404, ['ok' => false, 'error' => 'Member not found.']);
        }
        $j = $i + $dir;
        if ($j >= 0 && $j < count($ids)) {
            [$ids[$i], $ids[$j]] = [$ids[$j], $ids[$i]];
        }
        $pdo->beginTransaction();
        $s = $pdo->prepare('UPDATE team_members SET sort_order = ? WHERE id = ?');
        foreach ($ids as $pos => $mid) {
            $s->execute([$pos, $mid]);
        }
        $pdo->commit();
        respond(200, ['ok' => true]);
    }

    if ($method === 'POST') {
        $b = body();
        $name = text($b['name'] ?? '', 80, true, 'Name');
        $role = text($b['role'] ?? '', 80, false, 'Role');
        $bio = text($b['bio'] ?? '', 300, false, 'Description');
        $pic = photo($b['photo'] ?? null);
        $next = (int) $pdo->query('SELECT COALESCE(MAX(sort_order), -1) + 1 FROM team_members')->fetchColumn();
        $s = $pdo->prepare('INSERT INTO team_members (name, role, bio, photo, sort_order) VALUES (?, ?, ?, ?, ?)');
        $s->execute([$name, $role, $bio, $pic, $next]);
        respond(201, ['ok' => true, 'item' => fetchOne($pdo, (int) $pdo->lastInsertId())]);
    }

    if ($method === 'PUT') {
        $id = idParam();
        fetchOne($pdo, $id);
        $b = body();
        $name = text($b['name'] ?? '', 80, true, 'Name');
        $role = text($b['role'] ?? '', 80, false, 'Role');
        $bio = text($b['bio'] ?? '', 300, false, 'Description');
        $pic = photo($b['photo'] ?? null);
        $s = $pdo->prepare('UPDATE team_members SET name = ?, role = ?, bio = ?, photo = ? WHERE id = ?');
        $s->execute([$name, $role, $bio, $pic, $id]);
        respond(200, ['ok' => true, 'item' => fetchOne($pdo, $id)]);
    }

    if ($method === 'DELETE') {
        $id = idParam();
        $s = $pdo->prepare('DELETE FROM team_members WHERE id = ?');
        $s->execute([$id]);
        respond(200, ['ok' => true, 'deleted' => $s->rowCount()]);
    }

    header('Allow: GET, POST, PUT, DELETE');
    respond(405, ['ok' => false, 'error' => 'Method not allowed.']);
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    respond(500, ['ok' => false, 'error' => 'Database error.']);
}
