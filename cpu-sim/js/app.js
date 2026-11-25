/**
 * UI controller. All scheduling happens in js/engine; this file only
 * collects input, calls simulate(), and renders what comes back.
 */
import './ui/textures.js';
import {
  simulate, ALGORITHMS, ALGORITHM_IDS, cloneDefaultConfig, validateProcesses, validateConfig,
  MAX_PROCESSES, MLQ_DISCIPLINES, MLFQ_LAST_DISCIPLINES, mlqQueueFor, DISCIPLINES,
} from './engine/algorithms.js';
import { pidNumber } from './engine/core.js';
import { icon, hydrateIcons } from './ui/icons.js';
import { colorFor, ganttHTML, legendHTML, maskLeft, esc, fmt, textOn as textColor } from './ui/gantt.js';
import * as store from './ui/history.js';
import { renderAlgorithmDocs, renderAbout, tieBreakHTML } from './ui/pages.js';
import { initTeam, renderTeam } from './ui/team.js';
import { createScene } from './ui/scene.js';

const $ = (sel, root = document) => root.querySelector(sel);

const SAMPLE = [
  { arrival: 0, burst: 8, priority: 1 },
  { arrival: 1, burst: 4, priority: 2 },
  { arrival: 2, burst: 9, priority: 3 },
  { arrival: 3, burst: 5, priority: 1 },
  { arrival: 6, burst: 2, priority: 2 },
];

const TILES = {
  FCFS: ['FCFS', 'First come'],
  SJF: ['SJF', 'Shortest job'],
  SRTF: ['SRTF', 'Preemptive SJF'],
  NPP: ['Priority', 'Non-preemptive'],
  PP: ['Priority', 'Preemptive'],
  RR: ['Round Robin', 'Time quantum'],
  MLQ: ['MLQ', 'Multilevel queue'],
  MLFQ: ['MLFQ', 'Feedback queue'],
};

const SPEEDS = [0.5, 1, 2, 4, 8, 16];
/** One time unit of playback at 1× speed. Long enough for Steve to fetch and carry a block. */
const STEP_MS = 1200;
const DRAFT_KEY = 'cpu-sim-draft';

const state = {
  processes: [],
  nextNum: 1,
  algorithm: 'FCFS',
  config: cloneDefaultConfig(),
  version: 0,
  touched: new Set(),
  showAllErrors: false,
  run: null, // { result, version, algorithm, config, processes, colors }
  frame: 0,
  playing: false,
  timer: null,
  speed: 1,
  compare: null, // { version, rows }
  compareMetric: 'awt',
};

/** The animated scene (Steve runs the CPU). One instance, moved into the results card on each render. */
const scene = createScene();
const stepMs = () => STEP_MS / state.speed;

/* ------------------------------------------------------------------ utils */
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isFresh = () => state.run && state.run.version === state.version;

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === 'ok' ? 'check' : 'alert')}<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function confirmAction(title, text, okLabel = 'Confirm') {
  const dlg = $('#confirmDialog');
  $('#confirmTitle').textContent = title;
  $('#confirmText').textContent = text;
  $('#confirmOk').textContent = okLabel;
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.returnValue = 'cancel';
    dlg.showModal();
  });
}

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      processes: state.processes, nextNum: state.nextNum, algorithm: state.algorithm, config: state.config,
    }));
  } catch { /* storage unavailable: drafts are a convenience only */ }
}

function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!d || !Array.isArray(d.processes)) return false;
    state.processes = d.processes.map((p) => ({ pid: String(p.pid), arrival: p.arrival, burst: p.burst, priority: p.priority, queue: p.queue ?? '' }));
    state.nextNum = d.nextNum || nextNumFrom(state.processes);
    if (ALGORITHMS[d.algorithm]) state.algorithm = d.algorithm;
    state.config = mergeConfig(d.config);
    return true;
  } catch { return false; }
}

function mergeConfig(c) {
  const base = cloneDefaultConfig();
  if (!c) return base;
  return {
    quantum: c.quantum ?? base.quantum,
    mlq: { queues: Array.isArray(c.mlq?.queues) && c.mlq.queues.length ? c.mlq.queues : base.mlq.queues },
    // Only the queue list is kept: older drafts may also carry removed aging/boost/preemption settings.
    mlfq: c.mlfq && Array.isArray(c.mlfq.queues)
      ? {
        // Upper levels are always Round Robin.
        queues: Array.isArray(c.mlfq.queues) && c.mlfq.queues.length >= 2
          ? c.mlfq.queues.map((q, i, a) => (i < a.length - 1 ? { ...q, discipline: 'RR' } : q))
          : base.mlfq.queues,
      }
      : base.mlfq,
  };
}

const nextNumFrom = (list) => list.reduce((m, p) => Math.max(m, pidNumber(p.pid) || 0), 0) + 1;

/** Any change to inputs: results become outdated until the user runs again. */
function changed({ table = false } = {}) {
  state.version++;
  stopPlayback();
  saveDraft();
  if (table) renderProcessTable();
  updateCount();
  renderResults();
  renderCompare();
}

/* --------------------------------------------------------- process table */
function errorMap() {
  const v = validateProcesses(state.processes);
  const map = new Map();
  v.errors.forEach((e) => { if (e.index >= 0 && !map.has(`${e.index}:${e.field}`)) map.set(`${e.index}:${e.field}`, e.message); });
  return { v, map };
}

