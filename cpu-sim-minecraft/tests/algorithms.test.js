/**
 * Hand-verified scheduling tests. Every expected Gantt chart and table below
 * was worked out manually from the rules in docs/ALGORITHMS.md.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, cloneDefaultConfig } from '../js/engine/algorithms.js';

const P = (pid, arrival, burst, priority = 1, queue) => ({ pid, arrival, burst, priority, queue });

/** Compact Gantt representation: "P1 0-8, IDLE 8-10, …" */
const gantt = (r) => r.segments.map((s) => `${s.pid ?? 'IDLE'} ${s.start}-${s.end}`).join(', ');

/** Row lookup: pid -> [start, completion, TT, WT, ET] */
const table = (r) => Object.fromEntries(r.rows.map((x) => [x.pid, [x.start, x.completion, x.tat, x.wt, x.rt]]));

const close = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1e-9, `${msg}: expected ${expected}, got ${actual}`);

function checkMetrics(r, { awt, att, art, cpu }) {
  close(r.metrics.awt, awt, 'AWT');
  close(r.metrics.att, att, 'ATT');
  close(r.metrics.art, art, 'Avg response');
  close(r.metrics.cpuUtilization, cpu, 'CPU utilization');
}

// Shared data set (the reference screenshot): different arrivals, arrivals during execution.
const SET_A = [P('P1', 0, 8, 1), P('P2', 1, 4, 2), P('P3', 2, 9, 3), P('P4', 3, 5, 1)];

describe('FCFS', () => {
  test('different arrival times, arrivals during execution, zero idle', () => {
    const r = simulate('FCFS', SET_A);
    assert.equal(gantt(r), 'P1 0-8, P2 8-12, P3 12-21, P4 21-26');
    assert.deepEqual(table(r), {
      P1: [0, 8, 8, 0, 0], P2: [8, 12, 11, 7, 7], P3: [12, 21, 19, 10, 10], P4: [21, 26, 23, 18, 18],
    });
    checkMetrics(r, { awt: 35 / 4, att: 61 / 4, art: 35 / 4, cpu: 100 });
  });

  test('identical arrival times are ordered by PID (numerically: P2 before P10)', () => {
    const r = simulate('FCFS', [P('P10', 0, 2), P('P2', 0, 3), P('P1', 1, 1)]);
    assert.equal(gantt(r), 'P2 0-3, P10 3-5, P1 5-6');
  });

  test('CPU idle before first arrival and between processes', () => {
    const r = simulate('FCFS', [P('P1', 2, 3), P('P2', 10, 2)]);
    assert.equal(gantt(r), 'IDLE 0-2, P1 2-5, IDLE 5-10, P2 10-12');
    assert.deepEqual(table(r), { P1: [2, 5, 3, 0, 0], P2: [10, 12, 2, 0, 0] });
    checkMetrics(r, { awt: 0, att: 2.5, art: 0, cpu: (5 / 12) * 100 });
    assert.equal(r.metrics.busy, 5);
    assert.equal(r.metrics.makespan, 12);
  });

  test('completion coincides exactly with next arrival (shared boundary, no idle)', () => {
    const r = simulate('FCFS', [P('P1', 0, 3), P('P2', 3, 2), P('P3', 5, 1)]);
    assert.equal(gantt(r), 'P1 0-3, P2 3-5, P3 5-6');
    checkMetrics(r, { awt: 0, att: 2, art: 0, cpu: 100 });
  });
});

