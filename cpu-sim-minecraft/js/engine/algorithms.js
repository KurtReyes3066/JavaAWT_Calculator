/**
 * The eight scheduling algorithms, each a thin configuration of the shared
 * engine in core.js, plus input validation and default configuration.
 */
import { runEngine, DISCIPLINES } from './core.js';
import { computeRows, computeMetrics } from './metrics.js';

export const MAX_PROCESSES = 50;

export const DEFAULT_CONFIG = Object.freeze({
  quantum: 2,
  mlq: {
    queues: [
      { id: 1, discipline: 'RR', quantum: 2, priority: 1 },
      { id: 2, discipline: 'FCFS', quantum: 2, priority: 2 },
      { id: 3, discipline: 'SJF', quantum: 2, priority: 3 },
    ],
  },
  // Defaults follow the course example: Level 1 = 1 quantum, Level 2 = 2 quantum,
  // Level 3 = SJF. A running time slice is never interrupted by new arrivals.
  mlfq: {
    queues: [
      { discipline: 'RR', quantum: 1 },
      { discipline: 'RR', quantum: 2 },
      { discipline: 'SJF', quantum: 4 },
    ],
  },
});

export function cloneDefaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

export const MLQ_DISCIPLINES = ['RR', 'FCFS', 'SJF', 'SRTF', 'NPP', 'PP'];
// MLFQ: upper levels are always Round Robin, because demotion is triggered by
// using a full quantum. The last level may use any algorithm.
export const MLFQ_LAST_DISCIPLINES = ['RR', 'FCFS', 'SJF', 'SRTF', 'NPP', 'PP'];

export const ALGORITHMS = {
  FCFS: {
    id: 'FCFS', short: 'FCFS', name: 'First Come First Served', type: 'Non-preemptive',
    summary: 'Runs processes in order of arrival. A process keeps the CPU until its burst finishes.',
    rules: [
      'Processes are ordered by Arrival Time.',
      'Same Arrival Time: lower PID first.',
      'A running process is never interrupted.',
    ],
    tieBreak: ['Arrival Time', 'PID'],
  },
  SJF: {
    id: 'SJF', short: 'SJF', name: 'Shortest Job First', type: 'Non-preemptive',
    summary: 'When the CPU becomes free, picks the arrived process with the shortest Burst Time.',
    rules: [
      'Only processes that have already arrived are considered.',
      'Shortest Burst Time wins; ties go to earlier Arrival Time, then lower PID.',
      'Once started, a process runs to completion.',
    ],
    tieBreak: ['Burst Time', 'Arrival Time', 'PID'],
  },
  SRTF: {
    id: 'SRTF', short: 'SRTF', name: 'Shortest Remaining Time First', type: 'Preemptive',
    summary: 'Preemptive SJF: the process with the least remaining burst always holds the CPU.',
    rules: [
      'On every arrival, compare the newcomer\'s burst with the running process\'s remaining time.',
      'Strictly shorter remaining time preempts; ties go to earlier Arrival Time, then lower PID.',
      'Preempted processes keep their remaining time.',
    ],
    tieBreak: ['Remaining Time', 'Arrival Time', 'PID'],
  },
  NPP: {
    id: 'NPP', short: 'Priority NP', name: 'Non-Preemptive Priority', type: 'Non-preemptive',
    summary: 'When the CPU becomes free, picks the arrived process with the highest priority (smallest number).',
    rules: [
      'Smaller priority number = higher priority (1 beats 2).',
      'Ties: shorter Burst Time, then earlier Arrival Time, then lower PID.',
      'Once started, a process runs to completion.',
    ],
    tieBreak: ['Priority', 'Burst Time', 'Arrival Time', 'PID'],
  },
  PP: {
    id: 'PP', short: 'Priority P', name: 'Preemptive Priority', type: 'Preemptive',
    summary: 'The highest-priority arrived process always holds the CPU; a better arrival preempts it.',
    rules: [
      'Smaller priority number = higher priority.',
      'Ties: shorter Remaining Time, then earlier Arrival Time, then lower PID.',
      'If the running process still wins the comparison it continues.',
      'Preempted processes keep their remaining time.',
    ],
    tieBreak: ['Priority', 'Remaining Time', 'Arrival Time', 'PID'],
  },
  RR: {
    id: 'RR', short: 'Round Robin', name: 'Round Robin', type: 'Preemptive',
    summary: 'FCFS with a time slice: each process runs for at most one Time Quantum, then goes to the back of the ready queue.',
    rules: [
      'Ready queue is FIFO; arrivals join in Arrival Time order, then PID.',
      'A process that finishes early releases the CPU immediately.',
      'A process that uses its full quantum goes to the back of the queue.',
      'If a process arrives at the same instant a quantum expires, the new arrival is queued first.',
    ],
    tieBreak: ['Ready-queue order', 'Arrival Time', 'PID'],
  },
  MLQ: {
    id: 'MLQ', short: 'MLQ', name: 'Multilevel Queue', type: 'Queue-based',
    summary: 'Each process is permanently assigned to one queue. Queues have fixed priorities and their own algorithm.',
    rules: [
      'A higher-priority queue is always served before a lower one.',
      'A process arriving in a higher queue preempts a process from a lower queue.',
      'An interrupted process resumes first (with its unused quantum) when its queue runs again.',
      'Processes never move between queues. Default assignment: queue = priority (capped at the last queue).',
    ],
    tieBreak: ['Queue priority', 'Queue\'s own rule'],
  },
  MLFQ: {
    id: 'MLFQ', short: 'MLFQ', name: 'Multilevel Feedback Queue', type: 'Queue-based (dynamic)',
    summary: 'New processes start in the top queue. Using a full quantum demotes a process to the next queue.',
    rules: [
      'New processes enter the highest-priority queue (Level 1).',
      'Using a whole quantum demotes the process one level; it keeps its remaining burst.',
      'The CPU always takes the next process from the highest non-empty queue.',
      'A running time slice is never interrupted: a higher-queue arrival waits until the slice ends.',
      'Upper levels are Round Robin; the last level (default SJF) can use any algorithm.',
    ],
    tieBreak: ['Queue level', 'Queue order (FIFO) / SJF in last queue'],
  },
};