function renderProcessTable() {
  const mlq = state.algorithm === 'MLQ';
  $('#procHead').innerHTML = `<tr>
    <th scope="col">PID</th>
    <th scope="col"><abbr title="Arrival Time">Arrival Time (AT)</abbr></th>
    <th scope="col"><abbr title="Burst Time">Burst Time (BT)</abbr></th>
    <th scope="col"><abbr title="Priority (1 = highest)">Priority (P)</abbr></th>
    ${mlq ? '<th scope="col">Queue</th>' : ''}
    <th scope="col"><span class="sr-only">Actions</span></th>
  </tr>`;

  const sortedQueues = [...state.config.mlq.queues].sort((a, b) => a.id - b.id);
  const cell = (p, i, field, min, label) => {
    const id = `p-${i}-${field}`;
    return `<td><input class="cell-input" id="${id}" type="number" inputmode="numeric" step="1" min="${min}"
      value="${esc(p[field])}" data-i="${i}" data-field="${field}" aria-label="${esc(p.pid)} ${label}"
      aria-describedby="${id}-err"><span class="cell-error" id="${id}-err"></span></td>`;
  };
  $('#procBody').innerHTML = state.processes.map((p, i) => {
    const color = colorFor(i);
    let queueCell = '';
    if (mlq) {
      const auto = mlqQueueFor({ ...p, queue: '' }, state.config);
      const opts = [`<option value="">Auto (Q${auto})</option>`]
        .concat(sortedQueues.map((q) => `<option value="${q.id}" ${Number(p.queue) === q.id ? 'selected' : ''}>Q${q.id} · ${esc(DISCIPLINES[q.discipline].label)}</option>`));
      queueCell = `<td><select class="select" data-i="${i}" data-field="queue" aria-label="${esc(p.pid)} queue">${opts.join('')}</select></td>`;
    }
    return `<tr>
      <td><span class="pid-cell"><i class="swatch" style="background:${color}"></i>${esc(p.pid)}</span></td>
      ${cell(p, i, 'arrival', 0, 'arrival time')}
      ${cell(p, i, 'burst', 1, 'burst time')}
      ${cell(p, i, 'priority', 1, 'priority')}
      ${queueCell}
      <td><button class="del-btn" data-del="${i}" aria-label="Delete ${esc(p.pid)}" title="Delete ${esc(p.pid)}">${icon('trash')}</button></td>
    </tr>`;
  }).join('');

  $('#procEmpty').hidden = state.processes.length > 0;
  $('#procHead').parentElement.hidden = state.processes.length === 0;
  $('#addProcBtn').disabled = state.processes.length >= MAX_PROCESSES;
  updateCellErrors();
  updateCount();
}

function updateCount() {
  const n = state.processes.length;
  $('#procCount').textContent = `${n} / ${MAX_PROCESSES} processes`;
}

function updateCellErrors() {
  const { v, map } = errorMap();
  document.querySelectorAll('#procBody .cell-input').forEach((inp) => {
    const key = `${inp.dataset.i}:${inp.dataset.field}`;
    const show = state.showAllErrors || state.touched.has(key);
    const msg = show ? map.get(key) : null;
    inp.setAttribute('aria-invalid', msg ? 'true' : 'false');
    $(`#${inp.id}-err`).textContent = msg || '';
  });
  if (state.showAllErrors) renderErrorSummary(v);
}

function renderErrorSummary(v) {
  const box = $('#errorSummary');
  if (v.ok) { box.hidden = true; box.innerHTML = ''; return; }
  const items = v.errors.map((e) => {
    const pid = e.index >= 0 ? state.processes[e.index]?.pid : null;
    const target = e.index >= 0 && e.field !== 'pid' ? `p-${e.index}-${e.field}` : null;
    const text = `${pid ? pid + ': ' : ''}${e.message}`;
    return `<li>${target ? `<a href="#${target}" data-focus="${target}">${esc(text)}</a>` : esc(text)}</li>`;
  });
  box.innerHTML = `<div class="alert-title">${icon('alert')}Fix ${v.errors.length} input error${v.errors.length > 1 ? 's' : ''} before running</div><ul>${items.join('')}</ul>`;
  box.hidden = false;
}

function addProcess(values) {
  if (state.processes.length >= MAX_PROCESSES) { toast(`Maximum of ${MAX_PROCESSES} processes reached.`, 'warn'); return; }
  const last = state.processes[state.processes.length - 1];
  const p = values || {
    arrival: last && Number.isFinite(Number(last.arrival)) && last.arrival !== '' ? Number(last.arrival) + 1 : 0,
    burst: 4,
    priority: 1,
  };
  state.processes.push({ pid: `P${state.nextNum++}`, arrival: p.arrival, burst: p.burst, priority: p.priority, queue: '' });
}

function bindProcessTable() {
  $('#addProcBtn').addEventListener('click', () => {
    addProcess();
    changed({ table: true });
    const i = state.processes.length - 1;
    $(`#p-${i}-arrival`)?.focus();
    $(`#p-${i}-arrival`)?.select();
  });
  $('#sampleBtn').addEventListener('click', async () => {
    if (state.processes.length && !(await confirmAction('Load sample processes?', 'This replaces the current process list.', 'Load sample'))) return;
    state.processes = []; state.nextNum = 1; state.touched.clear(); state.showAllErrors = false;
    SAMPLE.forEach((s) => addProcess(s));
    $('#errorSummary').hidden = true;
    changed({ table: true });
    toast('Sample processes loaded.');
  });
  $('#clearBtn').addEventListener('click', async () => {
    if (!state.processes.length) return;
    if (!(await confirmAction('Clear all processes?', `All ${state.processes.length} processes and the current results will be removed.`, 'Clear all'))) return;
    state.processes = []; state.nextNum = 1; state.touched.clear(); state.showAllErrors = false;
    state.run = null; state.compare = null;
    $('#errorSummary').hidden = true;
    changed({ table: true });
  });

  const body = $('#procBody');
  body.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.field) return;
    state.processes[t.dataset.i][t.dataset.field] = t.value;
    changed();
    updateCellErrors();
  });
  body.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.dataset.field) return;
    if (t.dataset.field === 'queue') {
      state.processes[t.dataset.i].queue = t.value ? Number(t.value) : '';
      changed();
      return;
    }
    state.touched.add(`${t.dataset.i}:${t.dataset.field}`);
    updateCellErrors();
  });
  body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    const i = Number(btn.dataset.del);
    const pid = state.processes[i].pid;
    state.processes.splice(i, 1);
    // Re-key touched flags after the removed row.
    state.touched = new Set([...state.touched].flatMap((k) => {
      const [ri, f] = k.split(':'); const n = Number(ri);
      return n === i ? [] : [`${n > i ? n - 1 : n}:${f}`];
    }));
    if (!state.processes.length) state.nextNum = 1;
    changed({ table: true });
    toast(`${pid} deleted.`);
    const next = $(`#procBody [data-del="${Math.min(i, state.processes.length - 1)}"]`);
    (next || $('#addProcBtn')).focus();
  });
  $('#errorSummary').addEventListener('click', (e) => {
    const a = e.target.closest('[data-focus]');
    if (!a) return;
    e.preventDefault();
    $(`#${a.dataset.focus}`)?.focus();
  });
}

/* ------------------------------------------------------- algorithm panel */
function renderAlgoGrid() {
  $('#algoGrid').innerHTML = ALGORITHM_IDS.map((id) => {
    const [label, sub] = TILES[id];
    const on = id === state.algorithm;
    return `<button type="button" class="algo-tile" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-algo="${id}"
      title="${esc(ALGORITHMS[id].name)}">${esc(label)}<small>${esc(sub)}</small></button>`;
  }).join('');
}