describe('SJF (non-preemptive)', () => {
  test('picks shortest burst among arrived processes', () => {
    const r = simulate('SJF', SET_A);
    assert.equal(gantt(r), 'P1 0-8, P2 8-12, P4 12-17, P3 17-26');
    assert.deepEqual(table(r), {
      P1: [0, 8, 8, 0, 0], P2: [8, 12, 11, 7, 7], P3: [17, 26, 24, 15, 15], P4: [12, 17, 14, 9, 9],
    });
    checkMetrics(r, { awt: 31 / 4, att: 57 / 4, art: 31 / 4, cpu: 100 });
  });

  test('identical burst times: earlier arrival wins', () => {
    const r = simulate('SJF', [P('P1', 0, 5), P('P3', 2, 2), P('P2', 1, 2)]);
    assert.equal(gantt(r), 'P1 0-5, P2 5-7, P3 7-9');
  });

  test('identical arrival and burst: lower PID wins', () => {
    const r = simulate('SJF', [P('P3', 0, 3), P('P1', 0, 3), P('P2', 0, 3)]);
    assert.equal(gantt(r), 'P1 0-3, P2 3-6, P3 6-9');
    checkMetrics(r, { awt: 3, att: 6, art: 3, cpu: 100 });
  });

  test('does not consider processes that have not arrived yet', () => {
    const r = simulate('SJF', [P('P1', 0, 4), P('P2', 5, 1)]);
    assert.equal(gantt(r), 'P1 0-4, IDLE 4-5, P2 5-6');
  });
});

describe('SRTF (preemptive SJF)', () => {
  test('preempts when a newcomer has strictly shorter remaining time', () => {
    const r = simulate('SRTF', SET_A);
    assert.equal(gantt(r), 'P1 0-1, P2 1-5, P4 5-10, P1 10-17, P3 17-26');
    assert.deepEqual(table(r), {
      P1: [0, 17, 17, 9, 0], P2: [1, 5, 4, 0, 0], P3: [17, 26, 24, 15, 15], P4: [5, 10, 7, 2, 2],
    });
    checkMetrics(r, { awt: 26 / 4, att: 52 / 4, art: 17 / 4, cpu: 100 });
  });

  test('equal remaining time: earlier arrival (the running process) keeps the CPU', () => {
    const r = simulate('SRTF', [P('P1', 0, 4), P('P2', 1, 3)]);
    assert.equal(gantt(r), 'P1 0-4, P2 4-7');
  });

  test('Start Time is the FIRST time the process runs, not its latest segment', () => {
    const r = simulate('SRTF', [P('P1', 0, 1000), P('P2', 5, 1)]);
    assert.equal(gantt(r), 'P1 0-5, P2 5-6, P1 6-1001');
    assert.deepEqual(table(r).P1, [0, 1001, 1001, 1, 0]);
    assert.deepEqual(table(r).P2, [5, 6, 1, 0, 0]);
  });
});

describe('Non-preemptive Priority', () => {
  test('smaller number = higher priority, no interruption', () => {
    const r = simulate('NPP', SET_A);
    assert.equal(gantt(r), 'P1 0-8, P4 8-13, P2 13-17, P3 17-26');
    assert.deepEqual(table(r), {
      P1: [0, 8, 8, 0, 0], P2: [13, 17, 16, 12, 12], P3: [17, 26, 24, 15, 15], P4: [8, 13, 10, 5, 5],
    });
    checkMetrics(r, { awt: 8, att: 14.5, art: 8, cpu: 100 });
  });

  test('identical priority: shorter burst, then arrival, then PID', () => {
    const r = simulate('NPP', [P('P1', 0, 2, 1), P('P2', 1, 5, 2), P('P3', 1, 3, 2), P('P4', 1, 3, 2)]);
    assert.equal(gantt(r), 'P1 0-2, P3 2-5, P4 5-8, P2 8-13');
  });
});

