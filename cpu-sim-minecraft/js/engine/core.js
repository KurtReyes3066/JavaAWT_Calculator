/**
 * Core discrete-time scheduling engine.
 *
 * Every algorithm in this simulator is expressed as one or more ready queues
 * ("levels"), each governed by a queue discipline. Single-queue algorithms
 * (FCFS, SJF, SRTF, NPP, PP, RR) are one level; MLQ and MLFQ use several.
 * This keeps all scheduling logic in one place: no algorithm duplicates the
 * time loop, idle handling, preemption bookkeeping or metric collection.
 *
 * Time advances in whole units. At each time t the engine, in this order:
 *   1. admits processes arriving at t (ordered by Arrival Time, then PID)
 *   2. re-queues the process whose quantum expired at t (so new arrivals at
 *      the same instant enter the queue first — the textbook RR convention)
 *   3. checks preemption of the running process
 *   4. dispatches a process if the CPU is free
 *   5. executes one time unit (or jumps over an idle gap)
 *
 * This module has no DOM dependencies.
 */

/** Numeric part of a PID ("P12" -> 12) used for deterministic tie-breaking. */
export function pidNumber(pid) {
  const m = /(\d+)\s*$/.exec(String(pid));
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

function comparePid(a, b) {
  return a.num - b.num || (a.pid < b.pid ? -1 : a.pid > b.pid ? 1 : 0);
}

/** Builds a comparator from an ordered list of keys (smaller wins). */
function byKeys(...keys) {
  return (a, b) => {
    for (const k of keys) {
      const d = a[k] - b[k];
      if (d !== 0) return d;
    }
    return comparePid(a, b);
  };
}

/**
 * Queue disciplines. `fifo` disciplines dispatch the head of the queue;
 * the others dispatch the minimum according to `compare`.
 * `preemptive` means a ready process in the same queue may take the CPU
 * from the running one when it strictly wins the comparison.
 */
export const DISCIPLINES = {
  FCFS: { id: 'FCFS', label: 'FCFS', fifo: true, preemptive: false, usesQuantum: false },
  RR: { id: 'RR', label: 'Round Robin', fifo: true, preemptive: false, usesQuantum: true },
  // SJF compares the remaining burst. For plain SJF this always equals the Burst
  // Time at a decision point; in MLFQ it is the work left after earlier queues.
  SJF: { id: 'SJF', label: 'SJF', fifo: false, preemptive: false, usesQuantum: false,
    compare: byKeys('remaining', 'arrival') },
  SRTF: { id: 'SRTF', label: 'SRTF', fifo: false, preemptive: true, usesQuantum: false,
    compare: byKeys('remaining', 'arrival') },
  NPP: { id: 'NPP', label: 'Priority (NP)', fifo: false, preemptive: false, usesQuantum: false,
    compare: byKeys('priority', 'burst', 'arrival') },
  PP: { id: 'PP', label: 'Priority (P)', fifo: false, preemptive: true, usesQuantum: false,
    compare: byKeys('priority', 'remaining', 'arrival') },
};

/** Sorts processes into admission order: Arrival Time, then PID. */
export function arrivalOrder(a, b) {
  return a.arrival - b.arrival || comparePid(a, b);
}

/**
 * Runs the engine.
 *
 * @param {Array<{pid:string, arrival:number, burst:number, priority:number, queue?:number}>} processes
 * @param {Array<{discipline:string, quantum?:number, label?:string}>} levels  ordered highest priority first
 * @param {object} [options]
 * @param {(p:object)=>number} [options.assignLevel]  level index for a new process (default 0)
 * @param {boolean} [options.demoteOnQuantum=false]  MLFQ: a process that uses its full quantum moves down one level
 * @param {boolean} [options.crossLevelPreemption=true]  higher-queue arrivals interrupt a lower-queue process
 * @returns {{segments:Array, processes:Array, trace:Array, levels:Array}}
 */
export function runEngine(processes, levels, options = {}) {
  if (!Array.isArray(levels) || levels.length === 0) throw new Error('At least one queue is required.');
  const L = levels.map((cfg, i) => {
    const disc = DISCIPLINES[cfg.discipline];
    if (!disc) throw new Error(`Unknown queue discipline "${cfg.discipline}".`);
    const quantum = disc.usesQuantum ? Number(cfg.quantum) : Infinity;
    if (disc.usesQuantum && !(Number.isInteger(quantum) && quantum >= 1)) {
      throw new Error(`Queue ${i + 1}: time quantum must be a whole number ≥ 1.`);
    }
    return { index: i, disc, quantum, label: cfg.label || `Q${i + 1}`, ready: [], resumePid: null };
  });

  const assignLevel = options.assignLevel || (() => 0);
  const demoteOnQuantum = options.demoteOnQuantum === true;
  // When false, a process from a higher queue waits until the running
  // process's time slice ends (or it completes) instead of preempting it.
  const crossLevelPreemption = options.crossLevelPreemption !== false;

  const procs = processes.map((p) => ({
    pid: String(p.pid),
    num: pidNumber(p.pid),
    arrival: Number(p.arrival),
    burst: Number(p.burst),
    priority: Number(p.priority),
    queue: p.queue,
    remaining: Number(p.burst),
    level: 0,
    quantumUsed: 0,
    start: null,
    completion: null,
  }));
  procs.sort(arrivalOrder);

  const n = procs.length;
  const segments = [];
  const trace = [];
  if (n === 0) return { segments, processes: procs, trace, levels: L.map(levelInfo) };

  // Safety bound: the schedule can never be longer than the last arrival plus all work.
  const limit = procs[n - 1].arrival + procs.reduce((s, p) => s + p.burst, 0) + 1;

  let t = 0;
  let ai = 0; // next process to admit
  let current = null;
  let pending = null; // process whose quantum expired; re-queued after arrivals
  let done = 0;
  let carry = []; // events that happened at the end of the previous unit

  const enqueue = (p, front = false) => {
    const q = L[p.level].ready;
    if (front) q.unshift(p); else q.push(p);
  };

  const highestNonEmpty = () => {
    for (let i = 0; i < L.length; i++) if (L[i].ready.length) return i;
    return -1;
  };

  const best = (lvl) => {
    const q = lvl.ready;
    if (!q.length) return null;
    if (lvl.disc.fifo) return q[0];
    let b = q[0];
    for (let i = 1; i < q.length; i++) if (lvl.disc.compare(q[i], b) < 0) b = q[i];
    return b;
  };

  const take = (i) => {
    const lvl = L[i];
    let p = null;
    if (lvl.resumePid !== null) {
      p = lvl.ready.find((x) => x.pid === lvl.resumePid) || null;
      lvl.resumePid = null;
    }
    if (!p) p = best(lvl);
    lvl.ready.splice(lvl.ready.indexOf(p), 1);
    return p;
  };

  const qName = (i) => L[i].label;
  const multi = L.length > 1;

  const addSegment = (pid, start, end, level) => {
    const last = segments[segments.length - 1];
    if (last && last.pid === pid && last.end === start && last.level === level) {
      last.end = end;
    } else {
      segments.push({ pid, start, end, level });
    }
  };

  while (done < n) {
    if (t > limit) throw new Error('Simulation exceeded its safe time limit (possible scheduling loop).');
    const events = carry;
    carry = [];

    // 1. Admit arrivals at time t.
    while (ai < n && procs[ai].arrival <= t) {
      const p = procs[ai++];
      const lvl = Math.min(Math.max(0, assignLevel(p) | 0), L.length - 1);
      p.level = lvl;
      enqueue(p);
      events.push({ type: 'arrive', pid: p.pid, text: multi ? `${p.pid} arrived → ${qName(lvl)}` : `${p.pid} arrived` });
    }

    // 2. Re-queue the process whose quantum expired at t (after new arrivals).
    if (pending) {
      enqueue(pending);
      pending = null;
    }

    // 3. Preemption check for the running process.
    if (current) {
      const top = highestNonEmpty();
      if (crossLevelPreemption && top !== -1 && top < current.level) {
        const lvl = L[current.level];
        if (!lvl.disc.preemptive) lvl.resumePid = current.pid; // resumes first when its queue runs again
        enqueue(current, true);
        events.push({ type: 'preempt', pid: current.pid, text: `${current.pid} preempted by higher-priority ${qName(top)}` });
        current = null;
      } else if (L[current.level].disc.preemptive) {
        const lvl = L[current.level];
        const challenger = best(lvl);
        if (challenger && lvl.disc.compare(challenger, current) < 0) {
          enqueue(current);
          events.push({ type: 'preempt', pid: current.pid, text: `${current.pid} preempted by ${challenger.pid}` });
          current = null;
        }
      }
    }

    // 4. Dispatch.
    if (!current) {
      const top = highestNonEmpty();
      if (top !== -1) {
        current = take(top);
        if (current.start === null) current.start = t;
        events.push({ type: 'dispatch', pid: current.pid, text: multi ? `${current.pid} dispatched from ${qName(current.level)}` : `${current.pid} dispatched` });
      }
    }

    trace.push(snapshot(t, current, L, procs, events));

    // 5. Execute (or idle until the next arrival).
    if (!current) {
      const next = procs[ai].arrival; // done < n and nothing ready => an arrival must be pending
      addSegment(null, t, next, null);
      t = next;
      continue;
    }

    addSegment(current.pid, t, t + 1, multi ? current.level : 0);
    current.remaining -= 1;
    current.quantumUsed += 1;
    t += 1;

    if (current.remaining === 0) {
      current.completion = t;
      current.quantumUsed = 0;
      done++;
      carry.push({ type: 'complete', pid: current.pid, text: `${current.pid} completed` });
      current = null;
    } else if (current.quantumUsed >= L[current.level].quantum) {
      current.quantumUsed = 0;
      const from = current.level;
      if (demoteOnQuantum && from < L.length - 1) {
        current.level = from + 1;
        carry.push({ type: 'demote', pid: current.pid, text: `${current.pid} used its full quantum: demoted ${qName(from)} → ${qName(from + 1)}` });
      } else {
        carry.push({ type: 'quantum', pid: current.pid, text: `${current.pid} quantum expired → back of ${qName(from)}` });
      }
      pending = current;
      current = null;
    }
  }

  // Final snapshot so step-through ends on the completion events.
  trace.push(snapshot(t, null, L, procs, carry));

  return { segments, processes: procs, trace, levels: L.map(levelInfo) };
}

function levelInfo(l) {
  return { label: l.label, discipline: l.disc.id, quantum: Number.isFinite(l.quantum) ? l.quantum : null };
}

function snapshot(t, current, L, procs, events) {
  return {
    time: t,
    running: current ? current.pid : null,
    runningLevel: current ? current.level : null,
    queues: L.map((l) => l.ready.map((p) => p.pid)),
    remaining: Object.fromEntries(procs.map((p) => [p.pid, p.remaining])),
    events,
  };
}