function renderAlgoInfo() {
  const a = ALGORITHMS[state.algorithm];
  $('#algoInfo').innerHTML = `
    <div class="algo-info-head"><strong>${esc(a.name)}</strong><span class="badge badge-accent">${esc(a.type)}</span></div>
    <p class="muted small">${esc(a.summary)}</p>
    <div class="tiebreak"><span>Tie-break:</span>${tieBreakHTML(a.tieBreak)}</div>`;
}

function renderConfig() {
  const c = state.config;
  const el = $('#algoConfig');
  const algo = state.algorithm;
  if (algo === 'RR') {
    el.innerHTML = `<div class="field">
      <label for="cfgQuantum">Time Quantum</label>
      <input id="cfgQuantum" type="number" min="1" step="1" inputmode="numeric" value="${esc(c.quantum)}" data-cfg="quantum" aria-describedby="cfgQuantumHint">
      <span class="field-hint" id="cfgQuantumHint">Time units each process may run before going to the back of the queue. Default 2.</span>
    </div>`;
  } else if (algo === 'MLQ') {
    const rows = c.mlq.queues.map((q, i) => `<tr>
      <td class="mono"><strong>Q${q.id}</strong></td>
      <td><input class="cell-input" type="number" min="1" step="1" value="${esc(q.priority)}" data-mlq="${i}" data-key="priority" aria-label="Q${q.id} queue priority"></td>
      <td><select class="select" data-mlq="${i}" data-key="discipline" aria-label="Q${q.id} algorithm">
        ${MLQ_DISCIPLINES.map((d) => `<option value="${d}" ${q.discipline === d ? 'selected' : ''}>${esc(DISCIPLINES[d].label)}</option>`).join('')}
      </select></td>
      <td><input class="cell-input" type="number" min="1" step="1" value="${esc(q.quantum)}" data-mlq="${i}" data-key="quantum" aria-label="Q${q.id} time quantum" ${q.discipline === 'RR' ? '' : 'disabled'}></td>
      <td><button class="del-btn" data-mlq-del="${i}" aria-label="Remove Q${q.id}" ${c.mlq.queues.length <= 1 ? 'disabled' : ''}>${icon('trash')}</button></td>
    </tr>`).join('');
    el.innerHTML = `<div class="config-box">
      <h3>Queues</h3>
      <div class="table-wrap"><table class="table queue-table">
        <thead><tr><th scope="col">Queue</th><th scope="col">Queue priority</th><th scope="col">Algorithm</th><th scope="col">Quantum</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="config-foot">
        <span class="field-hint">Queue priority 1 is served first. Assign processes in the Queue column of the process table; Auto uses Queue = Priority.</span>
        <button class="btn btn-ghost btn-sm" id="mlqAdd" ${c.mlq.queues.length >= 5 ? 'disabled' : ''}>${icon('plus')}Add queue</button>
      </div>
    </div>`;
  } else if (algo === 'MLFQ') {
    const m = c.mlfq;
    const lastIdx = m.queues.length - 1;
    const rows = m.queues.map((q, i) => `<tr>
      <td class="mono"><strong>Q${i + 1}</strong>${i === lastIdx ? '<br><span class="field-hint">last</span>' : ''}</td>
      <td>${i === lastIdx
        ? `<select class="select" data-mlfq="${i}" data-key="discipline" aria-label="Q${i + 1} (last level) algorithm">
        ${MLFQ_LAST_DISCIPLINES.map((d) => `<option value="${d}" ${q.discipline === d ? 'selected' : ''}>${esc(DISCIPLINES[d].label)}</option>`).join('')}
      </select>`
        : `<span class="fixed-algo" title="Upper levels use Round Robin so a process that uses its full quantum can be demoted">Round Robin</span>`}</td>
      <td><input class="cell-input" type="number" min="1" step="1" value="${esc(q.quantum)}" data-mlfq="${i}" data-key="quantum" aria-label="Q${i + 1} time quantum" ${q.discipline === 'RR' ? '' : 'disabled'}></td>
      <td><button class="del-btn" data-mlfq-del="${i}" aria-label="Remove Q${i + 1}" ${m.queues.length <= 2 ? 'disabled' : ''}>${icon('trash')}</button></td>
    </tr>`).join('');
    el.innerHTML = `<div class="config-box">
      <h3>Levels (Q1 = highest priority, new processes enter Q1)</h3>
      <div class="table-wrap"><table class="table queue-table">
        <thead><tr><th scope="col">Queue</th><th scope="col">Algorithm</th><th scope="col">Quantum</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="config-foot">
        <span class="field-hint">Upper levels are Round Robin (using a full quantum demotes a process). The last level can use any algorithm.</span>
        <button class="btn btn-ghost btn-sm" id="mlfqAdd" ${m.queues.length >= 5 ? 'disabled' : ''}>${icon('plus')}Add queue</button>
      </div>
    </div>`;
  } else {
    el.innerHTML = '<p class="muted small">No extra configuration needed for this algorithm.</p>';
  }
  renderConfigErrors();
}

function renderConfigErrors() {
  const errs = validateConfig(state.algorithm, state.config);
  const box = $('#configErrors');
  box.hidden = errs.length === 0;
  box.innerHTML = errs.length ? `<div class="alert-title">${icon('alert')}Configuration</div><ul>${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : '';
  return errs;
}

function selectAlgorithm(id, focus = false) {
  if (!ALGORITHMS[id] || id === state.algorithm) return;
  const mlqToggle = (id === 'MLQ') !== (state.algorithm === 'MLQ');
  state.algorithm = id;
  renderAlgoGrid();
  renderAlgoInfo();
  renderConfig();
  changed({ table: mlqToggle });
  if (focus) $(`#algoGrid [data-algo="${id}"]`).focus();
}