describe('Preemptive Priority', () => {
  test('equal priority & equal remaining: earlier arrival keeps the CPU', () => {
    // At t=3, P4 (pri 1, rem 5) ties P1 (pri 1, rem 5) -> P1 arrived earlier, continues.
    const r = simulate('PP', SET_A);
    assert.equal(gantt(r), 'P1 0-8, P4 8-13, P2 13-17, P3 17-26');
  });

  test('higher-priority arrival preempts; preempted process keeps remaining burst', () => {
    const r = simulate('PP', [P('P1', 0, 5, 3), P('P2', 1, 3, 1), P('P3', 2, 1, 2), P('P4', 3, 2, 1)]);
    assert.equal(gantt(r), 'P1 0-1, P2 1-4, P4 4-6, P3 6-7, P1 7-11');
    assert.deepEqual(table(r), {
      P1: [0, 11, 11, 6, 0], P2: [1, 4, 3, 0, 0], P3: [6, 7, 5, 4, 4], P4: [4, 6, 3, 1, 1],
    });
    checkMetrics(r, { awt: 11 / 4, att: 22 / 4, art: 5 / 4, cpu: 100 });
  });

  test('equal priority: shorter REMAINING time preempts', () => {
    // t=2: P1 rem 4, P2 burst 1, same priority -> P2 preempts.
    const r = simulate('PP', [P('P1', 0, 6, 2), P('P2', 2, 1, 2)]);
    assert.equal(gantt(r), 'P1 0-2, P2 2-3, P1 3-7');
  });
});

describe('Round Robin', () => {
  test('quantum 2 (default)', () => {
    const r = simulate('RR', SET_A, { ...cloneDefaultConfig(), quantum: 2 });
    assert.equal(gantt(r),
      'P1 0-2, P2 2-4, P3 4-6, P1 6-8, P4 8-10, P2 10-12, P3 12-14, P1 14-16, P4 16-18, P3 18-20, P1 20-22, P4 22-23, P3 23-26');
    assert.deepEqual(table(r), {
      P1: [0, 22, 22, 14, 0], P2: [2, 12, 11, 7, 1], P3: [4, 26, 24, 15, 2], P4: [8, 23, 20, 15, 5],
    });
    checkMetrics(r, { awt: 51 / 4, att: 77 / 4, art: 2, cpu: 100 });
  });

  test('quantum 3', () => {
    const r = simulate('RR', SET_A, { ...cloneDefaultConfig(), quantum: 3 });
    assert.equal(gantt(r),
      'P1 0-3, P2 3-6, P3 6-9, P4 9-12, P1 12-15, P2 15-16, P3 16-19, P4 19-21, P1 21-23, P3 23-26');
    assert.deepEqual(table(r), {
      P1: [0, 23, 23, 15, 0], P2: [3, 16, 15, 11, 2], P3: [6, 26, 24, 15, 4], P4: [9, 21, 18, 13, 6],
    });
    checkMetrics(r, { awt: 54 / 4, att: 80 / 4, art: 3, cpu: 100 });
  });

  test('large quantum behaves like FCFS', () => {
    const rr = simulate('RR', SET_A, { ...cloneDefaultConfig(), quantum: 100 });
    assert.equal(gantt(rr), gantt(simulate('FCFS', SET_A)));
  });

  test('new arrival at the instant a quantum expires is queued before the preempted process', () => {
    const r = simulate('RR', [P('P1', 0, 4), P('P2', 2, 2)], { ...cloneDefaultConfig(), quantum: 2 });
    assert.equal(gantt(r), 'P1 0-2, P2 2-4, P1 4-6');
  });

  test('process finishing before its quantum releases the CPU immediately; idle gap handled', () => {
    const r = simulate('RR', [P('P1', 0, 1), P('P2', 4, 3)], { ...cloneDefaultConfig(), quantum: 2 });
    assert.equal(gantt(r), 'P1 0-1, IDLE 1-4, P2 4-7');
    checkMetrics(r, { awt: 0, att: 2, art: 0, cpu: (4 / 7) * 100 });
  });
});

