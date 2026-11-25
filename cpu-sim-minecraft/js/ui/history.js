/**
 * Simulation history storage.
 * Primary: PHP + MySQL API at api/history.php.
 * Fallback: browser localStorage when the API is unreachable (e.g. the page
 * is served by a static server or MySQL is stopped). The UI shows which one
 * is in use so it is never ambiguous where data went.
 */
import { apiRequest } from './api.js';

const API = 'api/history.php';
const LS_KEY = 'cpu-sim-history';
const LS_LIMIT = 100;

let mode = null; // 'mysql' | 'local'
let lastError = '';

export function storageMode() { return { mode, error: lastError }; }

const api = (method, body, query = '') => apiRequest(API + query, method, body);

function lsRead() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function lsWrite(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, LS_LIMIT))); } catch { /* storage full or blocked */ }
}

export async function listHistory() {
  try {
    const data = await api('GET');
    mode = 'mysql'; lastError = '';
    return data.items;
  } catch (e) {
    mode = 'local'; lastError = e.message;
    return lsRead();
  }
}

export async function saveHistory(entry) {
  // Always try MySQL first, so a brief outage doesn't send every later run to the browser.
  try {
    const data = await api('POST', entry);
    mode = 'mysql'; lastError = '';
    return { ...entry, id: data.id, created_at: data.created_at };
  } catch (e) {
    mode = 'local'; lastError = e.message;
  }
  const list = lsRead();
  const item = { ...entry, id: `local-${Date.now()}`, created_at: new Date().toISOString() };
  list.unshift(item);
  lsWrite(list);
  return item;
}

export async function deleteHistory(id) {
  if (mode === 'mysql' && !String(id).startsWith('local-')) {
    await api('DELETE', null, `?id=${encodeURIComponent(id)}`);
    return;
  }
  lsWrite(lsRead().filter((x) => x.id !== id));
}

export async function clearHistory() {
  if (mode === 'mysql') await api('DELETE', null, '?all=1');
  lsWrite([]);
}