export const ALGORITHM_IDS = Object.keys(ALGORITHMS);

/** Validates raw process rows. Returns { ok, errors: [{index, field, message}] }. */
export function validateProcesses(processes) {
  const errors = [];
  const seen = new Set();
  if (!Array.isArray(processes) || processes.length === 0) {
    return { ok: false, errors: [{ index: -1, field: null, message: 'Add at least one process.' }] };
  }
  if (processes.length > MAX_PROCESSES) {
    errors.push({ index: -1, field: null, message: `At most ${MAX_PROCESSES} processes are supported.` });
  }
  processes.forEach((p, i) => {
    const pid = String(p.pid ?? '').trim();
    if (!pid) errors.push({ index: i, field: 'pid', message: 'PID is required.' });
    else if (seen.has(pid.toUpperCase())) errors.push({ index: i, field: 'pid', message: `Duplicate PID ${pid}.` });
    seen.add(pid.toUpperCase());

    const check = (field, label, min) => {
      const raw = p[field];
      if (raw === '' || raw === null || raw === undefined) {
        errors.push({ index: i, field, message: `${label} is required.` });
        return;
      }
      const v = Number(raw);
      if (!Number.isFinite(v) || !Number.isInteger(v)) {
        errors.push({ index: i, field, message: `${label} must be a whole number.` });
      } else if (v < min) {
        errors.push({ index: i, field, message: min === 0 ? `${label} cannot be negative.` : `${label} must be at least ${min}.` });
      } else if (v > 100000) {
        errors.push({ index: i, field, message: `${label} must be ≤ 100000.` });
      }
    };
    check('arrival', 'Arrival Time', 0);
    check('burst', 'Burst Time', 1);
    check('priority', 'Priority', 1);
  });
  return { ok: errors.length === 0, errors };
}

