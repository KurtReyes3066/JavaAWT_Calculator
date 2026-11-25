/**
 * Per-process results and aggregate performance metrics.
 * Pure functions, no DOM.
 *
 *   TT  = Completion Time − Arrival Time
 *   WT  = TT − Burst Time
 *   ET  = First Start Time − Arrival Time   (Response Time)
 *   CPU Utilization = busy time / (last completion − 0) × 100
 */

export function computeRows(processes) {
  return processes.map((p) => {
    const tat = p.completion - p.arrival;
    return {
      pid: p.pid,
      arrival: p.arrival,
      burst: p.burst,
      priority: p.priority,
      queue: p.queue,
      start: p.start,
      completion: p.completion,
      tat,
      wt: tat - p.burst,
      rt: p.start - p.arrival,
    };
  });
}

export function computeMetrics(rows, segments) {
  const n = rows.length;
  const busy = segments.filter((s) => s.pid !== null).reduce((s, x) => s + (x.end - x.start), 0);
  const makespan = segments.length ? segments[segments.length - 1].end : 0;
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const avg = (k) => (n ? sum(k) / n : 0);
  const switches = segments.filter((s) => s.pid !== null).length;
  return {
    count: n,
    totalWT: sum('wt'),
    totalTAT: sum('tat'),
    totalRT: sum('rt'),
    awt: avg('wt'),
    att: avg('tat'),
    art: avg('rt'),
    busy,
    idle: makespan - busy,
    makespan,
    cpuUtilization: makespan > 0 ? (busy / makespan) * 100 : 0,
    throughput: makespan > 0 ? n / makespan : 0,
    dispatches: switches,
  };
}