function bindAlgorithmPanel() {
  const grid = $('#algoGrid');
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-algo]');
    if (b) selectAlgorithm(b.dataset.algo, true);
  });
  grid.addEventListener('keydown', (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys) && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = ALGORITHM_IDS.indexOf(state.algorithm);
    let n = e.key === 'Home' ? 0 : e.key === 'End' ? ALGORITHM_IDS.length - 1 : (i + keys[e.key] + ALGORITHM_IDS.length) % ALGORITHM_IDS.length;
    selectAlgorithm(ALGORITHM_IDS[n], true);
  });

  const cfg = $('#algoConfig');
  const onCfg = (e) => {
    const t = e.target;
    const c = state.config;
    let rerender = false;
    let table = false;
    if (t.dataset.cfg === 'quantum') c.quantum = t.value;
    else if (t.dataset.mlq !== undefined) {
      const q = c.mlq.queues[t.dataset.mlq];
      q[t.dataset.key] = t.value;
      if (t.dataset.key === 'discipline') { rerender = true; table = true; }
    } else if (t.dataset.mlfq !== undefined) {
      c.mlfq.queues[t.dataset.mlfq][t.dataset.key] = t.value;
      if (t.dataset.key === 'discipline') rerender = true;
    } else return;
    if (rerender && e.type === 'change') renderConfig();
    else renderConfigErrors();
    changed({ table });
  };
  cfg.addEventListener('input', (e) => { if (e.target.tagName === 'INPUT') onCfg(e); });
  cfg.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') onCfg(e); });
  cfg.addEventListener('click', (e) => {
    const c = state.config;
    if (e.target.closest('#mlqAdd')) {
      const id = Math.max(...c.mlq.queues.map((q) => q.id)) + 1;
      const pr = Math.max(...c.mlq.queues.map((q) => Number(q.priority) || 0)) + 1;
      c.mlq.queues.push({ id, discipline: 'FCFS', quantum: 2, priority: pr });
    } else if (e.target.closest('[data-mlq-del]')) {
      const i = Number(e.target.closest('[data-mlq-del]').dataset.mlqDel);
      const [removed] = c.mlq.queues.splice(i, 1);
      state.processes.forEach((p) => { if (Number(p.queue) === removed.id) p.queue = ''; });
    } else if (e.target.closest('#mlfqAdd')) {
      // Insert a new Round Robin level just above the last level (the last level keeps its algorithm).
      const qs = c.mlfq.queues;
      const upper = qs.length > 1 ? qs[qs.length - 2] : null;
      qs.splice(qs.length - 1, 0, { discipline: 'RR', quantum: (Number(upper?.quantum) || 1) * 2 });
    } else if (e.target.closest('[data-mlfq-del]')) {
      c.mlfq.queues.splice(Number(e.target.closest('[data-mlfq-del]').dataset.mlfqDel), 1);
    } else return;
    renderConfig();
    changed({ table: state.algorithm === 'MLQ' });
  });

  $('#runBtn').addEventListener('click', runSimulation);
  $('#resetBtn').addEventListener('click', () => {
    if (!state.run) { toast('Nothing to reset.', 'warn'); return; }
    stopPlayback();
    state.run = null;
    renderResults();
    toast('Simulation results cleared.');
  });
}

/* ------------------------------------------------------------- simulate */
function snapshotProcesses() {
  return state.processes.map((p) => ({
    pid: p.pid, arrival: Number(p.arrival), burst: Number(p.burst), priority: Number(p.priority),
    queue: p.queue === '' || p.queue === undefined ? '' : Number(p.queue),
  }));
}

function runSimulation() {
  state.showAllErrors = true;
  const v = validateProcesses(state.processes);
  updateCellErrors();
  renderErrorSummary(v);
  if (!v.ok) { $('#errorSummary').focus(); return; }
  const cErr = renderConfigErrors();
  if (cErr.length) { $('#configErrors').scrollIntoView({ block: 'center' }); toast('Fix the algorithm configuration first.', 'err'); return; }

  let result;
  const processes = snapshotProcesses();
  const config = JSON.parse(JSON.stringify(state.config));
  try {
    result = simulate(state.algorithm, processes, config);
  } catch (e) {
    toast(e.message, 'err');
    return;
  }
  const colors = new Map(processes.map((p, i) => [p.pid, colorFor(i)]));
  stopPlayback();
  state.run = { result, version: state.version, algorithm: state.algorithm, config, processes, colors };
  state.frame = result.trace.length - 1;
  renderResults();
  $('#resultsCard').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  toast(`${ALGORITHMS[state.algorithm].name} simulated.`);

  const m = result.metrics;
  store.saveHistory({
    algorithm: state.algorithm,
    algorithm_name: ALGORITHMS[state.algorithm].name,
    process_count: processes.length,
    awt: round(m.awt), att: round(m.att), art: round(m.art), cpu_util: round(m.cpuUtilization), makespan: m.makespan,
    payload: { processes, config },
  }).catch(() => {});
}

const round = (x) => Math.round(x * 10000) / 10000;

/* ------------------------------------------------------------- results */
function configSummary(algo, config) {
  if (algo === 'RR') return `Quantum = ${config.quantum}`;
  if (algo === 'MLQ') {
    return [...config.mlq.queues].sort((a, b) => a.priority - b.priority)
      .map((q) => `Q${q.id}: ${DISCIPLINES[q.discipline].label}${q.discipline === 'RR' ? ` q=${q.quantum}` : ''}`).join(' · ');
  }
  if (algo === 'MLFQ') {
    const m = config.mlfq;
    const qs = m.queues.map((q, i) => `Q${i + 1}: ${q.discipline === 'RR' ? `RR q=${q.quantum}` : DISCIPLINES[q.discipline].label}`).join(' · ');
    return qs;
  }
  return '';
}

function renderStatus() {
  const chip = $('#statusChip');
  if (!state.run) {
    chip.className = 'status-chip';
    chip.innerHTML = `${icon('clock')}Not run yet`;
  } else if (!isFresh()) {
    chip.className = 'status-chip stale';
    chip.innerHTML = `${icon('alert')}Outdated: run again`;
  } else {
    chip.className = 'status-chip ok';
    chip.innerHTML = `${icon('check')}Simulation completed`;
  }
  const fresh = isFresh();
  $('#csvBtn').disabled = !fresh;
}

function staleBanner(what) {
  return `<div class="alert alert-warn stale-banner" role="status">
    <span class="alert-title">${icon('alert')}Inputs changed since this ${what} was generated. These results are outdated.</span>
    <button class="btn btn-sm btn-primary" data-rerun>${icon('play')}Run again</button>
  </div>`;
}

