/**
 * About Us: development team members with profile pictures.
 * Stored in MySQL via api/members.php; falls back to browser storage when
 * the API/MySQL is unavailable (the page says which one is in use).
 */
import { apiRequest, isUnavailable } from './api.js';
import { icon } from './icons.js';
import { esc } from './gantt.js';

const API = 'api/members.php';
const LS_KEY = 'cpu-sim-team';
const PHOTO_SIZE = 320; // stored pictures are square 320×320 JPEGs
const MAX_UPLOAD = 15 * 1024 * 1024;

let mode = null; // 'mysql' | 'local'
let members = [];
let editing = null; // member being edited, or null for a new one
let draftPhoto = null; // data URL currently shown in the dialog
let ui = { toast: () => {}, confirm: async () => true };

/* ---------------------------------------------------------------- storage */
const lsRead = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; } };
const lsWrite = (list) => {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); return true; } catch { return false; }
};

async function load() {
  try {
    members = (await apiRequest(API)).items;
    mode = 'mysql';
  } catch {
    mode = 'local';
    members = lsRead();
  }
}

async function save(data) {
  if (mode === 'mysql') {
    const res = editing
      ? await apiRequest(`${API}?id=${editing.id}`, 'PUT', data)
      : await apiRequest(API, 'POST', data);
    return res.item;
  }
  const list = lsRead();
  let item;
  if (editing) {
    item = { ...editing, ...data };
    list.splice(list.findIndex((m) => m.id === editing.id), 1, item);
  } else {
    item = { ...data, id: `local-${Date.now()}` };
    list.push(item);
  }
  if (!lsWrite(list)) throw new Error('Browser storage is full. Use a smaller picture or start MySQL.');
  return item;
}

async function remove(m) {
  if (mode === 'mysql') await apiRequest(`${API}?id=${m.id}`, 'DELETE');
  else lsWrite(lsRead().filter((x) => x.id !== m.id));
}

