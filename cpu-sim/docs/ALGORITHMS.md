# Scheduling algorithms: exact rules used by the simulator

All times are whole time units. **Priority 1 is the highest priority** (smaller number wins).
PID comparisons use the PID number, so P2 comes before P10.

## How the engine works

`js/engine/core.js` is a single discrete-time engine. Every algorithm is one or more ready
queues ("levels"), each with a *discipline*:

| Discipline | Dispatches | Preempts within its queue? | Tie-break order |
|---|---|---|---|
| FCFS | head of FIFO queue | no | queue order (= Arrival Time, PID) |
| RR | head of FIFO queue, for at most one quantum | quantum expiry only | queue order |
| SJF | min by key | no | Burst Time → Arrival Time → PID |
| SRTF | min by key | yes, if strictly better | Remaining Time → Arrival Time → PID |
| NPP | min by key | no | Priority → Burst Time → Arrival Time → PID |
| PP | min by key | yes, if strictly better | Priority → Remaining Time → Arrival Time → PID |

At each time `t`, the engine does these steps in order:

1. Admit processes with Arrival Time `t`, in Arrival Time then PID order.
2. Re-queue the process whose quantum expired at `t`. Because this comes after step 1, a
   **new arrival at the same instant joins the queue before the preempted process**.
3. Check preemption. In MLQ, a non-empty higher queue preempts a lower-queue process (MLFQ never
   does this). A preemptive discipline (SRTF/PP) preempts when a ready process **strictly** wins the full comparison.
4. If the CPU is free, dispatch from the highest non-empty queue.
5. Execute one unit. When nothing is ready, jump straight to the next arrival and record an IDLE block.

A safety bound (last arrival + total burst + 1) makes infinite loops impossible.

## The eight algorithms

### FCFS: First Come First Served (non-preemptive)
Runs processes in Arrival Time order, with ties broken by PID. A running process is never interrupted.

### SJF: Shortest Job First (non-preemptive)
When the CPU becomes free, it picks the shortest Burst Time among processes that have
**already arrived**. Ties go to the earlier Arrival Time, then the lower PID. The process runs to completion.

### SRTF: Shortest Remaining Time First (preemptive)
At every time unit, the arrived process with the least remaining time runs. A newcomer
preempts only if its burst is **strictly** shorter than the running process's remaining
time, or equal with an earlier Arrival Time / lower PID. A preempted process keeps its remaining time.

### NPP: Non-preemptive Priority
When the CPU becomes free, it picks by Priority, then Burst Time, then Arrival Time, then PID. The process runs to completion.

### PP: Preemptive Priority
The arrived process that wins Priority → Remaining Time → Arrival Time → PID always holds
the CPU. If the running process still wins, it continues. A preempted process keeps its
remaining time and returns to the ready queue.

### RR: Round Robin (preemptive, default quantum 2)
The ready queue is FIFO. A process runs for at most one quantum. If it finishes early, the
CPU moves on immediately. Otherwise it goes to the back of the queue, behind any process
that arrived at or before that instant.

### MLQ: Multilevel Queue
- Each queue has its own discipline (any of the six above) and a fixed **queue priority**
  (1 = served first). The defaults are Q1 Round Robin (q=2), Q2 FCFS, Q3 SJF.
- Each process is **permanently** assigned to one queue. Auto assignment maps Queue = Priority,
  capped at the last queue. The Queue column can override it.
- A higher queue is always served first, and an arrival in a higher queue preempts a lower-queue process.
- An interrupted process returns to the **front** of its own queue and resumes first, with its
  unused quantum, when that queue runs again. This keeps FCFS, SJF and NPP queues non-preemptive inside the queue.

### MLFQ: Multilevel Feedback Queue
The defaults follow the course example: Level 1 has quantum 1, Level 2 has quantum 2, and Level 3 is SJF.
You can add or remove levels (2–5). Upper levels are always Round Robin, because a process only drops to the next level when it uses its full quantum. The **last level** can use any of the six algorithms: Round Robin, FCFS, SJF, SRTF, Non-preemptive Priority or Preemptive Priority.
- New processes enter Level 1.
- When a process uses its **full quantum**, it drops one level. It stays in the last level if it is already there. Its remaining burst is always kept.
- The CPU always takes the next process from the highest non-empty level.
- **A running time slice is never interrupted.** A process that arrives in a higher level waits until the current slice ends or the running process finishes. For example, P1 arrives at 10 while P2 runs its Level 2 slice from 9 to 11, so P1 starts at 11.
- The SJF last level runs each process to completion, picking the shortest **remaining** time first.
- Processes never move **up** a level (there is no aging or priority boost), matching the course example.

The course's Example 2 is an automated test. It checks P1 (10, 5), P2 (8, 4), P3 (12, 4), P4 (3, 3) and P5 (15, 5), and expects ET = 24, 21, 22, 6, 26 and CPU utilization = 21/26 = 80.77%.

## Metrics

| Metric | Formula |
|---|---|
| Ending Time (ET) | time the process finishes |
| Turnaround Time (TT) | ET − Arrival |
| Waiting Time (WT) | TT − Burst |
| AWT / ATT | sum ÷ number of processes |
| CPU Utilization | busy time ÷ (last completion − 0) × 100 |

Idle time before the first arrival counts toward total time. Only real execution counts as busy time.