function renderResults() {
  renderStatus();
  const body = $('#resultsBody');
  const tableEl = $('#resultTable');
  const metricsEl = $('#metrics');
  if (!state.run) {
    body.innerHTML = `<div class="placeholder">${icon('chart')}<p>Add processes, choose an algorithm and press <strong>Run Simulation</strong> to generate the Gantt chart.</p></div>`;
    body.prepend(scene.el);
    scene.setRun(null);
    tableEl.innerHTML = `<div class="placeholder">${icon('list')}<p>Per-process results appear here after a run.</p></div>`;
    metricsEl.innerHTML = `<div class="placeholder">${icon('trophy')}<p>AWT, ATT, average response time and CPU utilization appear here.</p></div>`;
    return;
  }
  const run = state.run;
  const r = run.result;
  const stale = !isFresh();
  const multi = r.levels.length > 1;
  const last = r.trace.length - 1;
  const hasIdle = r.segments.some((s) => !s.pid);
  const summary = configSummary(run.algorithm, run.config);

  body.innerHTML = `
    ${stale ? staleBanner('simulation') : ''}
    <div class="stale-wrap ${stale ? 'is-stale' : ''}"><div class="stale-content" ${stale ? 'aria-hidden="true"' : ''}>
      <div id="sceneSlot"></div>
      <div class="playback" role="group" aria-label="Step-by-step playback">
        <button class="icon-btn" data-pb="start" aria-label="Go to time 0">${icon('skipStart')}</button>
        <button class="icon-btn" data-pb="back" aria-label="Step back">${icon('stepBack')}</button>
        <button class="icon-btn play-btn" data-pb="play" aria-label="Play">${icon('play')}</button>
        <button class="icon-btn" data-pb="fwd" aria-label="Step forward">${icon('stepFwd')}</button>
        <button class="icon-btn" data-pb="end" aria-label="Jump to end">${icon('skipEnd')}</button>
        <span class="time-readout" id="timeReadout" aria-live="polite"></span>
        <input type="range" class="scrubber" id="scrubber" min="0" max="${last}" step="1" value="${state.frame}" aria-label="Simulation time">
        <label class="speed">Speed
          <select class="select" id="speedSel">${SPEEDS.map((s) => `<option value="${s}" ${s === state.speed ? 'selected' : ''}>${s}×</option>`).join('')}</select>
        </label>
      </div>
      <div class="live" id="live"></div>
      <div class="gantt-head">
        <h3>${icon('monitor')}Gantt Chart</h3>
        <span class="badge badge-accent">${esc(ALGORITHMS[run.algorithm].name)}</span>
      </div>
      ${summary ? `<p class="muted small" style="margin:-2px 0 8px">${esc(summary)}</p>` : ''}
      <div id="ganttWrap">${ganttHTML(r, run.colors, r.trace[state.frame].time, multi)}</div>
      ${legendHTML(run.processes.map((p) => p.pid), run.colors, hasIdle)}
    </div></div>`;
  $('#sceneSlot').replaceWith(scene.el);
  scene.setRun(run);
  renderFrame();
}

/**
 * Draws playback frame state.frame. With animate, Steve acts out the step into
 * this frame over one playback interval (used for Play and Step forward).
 */
function renderFrame({ animate = false } = {}) {
  const run = state.run;
  if (!run) return;
  scene.show(state.frame, { animate, duration: stepMs() });
  const r = run.result;
  const last = r.trace.length - 1;
  const snap = r.trace[state.frame];
  const t = snap.time;
  const total = r.metrics.makespan;
  const atEnd = state.frame === last;
  const multi = r.levels.length > 1;

  const readout = $('#timeReadout');
  if (readout) readout.innerHTML = `t = <b>${t}</b> / ${total}`;
  const scrub = $('#scrubber');
  if (scrub) scrub.value = state.frame;
  const playBtn = $('[data-pb="play"]');
  if (playBtn) {
    playBtn.innerHTML = icon(state.playing ? 'pause' : 'play');
    playBtn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  }

  // Gantt reveal mask.
  const mask = $('#ganttWrap .gantt-mask');
  if (mask) {
    mask.hidden = atEnd;
    mask.style.left = maskLeft(t, total);
    // Tick labels sit above the mask; hide the ones that are still in the future.
    document.querySelectorAll('#ganttWrap .tick').forEach((el) => { el.style.visibility = !atEnd && Number(el.textContent) > t ? 'hidden' : ''; });
    if (state.playing) {
      const sc = $('#ganttWrap .gantt-scroll');
      const g = $('#ganttWrap .gantt');
      const x = 16 + (g.clientWidth - 32) * (t / total);
      if (x > sc.scrollLeft + sc.clientWidth - 60 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - sc.clientWidth / 2);
    }
  }

  // Live state panel.
  const chip = (pid) => {
    const bg = run.colors.get(pid);
    return `<span class="chip" style="background-color:${bg};color:${textColor(bg)}" title="${esc(pid)}: ${snap.remaining[pid]} unit(s) remaining">${esc(pid)}<span class="sr-only">, ${snap.remaining[pid]} remaining</span></span>`;
  };
  const cpu = snap.running
    ? `${chip(snap.running)}${multi ? `<span class="muted small">in ${esc(r.levels[snap.runningLevel].label)}</span>` : ''}<span class="muted small">${snap.remaining[snap.running]} left</span>`
    : `<span class="chip chip-idle">${atEnd ? 'DONE' : 'IDLE'}</span>`;
  const queues = r.levels.map((l, i) => `<div class="queue-row"><span class="qname">${esc(l.label)}</span><div class="chips">${
    snap.queues[i].length ? snap.queues[i].map(chip).join('') : '<span class="muted small">empty</span>'}</div></div>`).join('');
  const events = snap.events.length
    ? `<ul class="events">${snap.events.map((e) => `<li class="ev-${e.type}">${esc(e.text)}</li>`).join('')}</ul>`
    : '<p class="muted small">No events at this time.</p>';
  const live = $('#live');
  if (live) {
    live.innerHTML = `
      <div class="live-box"><div class="live-label">${icon('cpu')}CPU at t = ${t}</div><div class="chips">${cpu}</div></div>
      <div class="live-box"><div class="live-label">${icon('queue')}Ready queue${multi ? 's' : ''}</div>${queues}</div>
      <div class="live-box live-events"><div class="live-label">${icon('activity')}Events</div>${events}</div>`;
  }

  renderResultTable(t, atEnd);
  renderMetrics(atEnd);
}

