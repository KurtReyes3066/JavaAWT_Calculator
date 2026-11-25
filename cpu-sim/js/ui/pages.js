/** Static content pages: algorithm reference and About. */
import { ALGORITHMS, ALGORITHM_IDS } from '../engine/algorithms.js';
import { esc } from './gantt.js';

export function tieBreakHTML(steps) {
  return steps.map((s, i) => `${i ? '<span class="arrow" aria-hidden="true">→</span>' : ''}<span class="step">${esc(s)}</span>`).join('');
}

export function renderAlgorithmDocs(el) {
  el.innerHTML = ALGORITHM_IDS.map((id) => {
    const a = ALGORITHMS[id];
    return `
      <article class="card doc-card" id="doc-${id}">
        <h2>${esc(a.name)} <span class="badge badge-accent">${esc(a.short)}</span> <span class="badge">${esc(a.type)}</span></h2>
        <p class="muted">${esc(a.summary)}</p>
        <ol>${a.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>
        <div class="tiebreak"><span>Tie-break order:</span>${tieBreakHTML(a.tieBreak)}</div>
        <div class="doc-actions"><a class="btn btn-outline btn-sm" href="#/dashboard" data-pick="${id}">Simulate ${esc(a.short)}</a></div>
      </article>`;
  }).join('');
}

export function renderAbout(el) {
  el.innerHTML = `
    <article class="card">
      <h2>Formulas</h2>
      <div class="formula">ET (Ending Time) = time the process finishes</div>
      <div class="formula">TT = ET − Arrival Time</div>
      <div class="formula">WT = TT − Burst Time</div>
      <div class="formula">AWT = ΣWT / n &nbsp; ATT = ΣTT / n</div>
      <div class="formula">CPU Utilization = Busy time / (Last completion − 0) × 100</div>
      <p class="muted small" style="margin-top:8px">Idle periods (including before the first arrival) count toward total time but not busy time.</p>
    </article>
    <article class="card">
      <h2>Conventions</h2>
      <ul>
        <li>Times are whole time units; the simulation advances one unit at a time and skips idle gaps.</li>
        <li>Priority 1 is the highest priority (smaller number wins).</li>
        <li>PID ties compare the PID number (P2 before P10).</li>
        <li>Ending Time (ET) is when a process completes its whole burst, even if it was preempted along the way.</li>
        <li>Round Robin: a process arriving at the same instant a quantum expires joins the queue first.</li>
        <li>SRTF and Preemptive Priority preempt only when the newcomer wins under the full tie-break order.</li>
        <li>Consecutive time units of the same process (in the same queue) are drawn as one Gantt block.</li>
      </ul>
    </article>
    <article class="card">
      <h2>Multilevel queues</h2>
      <ul>
        <li><strong>MLQ:</strong> each process is permanently assigned to a queue: by default Queue = Priority (capped at the last queue), or chosen in the Queue column. A lower queue number in "Queue priority" means it is served first.</li>
        <li>A process interrupted by a higher queue goes back to the <em>front</em> of its own queue and finishes its unused quantum when its queue runs again.</li>
        <li><strong>MLFQ:</strong> new processes enter Q1. Using a full quantum demotes a process one level. A running time slice is never interrupted: a process arriving in a higher queue waits until the slice ends.</li>
      </ul>
    </article>
    <article class="card">
      <h2>Verification</h2>
      <ul>
        <li>The scheduling engine (<code>js/engine</code>) is independent of the UI and covered by automated tests (<code>npm test</code>).</li>
        <li>Tests include hand-verified schedules for every algorithm plus property checks on 300 random workloads (work-conserving CPU, exact burst execution, tie-break rules, and an independent Round Robin reference).</li>
        <li>History is stored in MySQL through <code>api/history.php</code>. If it is unavailable, it is stored in this browser instead.</li>
      </ul>
    </article>`;
}