describe('Multilevel Queue', () => {
  test('default queues (Q1 RR q=2, Q2 FCFS, Q3 SJF) with inter-queue preemption', () => {
    // Queue assignment from priority: P3 -> Q1, P2 -> Q2, P1/P4 -> Q3.
    const procs = [P('P1', 0, 4, 3), P('P2', 1, 3, 2), P('P3', 2, 3, 1), P('P4', 3, 2, 3)];
    const r = simulate('MLQ', procs, cloneDefaultConfig());
    // P1 (Q3) preempted by P2 (Q2) at 1; P2 preempted by P3 (Q1) at 2;
    // interrupted processes resume first in their own queue.
    assert.equal(gantt(r), 'P1 0-1, P2 1-2, P3 2-5, P2 5-7, P1 7-10, P4 10-12');
    assert.deepEqual(table(r), {
      P1: [0, 10, 10, 6, 0], P2: [1, 7, 6, 3, 0], P3: [2, 5, 3, 0, 0], P4: [10, 12, 9, 7, 7],
    });
    checkMetrics(r, { awt: 4, att: 7, art: 7 / 4, cpu: 100 });
  });

  test('explicit queue assignment overrides priority mapping; processes never move queues', () => {
    const cfg = cloneDefaultConfig();
    const procs = [P('P1', 0, 3, 1, 3), P('P2', 0, 2, 3, 1)];
    const r = simulate('MLQ', procs, cfg);
    assert.equal(gantt(r), 'P2 0-2, P1 2-5');
    assert.ok(r.segments.filter((s) => s.pid === 'P1').every((s) => s.level === 2));
  });

  test('queue priority field decides service order', () => {
    const cfg = cloneDefaultConfig();
    cfg.mlq.queues[0].priority = 3; // Q1 now lowest
    cfg.mlq.queues[2].priority = 1; // Q3 now highest
    const r = simulate('MLQ', [P('P1', 0, 2, 1), P('P2', 0, 2, 3)], cfg);
    assert.equal(gantt(r), 'P2 0-2, P1 2-4');
  });

  test('preemptive discipline inside a queue (SRTF in Q1)', () => {
    const cfg = cloneDefaultConfig();
    cfg.mlq.queues[0].discipline = 'SRTF';
    const r = simulate('MLQ', [P('P1', 0, 5, 1), P('P2', 1, 2, 1)], cfg);
    assert.equal(gantt(r), 'P1 0-1, P2 1-3, P1 3-7');
  });
});