function renderResultTable(t, atEnd) {
  const run = state.run;
  const r = run.result;
  const stale = !isFresh();
  const showQueue = run.algorithm === 'MLQ';
  const rows = r.rows.map((x) => {
    const done = x.completion <= t;
    const v = (cond, val) => (cond ? val : '<span class="muted">—</span>');
    return `<tr${done ? '' : ' class="muted"'}>
      <td><span class="pid-cell"><i class="swatch" style="background:${run.colors.get(x.pid)}"></i>${esc(x.pid)}</span></td>
      <td class="num">${x.arrival}</td><td class="num">${x.burst}</td><td class="num">${x.priority}</td>
      ${showQueue ? `<td class="num">Q${x.queue}</td>` : ''}
      <td class="num">${v(done, x.completion)}</td>
      <td class="num">${v(done, x.tat)}</td>
      <td class="num">${v(done, x.wt)}</td>
    </tr>`;
  }).join('');
  const m = r.metrics;
  const span = showQueue ? 6 : 5;
  const foot = atEnd ? `<tfoot>
      <tr><td colspan="${span}" style="text-align:right">Total</td><td class="num">${m.totalTAT}</td><td class="num">${m.totalWT}</td></tr>
      <tr><td colspan="${span}" style="text-align:right">Average</td><td class="num">${fmt(m.att)}</td><td class="num">${fmt(m.awt)}</td></tr>
    </tfoot>` : '';
  $('#resultTable').innerHTML = `
    ${stale ? staleBanner('table') : ''}
    <div class="stale-wrap ${stale ? 'is-stale' : ''}"><div class="stale-content">
    <div class="table-wrap"><table class="table">
      <thead><tr>
        <th scope="col">PID</th><th scope="col"><abbr title="Arrival Time">AT</abbr></th><th scope="col"><abbr title="Burst Time">BT</abbr></th>
        <th scope="col">Priority</th>${showQueue ? '<th scope="col">Queue</th>' : ''}
        <th scope="col"><abbr title="Ending Time: the time the process finishes">Ending Time (ET)</abbr></th>
        <th scope="col"><abbr title="Turnaround Time = ET − AT">Turnaround Time (TT)</abbr></th>
        <th scope="col"><abbr title="Waiting Time = TT − BT">Waiting Time (WT)</abbr></th>
      </tr></thead>
      <tbody>${rows}</tbody>${foot}
    </table></div>
    ${atEnd ? '' : `<p class="muted small" style="margin-top:8px">Playback at t = ${t}: values appear as processes finish.</p>`}
    </div></div>`;
}

function renderMetrics(atEnd) {
  const m = state.run.result.metrics;
  const stale = !isFresh();
  const val = (x, d = 2) => (atEnd ? fmt(x, d) : '—');
  const pct = atEnd ? m.cpuUtilization : 0;
  $('#metrics').innerHTML = `
    ${stale ? staleBanner('result') : ''}
    <div class="stale-wrap ${stale ? 'is-stale' : ''}"><div class="stale-content">
    <div class="metrics">
      <div class="metric awt"><span class="metric-label">Average Waiting Time (AWT)</span><span class="metric-value">${val(m.awt)}</span><span class="metric-sub">ΣWT ${atEnd ? m.totalWT : '—'} / ${m.count}</span></div>
      <div class="metric att"><span class="metric-label">Average Turnaround Time (ATT)</span><span class="metric-value">${val(m.att)}</span><span class="metric-sub">ΣTT ${atEnd ? m.totalTAT : '—'} / ${m.count}</span></div>      <div class="metric cpu">
        <div class="xp" role="img" aria-label="CPU utilization ${atEnd ? fmt(m.cpuUtilization) + ' percent' : 'pending'}">
          <span class="xp-value" aria-hidden="true">${atEnd ? (Math.round(m.cpuUtilization * 100) / 100) + '%' : '—'}</span>
          <span class="xp-bar" aria-hidden="true"><span class="xp-fill" style="display:block;width:${pct}%"></span></span>
        </div>
        <div class="metric-extra">
          <span class="metric-label">CPU Utilization</span>
          <span>Busy <b>${m.busy}</b> · Idle <b>${m.idle}</b> · Total <b>${m.makespan}</b></span>
          <span>Throughput <b>${fmt(m.throughput, 3)}</b> proc/unit</span>
          <span>Dispatches <b>${m.dispatches}</b></span>
        </div>
      </div>
    </div>
    ${atEnd ? '' : '<p class="muted small" style="margin-top:8px">Averages are shown when playback reaches the end.</p>'}
    </div></div>`;
}

/* ------------------------------------------------------------- playback */
function stopPlayback() {
  state.playing = false;
  clearInterval(state.timer);
  state.timer = null;
}

function play() {
  const last = state.run.result.trace.length - 1;
  const restart = state.frame >= last;
  if (restart) state.frame = 0;
  state.playing = true;
  clearInterval(state.timer);
  state.timer = setInterval(() => {
    if (!state.run || state.frame >= state.run.result.trace.length - 1) { stopPlayback(); renderFrame(); return; }
    state.frame++;
    renderFrame({ animate: true });
  }, stepMs());
  // Starting over: Steve also acts out the arrivals at t = 0.
  renderFrame({ animate: restart });
}

function bindResults() {
  const body = $('#resultsBody');
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pb]');
    if (!b || !state.run) return;
    const last = state.run.result.trace.length - 1;
    const a = b.dataset.pb;
    if (a === 'play') {
      if (state.playing) { stopPlayback(); renderFrame(); } else play();
      return;
    }
    stopPlayback();
    const before = state.frame;
    if (a === 'start') state.frame = 0;
    if (a === 'end') state.frame = last;
    if (a === 'back') state.frame = Math.max(0, state.frame - 1);
    if (a === 'fwd') state.frame = Math.min(last, state.frame + 1);
    renderFrame({ animate: a === 'fwd' && state.frame === before + 1 });
  });
  body.addEventListener('input', (e) => {
    if (e.target.id === 'scrubber') { stopPlayback(); state.frame = Number(e.target.value); renderFrame(); }
  });
  body.addEventListener('change', (e) => {
    if (e.target.id === 'speedSel') {
      state.speed = Number(e.target.value);
      if (state.playing) play();
    }
  });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-rerun]')) runSimulation(); });

  $('#csvBtn').addEventListener('click', exportCSV);
}

