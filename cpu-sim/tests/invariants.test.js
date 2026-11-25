/**
 * Property tests: run every algorithm on many deterministic pseudo-random
 * workloads and check invariants that must hold for any correct schedule,
 * plus rule checks that are independent of the engine's implementation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, cloneDefaultConfig, ALGORITHM_IDS } from '../js/engine/algorithms.js';
import { pidNumber } from '../js/engine/core.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function workload(seed) {
  const r = rng(seed);
  const n = 1 + Math.floor(r() * 12);
  return Array.from({ length: n }, (_, i) => ({
    pid: `P${i + 1}`,
    arrival: Math.floor(r() * 15),
    burst: 1 + Math.floor(r() * 9),
    priority: 1 + Math.floor(r() * 4),
  }));
}

/** Expand segments into per-time-unit ownership. */
function timeline(segments) {
  const out = [];
  for (const s of segments) for (let t = s.start; t < s.end; t++) out[t] = s.pid;
  return out;
}

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

test('universal invariants for all algorithms', () => {
  const cfg = cloneDefaultConfig();
  for (const seed of SEEDS) {
    const procs = workload(seed);
    for (const id of ALGORITHM_IDS) {
      const ctx = `${id} seed=${seed}`;
      const r = simulate(id, procs, cfg);
      const segs = r.segments;

      // Contiguous timeline from 0, no overlaps, no zero-length blocks.
      assert.equal(segs[0].start, 0, ctx);
      segs.forEach((s, i) => {
        assert.ok(s.end > s.start, ctx);
        if (i) assert.equal(s.start, segs[i - 1].end, ctx);
      });

      const tl = timeline(segs);
      const byPid = Object.fromEntries(procs.map((p) => [p.pid, p]));
      for (const row of r.rows) {
        const p = byPid[row.pid];
        const units = tl.map((x, t) => (x === row.pid ? t : -1)).filter((t) => t >= 0);
        assert.equal(units.length, p.burst, `${ctx} ${row.pid} executes exactly its burst`);
        assert.ok(units[0] >= p.arrival, `${ctx} ${row.pid} never runs before arrival`);
        assert.equal(row.start, units[0], `${ctx} start = first execution`);
        assert.equal(row.completion, units[units.length - 1] + 1, `${ctx} completion`);
        assert.equal(row.tat, row.completion - row.arrival, ctx);
        assert.equal(row.wt, row.tat - row.burst, ctx);
        assert.equal(row.rt, row.start - row.arrival, ctx);
        assert.ok(row.wt >= 0 && row.rt >= 0 && row.rt <= row.wt, ctx);
      }

      // Work-conserving: CPU is idle only when no arrived process is unfinished.
      tl.forEach((x, t) => {
        if (x === null) {
          const waiting = r.rows.some((row) => row.arrival <= t && row.completion > t);
          assert.ok(!waiting, `${ctx} idle at t=${t} while work was available`);
        }
      });

      const busy = r.rows.reduce((s, x) => s + x.burst, 0);
      const makespan = Math.max(...r.rows.map((x) => x.completion));
      assert.equal(r.metrics.busy, busy, ctx);
      assert.equal(r.metrics.makespan, makespan, ctx);
      assert.ok(Math.abs(r.metrics.cpuUtilization - (busy / makespan) * 100) < 1e-9, ctx);
    }
  }
});

test('non-preemptive algorithms run each process in exactly one block', () => {
  for (const seed of SEEDS) {
    const procs = workload(seed);
    for (const id of ['FCFS', 'SJF', 'NPP']) {
      const r = simulate(id, procs);
      const counts = {};
      r.segments.filter((s) => s.pid).forEach((s) => (counts[s.pid] = (counts[s.pid] || 0) + 1));
      assert.ok(Object.values(counts).every((c) => c === 1), `${id} seed=${seed}`);
    }
  }
});

/**
 * Independent rule check: at every dispatch decision the chosen process must be
 * the minimum of the eligible set under the algorithm's tie-break keys.
 */
function ruleCheck(id, keyFn, preemptive) {
  for (const seed of SEEDS) {
    const procs = workload(seed);
    const r = simulate(id, procs);
    const tl = timeline(r.segments);
    const rem = Object.fromEntries(procs.map((p) => [p.pid, p.burst]));
    let prev = null;
    for (let t = 0; t < tl.length; t++) {
      const running = tl[t];
      const eligible = procs.filter((p) => p.arrival <= t && rem[p.pid] > 0);
      const decision = preemptive || prev === null || rem[prev] === 0;
      if (decision && running) {
        const ranked = [...eligible].sort((a, b) => {
          const ka = keyFn(a, rem), kb = keyFn(b, rem);
          for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
          return 0;
        });
        assert.equal(running, ranked[0].pid, `${id} seed=${seed} t=${t}`);
      }
      if (running) rem[running] -= 1;
      prev = running;
    }
  }
}

test('FCFS follows Arrival → PID', () => ruleCheck('FCFS', (p) => [p.arrival, pidNumber(p.pid)], false));
test('SJF follows Burst → Arrival → PID', () => ruleCheck('SJF', (p) => [p.burst, p.arrival, pidNumber(p.pid)], false));
test('NPP follows Priority → Burst → Arrival → PID', () => ruleCheck('NPP', (p) => [p.priority, p.burst, p.arrival, pidNumber(p.pid)], false));
test('SRTF follows Remaining → Arrival → PID at every time unit', () => ruleCheck('SRTF', (p, rem) => [rem[p.pid], p.arrival, pidNumber(p.pid)], true));
test('PP follows Priority → Remaining → Arrival → PID at every time unit', () => ruleCheck('PP', (p, rem) => [p.priority, rem[p.pid], p.arrival, pidNumber(p.pid)], true));

test('Round Robin matches an independent reference implementation', () => {
  for (const q of [1, 2, 3, 5]) {
    for (const seed of SEEDS) {
      const procs = workload(seed);
      const r = simulate('RR', procs, { ...cloneDefaultConfig(), quantum: q });
      assert.deepEqual(timeline(r.segments), referenceRR(procs, q), `q=${q} seed=${seed}`);
    }
  }
});

function referenceRR(procs, q) {
  const order = [...procs].sort((a, b) => a.arrival - b.arrival || pidNumber(a.pid) - pidNumber(b.pid));
  const rem = Object.fromEntries(procs.map((p) => [p.pid, p.burst]));
  const queue = [];
  const out = [];
  let t = 0, i = 0, left = procs.length;
  const admit = (upTo) => { while (i < order.length && order[i].arrival <= upTo) queue.push(order[i++].pid); };
  admit(0);
  while (left) {
    if (!queue.length) { const nt = order[i].arrival; while (t < nt) out[t++] = null; admit(t); continue; }
    const pid = queue.shift();
    const run = Math.min(q, rem[pid]);
    for (let k = 0; k < run; k++) out[t++] = pid;
    admit(t); // arrivals up to and including t enter before the preempted process
    rem[pid] -= run;
    if (rem[pid] > 0) queue.push(pid); else left--;
  }
  return out;
}
