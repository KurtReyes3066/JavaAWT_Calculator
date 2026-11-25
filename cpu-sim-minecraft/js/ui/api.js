/** Small JSON client for the PHP API. Throws when the API is unreachable or returns an error. */
export async function apiRequest(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new Error('The PHP API is not available on this server.');
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** True when an error means "server/database unavailable" rather than "request rejected". */
export const isUnavailable = (e) => !e.status || e.status >= 500;