/** Validates the configuration needed by one algorithm. Returns error strings. */
export function validateConfig(algorithmId, config) {
  const errs = [];
  const isQ = (v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 1000;
  if (algorithmId === 'RR' && !isQ(config.quantum)) errs.push('Time Quantum must be a whole number between 1 and 1000.');
  if (algorithmId === 'MLQ') {
    const qs = config.mlq?.queues || [];
    if (qs.length < 1) errs.push('MLQ needs at least one queue.');
    qs.forEach((q, i) => {
      if (!MLQ_DISCIPLINES.includes(q.discipline)) errs.push(`Queue ${i + 1}: choose an algorithm.`);
      if (q.discipline === 'RR' && !isQ(q.quantum)) errs.push(`Queue ${i + 1}: quantum must be 1–1000.`);
      if (!Number.isInteger(Number(q.priority)) || Number(q.priority) < 1) errs.push(`Queue ${i + 1}: priority must be a whole number ≥ 1.`);
    });
    const prios = qs.map((q) => Number(q.priority));
    if (new Set(prios).size !== prios.length) errs.push('MLQ queue priorities must be unique.');
  }
  if (algorithmId === 'MLFQ') {
    const c = config.mlfq || {};
    const qs = c.queues || [];
    if (qs.length < 2) errs.push('MLFQ needs at least two queues.');
    qs.forEach((q, i) => {
      const last = i === qs.length - 1;
      if (!last && q.discipline !== 'RR') errs.push(`Queue ${i + 1}: only the last level can use ${q.discipline}; upper levels must be Round Robin.`);
      if (last && !MLFQ_LAST_DISCIPLINES.includes(q.discipline)) errs.push(`Queue ${i + 1}: choose an algorithm.`);
      if (q.discipline === 'RR' && !isQ(q.quantum)) errs.push(`Queue ${i + 1}: quantum must be 1–1000.`);
    });
  }
  return errs;
}

/** Sorted MLQ queues (highest priority first). */
export function mlqLevels(config) {
  return [...config.mlq.queues].sort((a, b) => a.priority - b.priority || a.id - b.id);
}

/** Queue id a process belongs to in MLQ (explicit choice, else mapped from priority). */
export function mlqQueueFor(p, config) {
  const ids = [...config.mlq.queues].map((q) => q.id).sort((a, b) => a - b);
  const explicit = Number(p.queue);
  if (explicit && ids.includes(explicit)) return explicit;
  const idx = Math.min(Math.max(1, Number(p.priority) || 1), ids.length) - 1;
  return ids[idx];
}

function engineSetup(algorithmId, config) {
  switch (algorithmId) {
    case 'FCFS':
    case 'SJF':
    case 'SRTF':
    case 'NPP':
    case 'PP':
      return { levels: [{ discipline: algorithmId, label: 'Ready' }], options: {} };
    case 'RR':
      return { levels: [{ discipline: 'RR', quantum: Number(config.quantum), label: 'Ready' }], options: {} };
    case 'MLQ': {
      const sorted = mlqLevels(config);
      const levels = sorted.map((q) => ({ discipline: q.discipline, quantum: Number(q.quantum), label: `Q${q.id}` }));
      const indexOf = new Map(sorted.map((q, i) => [q.id, i]));
      return { levels, options: { assignLevel: (p) => indexOf.get(mlqQueueFor(p, config)) } };
    }
    case 'MLFQ': {
      const c = config.mlfq;
      const levels = c.queues.map((q, i) => ({ discipline: q.discipline, quantum: Number(q.quantum), label: `Q${i + 1}` }));
      return {
        levels,
        options: {
          assignLevel: () => 0,
          crossLevelPreemption: false,
          demoteOnQuantum: true,
        },
      };
    }
    default:
      throw new Error(`Unknown algorithm "${algorithmId}".`);
  }
}

/**
 * Runs one algorithm on a set of processes.
 * @returns {{algorithm, segments, rows, metrics, trace, levels}}
 */
export function simulate(algorithmId, processes, config = DEFAULT_CONFIG) {
  const v = validateProcesses(processes);
  if (!v.ok) throw new Error(v.errors.map((e) => e.message).join(' '));
  const cErr = validateConfig(algorithmId, config);
  if (cErr.length) throw new Error(cErr.join(' '));

  const input = processes.map((p) => ({
    pid: String(p.pid).trim(),
    arrival: Number(p.arrival),
    burst: Number(p.burst),
    priority: Number(p.priority),
    queue: algorithmId === 'MLQ' ? mlqQueueFor(p, config) : undefined,
  }));
  const { levels, options } = engineSetup(algorithmId, config);
  const out = runEngine(input, levels, options);

  // Present rows in input order (P1, P2, …) rather than engine order.
  const byPid = new Map(out.processes.map((p) => [p.pid, p]));
  const rows = computeRows(input.map((p) => byPid.get(p.pid)));
  const metrics = computeMetrics(rows, out.segments);
  return { algorithm: algorithmId, segments: out.segments, rows, metrics, trace: out.trace, levels: out.levels };
}

export { DISCIPLINES };