/* ------------------------------------------------------------- CSV */
function exportCSV() {
  if (!isFresh()) return;
  const { result: r, algorithm, config } = state.run;
  const q = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [];
  const row = (...cells) => lines.push(cells.map(q).join(','));
  row('Algorithm', ALGORITHMS[algorithm].name);
  const summary = configSummary(algorithm, config);
  if (summary) row('Configuration', summary);
  row('Generated', new Date().toISOString());
  row();
  const showQueue = algorithm === 'MLQ';
  row('PID', 'Arrival Time', 'Burst Time', 'Priority', ...(showQueue ? ['Queue'] : []), 'Ending Time (ET)', 'Turnaround Time (TT)', 'Waiting Time (WT)');
  r.rows.forEach((x) => row(x.pid, x.arrival, x.burst, x.priority, ...(showQueue ? [`Q${x.queue}`] : []), x.completion, x.tat, x.wt));
  row();
  const m = r.metrics;
  row('Average Waiting Time', fmt(m.awt));
  row('Average Turnaround Time', fmt(m.att));
  row('CPU Utilization (%)', fmt(m.cpuUtilization));
  row('Busy Time', m.busy);
  row('Total Time', m.makespan);
  row();
  row('Gantt Segment', 'Start', 'End', 'Duration', ...(r.levels.length > 1 ? ['Queue'] : []));
  r.segments.forEach((s) => row(s.pid ?? 'IDLE', s.start, s.end, s.end - s.start, ...(r.levels.length > 1 ? [s.pid ? r.levels[s.level].label : ''] : [])));

  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cpu-scheduling-${algorithm.toLowerCase()}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  toast('CSV exported.');
}

/* ------------------------------------------------------------- compare */
const CMP_METRICS = {
  awt: { label: 'AWT', full: 'Average Waiting Time', better: 'min' },
  att: { label: 'ATT', full: 'Average Turnaround Time', better: 'min' },
  cpuUtilization: { label: 'CPU %', full: 'CPU Utilization', better: 'max' },
};

function runCompare() {
  state.showAllErrors = true;
  const v = validateProcesses(state.processes);
  updateCellErrors();
  renderErrorSummary(v);
  if (!v.ok) { $('#errorSummary').focus(); toast('Fix the process inputs first.', 'err'); return; }
  const processes = snapshotProcesses();
  const rows = ALGORITHM_IDS.map((id) => {
    try {
      const r = simulate(id, processes, state.config);
      return { id, metrics: r.metrics };
    } catch (e) {
      return { id, error: e.message };
    }
  });
  state.compare = { version: state.version, rows };
  renderCompare();
}

function renderCompare() {
  const el = $('#compareBody');
  if (!state.compare) {
    el.innerHTML = `<p class="muted small">Runs all eight algorithms on the current processes (using the current RR, MLQ and MLFQ settings) and ranks them.</p>`;
    return;
  }
  const stale = state.compare.version !== state.version;
  const ok = state.compare.rows.filter((r) => !r.error);
  const best = {};
  Object.entries(CMP_METRICS).forEach(([k, d]) => {
    const vals = ok.map((r) => round(r.metrics[k]));
    // No "best" when every algorithm ties: that would mark them all.
    best[k] = new Set(vals).size <= 1 ? null : d.better === 'min' ? Math.min(...vals) : Math.max(...vals);
  });
  const cell = (r, k) => {
    const isBest = round(r.metrics[k]) === best[k];
    return `<td class="num ${isBest ? 'best' : ''}">${fmt(r.metrics[k])}${isBest ? '<span class="best-tag">Best</span>' : ''}</td>`;
  };
  const rows = state.compare.rows.map((r) => r.error
    ? `<tr><th scope="row" style="text-align:left">${esc(ALGORITHMS[r.id].name)}</th><td colspan="5" class="muted">${esc(r.error)}</td></tr>`
    : `<tr>
        <th scope="row" style="text-align:left;font-weight:600;white-space:nowrap"><abbr title="${esc(ALGORITHMS[r.id].name)}" style="text-decoration:none">${esc(ALGORITHMS[r.id].short)}</abbr></th>
        ${cell(r, 'awt')}${cell(r, 'att')}${cell(r, 'cpuUtilization')}
        <td class="num">${r.metrics.makespan}</td>
        <td><button class="btn btn-ghost btn-sm" data-view="${r.id}">View</button></td>
      </tr>`).join('');

  const k = state.compareMetric;
  const d = CMP_METRICS[k];
  const maxVal = Math.max(...ok.map((r) => r.metrics[k]), 0.0001);
  const bars = ok.map((r) => {
    const isBest = round(r.metrics[k]) === best[k];
    return `<div class="bar-row"><span class="name" title="${esc(ALGORITHMS[r.id].name)}">${esc(ALGORITHMS[r.id].short)}</span>
      <div class="bar-track" aria-hidden="true"><div class="bar-fill ${isBest ? 'is-best' : ''}" style="width:${(r.metrics[k] / maxVal) * 100}%"></div></div>
      <span class="val">${fmt(r.metrics[k])}</span>${isBest ? `<span class="best-icon" title="Best">${icon('trophy')}<span class="sr-only">best</span></span>` : '<span></span>'}</div>`;
  }).join('');

  el.innerHTML = `
    ${stale ? staleBanner('comparison').replace('data-rerun', 'data-recompare') : ''}
    <div class="stale-wrap ${stale ? 'is-stale' : ''}"><div class="stale-content compare-grid">
      <div class="table-wrap"><table class="table">
        <caption class="sr-only">Algorithm comparison on the same processes</caption>
        <thead><tr><th scope="col" style="text-align:left">Algorithm</th><th scope="col">AWT</th><th scope="col">ATT</th><th scope="col">CPU %</th><th scope="col">Total time</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div>
        <div class="metric-tabs" role="group" aria-label="Chart metric">
          ${Object.entries(CMP_METRICS).map(([key, m]) => `<button type="button" data-cmp-metric="${key}" aria-pressed="${key === k}">${m.label}</button>`).join('')}
        </div>
        <p class="muted small" style="margin-bottom:8px">${esc(d.full)}: ${d.better === 'min' ? 'lower' : 'higher'} is better. The green bar with the trophy is the best.</p>
        <div class="bars" role="img" aria-label="${esc(d.full)} by algorithm: ${ok.map((r) => `${ALGORITHMS[r.id].short} ${fmt(r.metrics[k])}`).join(', ')}">${bars}</div>
      </div>
    </div></div>`;
}

function bindCompare() {
  $('#compareBtn').addEventListener('click', runCompare);
  $('#compareBody').addEventListener('click', (e) => {
    const m = e.target.closest('[data-cmp-metric]');
    if (m) { state.compareMetric = m.dataset.cmpMetric; renderCompare(); $(`[data-cmp-metric="${state.compareMetric}"]`).focus(); return; }
    if (e.target.closest('[data-recompare]')) { runCompare(); return; }
    const v = e.target.closest('[data-view]');
    if (v) { selectAlgorithm(v.dataset.view); runSimulation(); }
  });
}