async function move(m, dir) {
  if (mode === 'mysql') {
    await apiRequest(`${API}?move=${m.id}&dir=${dir}`, 'POST');
    return;
  }
  const list = lsRead();
  const i = list.findIndex((x) => x.id === m.id);
  const j = i + (dir === 'up' ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  lsWrite(list);
}

/* ---------------------------------------------------------------- images */
/** Center-crops and resizes an image file to a square JPEG data URL. */
async function resizeImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (JPG, PNG, WebP…).');
  if (file.size > MAX_UPLOAD) throw new Error('That picture is larger than 15 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('This image could not be read. Try a JPG or PNG.'));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PHOTO_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
    ctx.drawImage(img, sx, sy, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------------------------------------------------------------- render */
const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
const HUES = [217, 142, 25, 271, 330, 188, 45, 0];
const hueFor = (name) => HUES[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % HUES.length];

function avatar(m, cls = '') {
  if (m.photo) return `<img class="avatar ${cls}" src="${esc(m.photo)}" alt="Profile picture of ${esc(m.name)}">`;
  return `<span class="avatar avatar-initials ${cls}" style="--h:${hueFor(m.name)}" aria-hidden="true">${esc(initials(m.name))}</span>`;
}

function render() {
  const el = document.getElementById('teamBody');
  document.getElementById('teamSource').innerHTML = mode === 'mysql'
    ? `<span class="badge badge-success">${icon('database')}Saved in MySQL</span>`
    : `<span class="badge" title="Start MySQL in XAMPP to save members in the database.">${icon('database')}MySQL unavailable: saved in this browser</span>`;
  if (!members.length) {
    el.innerHTML = `<div class="empty">${icon('users')}<p>No team members yet.</p>
      <p class="muted small">Add the people who developed this simulator, with their profile pictures.</p></div>`;
    return;
  }
  el.innerHTML = `<ul class="team-grid">${members.map((m, i) => `
    <li class="member-card">
      ${avatar(m)}
      <div class="member-name">${esc(m.name)}</div>
      ${m.role ? `<div class="member-role">${esc(m.role)}</div>` : ''}
      ${m.bio ? `<p class="member-bio">${esc(m.bio)}</p>` : ''}
      <div class="member-actions">
        <button class="icon-btn sm" data-m-up="${i}" aria-label="Move ${esc(m.name)} earlier" ${i === 0 ? 'disabled' : ''}>${icon('arrowLeft')}</button>
        <button class="icon-btn sm" data-m-edit="${i}" aria-label="Edit ${esc(m.name)}">${icon('pencil')}</button>
        <button class="icon-btn sm danger" data-m-del="${i}" aria-label="Delete ${esc(m.name)}">${icon('trash')}</button>
        <button class="icon-btn sm" data-m-down="${i}" aria-label="Move ${esc(m.name)} later" ${i === members.length - 1 ? 'disabled' : ''}>${icon('arrowRight')}</button>
      </div>
    </li>`).join('')}</ul>`;
}

/* ---------------------------------------------------------------- dialog */
function setPreview() {
  const nameVal = document.getElementById('mName').value || 'New member';
  document.getElementById('mPreview').innerHTML = avatar({ name: nameVal, photo: draftPhoto }, 'lg');
  document.getElementById('mRemovePhoto').hidden = !draftPhoto;
}

function openDialog(member) {
  editing = member || null;
  draftPhoto = member?.photo || null;
  document.getElementById('memberTitle').textContent = member ? 'Edit member' : 'Add member';
  document.getElementById('mName').value = member?.name || '';
  document.getElementById('mRole').value = member?.role || '';
  document.getElementById('mBio').value = member?.bio || '';
  document.getElementById('mPhoto').value = '';
  document.getElementById('mNameErr').textContent = '';
  document.getElementById('mName').removeAttribute('aria-invalid');
  document.getElementById('mError').hidden = true;
  updateCounter();
  setPreview();
  document.getElementById('memberDialog').showModal();
  document.getElementById('mName').focus();
}

function updateCounter() {
  document.getElementById('mBioCount').textContent = `${document.getElementById('mBio').value.length} / 300`;
}

function showError(msg) {
  const box = document.getElementById('mError');
  box.textContent = msg;
  box.hidden = !msg;
}

async function submit(e) {
  e.preventDefault();
  const name = document.getElementById('mName').value.trim();
  if (!name) {
    document.getElementById('mNameErr').textContent = 'Enter the member\'s name.';
    document.getElementById('mName').setAttribute('aria-invalid', 'true');
    document.getElementById('mName').focus();
    return;
  }
  const btn = document.getElementById('mSave');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const data = {
      name,
      role: document.getElementById('mRole').value.trim(),
      bio: document.getElementById('mBio').value.trim(),
      photo: draftPhoto,
    };
    try {
      await save(data);
    } catch (err) {
      if (mode === 'mysql' && isUnavailable(err)) throw new Error('Could not reach MySQL. Check that it is running, then try again.');
      throw err;
    }
    const wasEditing = !!editing;
    document.getElementById('memberDialog').close();
    await load();
    render();
    ui.toast(wasEditing ? `${name} updated.` : `${name} added to the team.`);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save member';
  }
}

/* ---------------------------------------------------------------- public */
export async function renderTeam() {
  await load();
  render();
}

export function initTeam(deps) {
  ui = deps;
  document.getElementById('addMemberBtn').addEventListener('click', () => openDialog(null));
  document.getElementById('memberForm').addEventListener('submit', submit);
  document.getElementById('mCancel').addEventListener('click', () => document.getElementById('memberDialog').close());
  document.getElementById('mName').addEventListener('input', () => {
    document.getElementById('mNameErr').textContent = '';
    document.getElementById('mName').removeAttribute('aria-invalid');
    if (!draftPhoto) setPreview();
  });
  document.getElementById('mBio').addEventListener('input', updateCounter);
  document.getElementById('mPhoto').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showError('');
    try {
      draftPhoto = await resizeImage(file);
      setPreview();
    } catch (err) {
      showError(err.message);
    }
  });
  document.getElementById('mRemovePhoto').addEventListener('click', () => {
    draftPhoto = null;
    document.getElementById('mPhoto').value = '';
    setPreview();
  });

  document.getElementById('teamBody').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const idx = Number(b.dataset.mEdit ?? b.dataset.mDel ?? b.dataset.mUp ?? b.dataset.mDown);
    const m = members[idx];
    if (!m) return;
    try {
      if ('mEdit' in b.dataset) { openDialog(m); return; }
      if ('mDel' in b.dataset) {
        if (!(await ui.confirm('Delete team member?', `${m.name} and their picture will be permanently removed.`, 'Delete'))) return;
        await remove(m);
        ui.toast(`${m.name} removed.`);
      }
      if ('mUp' in b.dataset) await move(m, 'up');
      if ('mDown' in b.dataset) await move(m, 'down');
      await load();
      render();
      const again = document.querySelector(`#teamBody [data-m-${'mUp' in b.dataset ? 'up' : 'down'}="${'mUp' in b.dataset ? idx - 1 : idx + 1}"]`);
      if (again && !again.disabled && !('mDel' in b.dataset)) again.focus();
    } catch (err) {
      ui.toast(err.message, 'err');
    }
  });
}