describe('Multilevel Feedback Queue', () => {
  test('course Example 2 (defaults: L1 q=1, L2 q=2, L3 SJF, slice not interrupted)', () => {
    const procs = [P('P1', 10, 5), P('P2', 8, 4), P('P3', 12, 4), P('P4', 3, 3), P('P5', 15, 5)];
    const r = simulate('MLFQ', procs, cloneDefaultConfig());
    assert.equal(gantt(r),
      'IDLE 0-3, P4 3-4, P4 4-6, IDLE 6-8, P2 8-9, P2 9-11, P1 11-12, P3 12-13, P1 13-15, P5 15-16, ' +
      'P3 16-18, P5 18-20, P2 20-21, P3 21-22, P1 22-24, P5 24-26');
    assert.deepEqual(r.segments.filter((s) => s.pid).map((s) => s.level), [0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 2, 2, 2, 2]);
    // [start, ET, TT, WT, response]
    assert.deepEqual(table(r), {
      P1: [11, 24, 14, 9, 1], P2: [8, 21, 13, 9, 0], P3: [12, 22, 10, 6, 0], P4: [3, 6, 3, 0, 0], P5: [15, 26, 11, 6, 0],
    });
    close(r.metrics.cpuUtilization, (21 / 26) * 100, 'CPU utilization');
    close(r.metrics.awt, 30 / 5, 'AWT');
    close(r.metrics.att, 51 / 5, 'ATT');
  });

  test('last level can use any algorithm (Priority NP and SRTF on Example 2)', () => {
    const base = [P('P1', 10, 5, 1), P('P2', 8, 4, 3), P('P3', 12, 4, 2), P('P4', 3, 3, 1), P('P5', 15, 5, 1)];
    const c = cloneDefaultConfig();
    c.mlfq.queues[2].discipline = 'NPP';
    const r = simulate('MLFQ', base, c);
    // Same as the SJF version until t=20, then the last level orders by priority:
    // P1 (pri 1), P5 (pri 1, later arrival), P3 (pri 2), P2 (pri 3).
    assert.ok(gantt(r).endsWith('P5 18-20, P1 20-22, P5 22-24, P3 24-25, P2 25-26'), gantt(r));
    assert.deepEqual([22, 26, 25, 6, 24], ['P1', 'P2', 'P3', 'P4', 'P5'].map((p) => table(r)[p][1]));

    c.mlfq.queues[2].discipline = 'SRTF';
    const r2 = simulate('MLFQ', base, c);
    assert.ok(gantt(r2).endsWith('P2 20-21, P3 21-22, P1 22-24, P5 24-26'), gantt(r2));
  });

  test('upper levels must be Round Robin', () => {
    const c = cloneDefaultConfig();
    c.mlfq.queues[0].discipline = 'FCFS';
    assert.throws(() => simulate('MLFQ', [P('P1', 0, 2)], c), /upper levels must be Round Robin/);
  });

  // Classic configuration: RR 2 → RR 4 → FCFS.
  const classic = () => {
    const c = cloneDefaultConfig();
    c.mlfq.queues = [{ discipline: 'RR', quantum: 2 }, { discipline: 'RR', quantum: 4 }, { discipline: 'FCFS', quantum: 8 }];
    return c;
  };

  test('demotion after using the full quantum (Q1 q=2 → Q2 q=4 → Q3 FCFS)', () => {
    const r = simulate('MLFQ', [P('P1', 0, 7), P('P2', 1, 3), P('P3', 3, 1)], classic());
    assert.equal(gantt(r), 'P1 0-2, P2 2-4, P3 4-5, P1 5-9, P2 9-10, P1 10-11');
    assert.deepEqual(r.segments.map((s) => s.level), [0, 0, 0, 1, 1, 2]);
    assert.deepEqual(table(r), { P1: [0, 11, 11, 4, 0], P2: [2, 10, 9, 6, 1], P3: [4, 5, 2, 1, 1] });
    close(r.metrics.awt, 11 / 3, 'AWT');
    close(r.metrics.att, 22 / 3, 'ATT');
  });

  test('a higher-queue arrival waits for the running time slice to end', () => {
    // P2 arrives in Q1 at 3 while P1 runs its Q2 slice (2-6); P1 is not interrupted.
    const r = simulate('MLFQ', [P('P1', 0, 6), P('P2', 3, 1)], classic());
    assert.equal(gantt(r), 'P1 0-2, P1 2-6, P2 6-7');
    assert.deepEqual(r.segments.map((s) => s.level), [0, 1, 0]);
    assert.ok(r.trace.every((snap) => snap.events.every((e) => e.type !== 'preempt')));
  });
});

describe('Validation & edge cases', () => {
  test('rejects invalid inputs', () => {
    assert.throws(() => simulate('FCFS', []), /at least one/);
    assert.throws(() => simulate('FCFS', [P('P1', -1, 2)]), /negative/);
    assert.throws(() => simulate('FCFS', [P('P1', 0, 0)]), /at least 1/);
    assert.throws(() => simulate('FCFS', [P('P1', 0, 2, 0)]), /Priority/);
    assert.throws(() => simulate('FCFS', [P('P1', 0, 2), P('P1', 1, 2)]), /Duplicate/);
    assert.throws(() => simulate('FCFS', [P('P1', 0, 2.5)]), /whole number/);
    assert.throws(() => simulate('RR', [P('P1', 0, 2)], { ...cloneDefaultConfig(), quantum: 0 }), /Quantum/);
  });

  test('handles 20+ processes', () => {
    const procs = Array.from({ length: 25 }, (_, i) => P(`P${i + 1}`, i, (i % 5) + 1, (i % 4) + 1));
    for (const id of ['FCFS', 'SJF', 'SRTF', 'NPP', 'PP', 'RR', 'MLQ', 'MLFQ']) {
      const r = simulate(id, procs, cloneDefaultConfig());
      assert.equal(r.rows.length, 25, id);
      assert.ok(r.rows.every((x) => x.completion !== null), id);
    }
  });
});