/* ------------------------------------------------------------- history */
async function renderHistory() {
  const el = $('#historyBody');
  el.innerHTML = '<p class="muted">Loading history…</p>';
  const items = await store.listHistory();
  const { mode, error } = store.storageMode();
  $('#histSource').innerHTML = mode === 'mysql'
    ? `<span class="badge badge-success">${icon('database')}Stored in MySQL</span>`
    : `<span class="badge" title="${esc(error)}">${icon('database')}MySQL unavailable: stored in this browser</span>`;
  hydrateIcons($('#histSource'));
  if (!items.length) {
    el.innerHTML = `<div class="empty">${icon('history')}<p>No simulations yet.</p><p class="muted small">Every successful run is saved here.</p></div>`;
    return;
  }
  el.innerHTML = `<div class="table-wrap"><table class="table">
    <thead><tr><th scope="col">Date</th><th scope="col" style="text-align:left">Algorithm</th><th scope="col">Processes</th><th scope="col">AWT</th><th scope="col">ATT</th><th scope="col">CPU %</th><th scope="col">Total time</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${items.map((h) => `<tr>
      <td class="mono small">${esc(new Date(h.created_at.replace(' ', 'T')).toLocaleString())}</td>
      <td style="text-align:left;font-weight:600">${esc(h.algorithm_name || h.algorithm)}</td>
      <td class="num">${h.process_count}</td>
      <td class="num">${fmt(Number(h.awt))}</td><td class="num">${fmt(Number(h.att))}</td>
      <td class="num">${fmt(Number(h.cpu_util))}</td><td class="num">${h.makespan}</td>
      <td><div class="hist-actions">
        <button class="btn btn-outline btn-sm" data-load="${esc(h.id)}">${icon('upload')}Load</button>
        <button class="del-btn" data-hdel="${esc(h.id)}" aria-label="Delete this history entry">${icon('trash')}</button>
      </div></td></tr>`).join('')}</tbody></table></div>`;
  el._items = items;
}

function bindHistory() {
  $('#histRefresh').addEventListener('click', renderHistory);
  $('#histClear').addEventListener('click', async () => {
    if (!(await confirmAction('Clear all history?', 'Every saved simulation will be permanently deleted. This cannot be undone.', 'Delete all'))) return;
    try { await store.clearHistory(); toast('History cleared.'); } catch (e) { toast(e.message, 'err'); }
    renderHistory();
  });
  $('#historyBody').addEventListener('click', async (e) => {
    const items = $('#historyBody')._items || [];
    const load = e.target.closest('[data-load]');
    const del = e.target.closest('[data-hdel]');
    if (load) {
      const h = items.find((x) => String(x.id) === load.dataset.load);
      const payload = typeof h.payload === 'string' ? JSON.parse(h.payload) : h.payload;
      state.processes = payload.processes.map((p) => ({ ...p, queue: p.queue ?? '' }));
      state.nextNum = nextNumFrom(state.processes);
      state.algorithm = h.algorithm;
      state.config = mergeConfig(payload.config);
      state.touched.clear();
      renderAlgoGrid(); renderAlgoInfo(); renderConfig();
      changed({ table: true });
      location.hash = '#/dashboard';
      runSimulation();
    } else if (del) {
      if (!(await confirmAction('Delete this entry?', 'This saved simulation will be permanently deleted.', 'Delete'))) return;
      try { await store.deleteHistory(del.dataset.hdel); toast('Entry deleted.'); } catch (err) { toast(err.message, 'err'); }
      renderHistory();
    }
  });
}

/* ------------------------------------------------------------- routing */
const SUBTITLES = {
  dashboard: 'Enter up to 50 processes, pick an algorithm, and watch Steve run the schedule one time unit at a time.',
  algorithms: 'The exact selection and tie-break order each algorithm follows in this simulator.',
  history: 'Every run is saved with its inputs. Load one to re-run it with the same settings.',
  about: 'Who built this simulator, and how ET, TT, WT and CPU utilization are calculated.',
};

function route() {
  const name = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/')[0];
  const page = SUBTITLES[name] ? name : 'dashboard';
  document.querySelectorAll('.page').forEach((p) => { p.hidden = p.dataset.page !== page; });
  document.querySelectorAll('.nav-item').forEach((a) => {
    if (a.dataset.route === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $('#pageSubtitle').textContent = SUBTITLES[page];
  $('#pageTitle').textContent = $(`[data-route="${page}"]`).textContent.trim();
  document.title = `${page === 'dashboard' ? 'Dashboard' : $(`[data-route="${page}"]`).textContent.trim()} · CPU Scheduling Simulator`;
  if (page !== 'dashboard') stopPlayback();
  if (page === 'history') renderHistory();
  if (page === 'about') renderTeam();
  closeMenu();
  return page;
}

function openMenu() {
  $('#sidebar').classList.add('open');
  $('#scrim').hidden = false;
  $('#menuBtn').setAttribute('aria-expanded', 'true');
  $('.nav-item[aria-current]')?.focus();
}
function closeMenu() {
  $('#sidebar').classList.remove('open');
  $('#scrim').hidden = true;
  $('#menuBtn').setAttribute('aria-expanded', 'false');
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $('#themeBtn');
  btn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
  btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to the day (light) theme' : 'Switch to the night (dark) theme');
  try { localStorage.setItem('cpu-sim-theme', theme); } catch { /* ignore */ }
}

/* ------------------------------------------------------------- init */
function init() {
  hydrateIcons();
  if (!loadDraft()) SAMPLE.forEach((s) => addProcess(s));

  renderAlgoGrid();
  renderAlgoInfo();
  renderConfig();
  renderProcessTable();
  renderResults();
  renderCompare();
  renderAlgorithmDocs($('#algoDocs'));
  renderAbout($('#aboutBody'));

  bindProcessTable();
  bindAlgorithmPanel();
  bindResults();
  bindCompare();
  bindHistory();
  initTeam({ toast, confirm: confirmAction });

  $('#algoDocs').addEventListener('click', (e) => {
    const a = e.target.closest('[data-pick]');
    if (a) selectAlgorithm(a.dataset.pick);
  });

  applyTheme(document.documentElement.dataset.theme || 'dark');
  $('#themeBtn').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('#menuBtn').addEventListener('click', openMenu);
  $('#scrim').addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#sidebar').classList.contains('open')) { closeMenu(); $('#menuBtn').focus(); } });

  let first = true;
  window.addEventListener('hashchange', () => { route(); if (!first) $('#main').focus({ preventScroll: true }); window.scrollTo(0, 0); });
  route();
  first = false;
}

init();
