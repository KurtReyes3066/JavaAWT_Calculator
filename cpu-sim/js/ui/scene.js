/**
 * "Steve runs the CPU": an animated, blocky side-view scene that acts out the
 * simulation one time unit at a time.
 *
 *   [chest: finished] [workbench: the CPU] [ready-queue lane(s): front … back] ← arrivals slide in
 *
 * Every process is a coloured block. When a process is dispatched, Steve walks
 * to its block in the ready queue, carries it to the workbench and mines it:
 * one time unit per step, with the crack and the durability bar showing the
 * work done. A process whose quantum expires (or that is preempted) is carried
 * back to its queue; a finished one breaks and drops into the chest.
 *
 * The scene is a pure function of (trace frame, progress 0..1 of the step into
 * that frame). It therefore always agrees with the Gantt chart and the live
 * state panel, at any playback speed, after scrubbing, and when stepping back.
 * All drawing is procedural: there are no image files.
 */
import { textOn } from './gantt.js';
import { rng, shade, PAL } from './textures.js';

/* ------------------------------------------------------------ geometry (art pixels) */
const B = 12;            // block size
const PITCH = 14;        // distance between queue slots
const GROUND = 18;       // grass + dirt below the walking line
const LANE_GAP = 22;     // vertical distance between queue shelves (multilevel algorithms)
const MIN_SKY = 56;
const CHEST_X = 6;
const TABLE_X = 28;      // the workbench (CPU)
const TABLE_W = 16;
const WORK_X = TABLE_X + TABLE_W + 7; // Steve's centre while he mines (facing left)

const COL = {
  skin: '#c58c6b', skinD: '#a86f52', beard: '#7a4a35', hair: '#3d2817', hairD: '#2c1b0f',
  shirt: '#2aa5a5', shirtD: '#1d8080', pants: '#3b3699', pantsD: '#2b2773',
  shoe: '#4b4b4b', shoeD: '#363636', eye: '#ffffff', iris: '#5a3f9e', mouth: '#8f4e3f',
  stick: '#7a5530', stickD: '#4e3519', pick: '#5fe6d6', pickD: '#2aa79a',
};

// Steve's head in profile, facing right (column 0 = back of the head).
const HEAD = ['HHHHHHHH', 'HHHHHHHH', 'HHHHHHhs', 'HHHsssss', 'HHskssWI', 'HHssssss', 'Hsssssmm', 'Hssssbbb'];
const HEAD_COL = { H: COL.hair, h: COL.hairD, s: COL.skin, k: COL.skinD, W: COL.eye, I: COL.iris, m: COL.mouth, b: COL.beard };

/* ------------------------------------------------------------ helpers */
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const easeOut = (t) => { t = clamp01(t); return 1 - (1 - t) * (1 - t); };
const easeIn = (t) => { t = clamp01(t); return t * t; };
const hash = (s) => [...String(s)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

function posMap(queues) {
  const m = new Map();
  queues.forEach((q, level) => q.forEach((pid, index) => m.set(pid, { level, index })));
  return m;
}

/** Crack pixels for a 12×12 block, in the order they appear (deterministic branching walk). */
const CRACK = (() => {
  const r = rng(99);
  const seen = new Set();
  const out = [];
  const heads = [[5, 5], [6, 6]];
  while (out.length < 46 && heads.length) {
    const i = Math.floor(r() * heads.length);
    const [x, y] = heads[i];
    const k = `${x},${y}`;
    if (!seen.has(k)) { seen.add(k); out.push([x, y]); }
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    const [dx, dy] = dirs[Math.floor(r() * dirs.length)];
    const nx = x + dx; const ny = y + dy;
    if (nx >= 1 && nx <= 10 && ny >= 1 && ny <= 10) heads[i] = [nx, ny]; else heads.splice(i, 1);
    if (r() < 0.12 && heads.length < 5) heads.push([x, y]);
  }
  return out;
})();

/** A 12×12 transparent speckle used to give flat block colours a wool-like texture. */
function makeSpeckle() {
  const c = document.createElement('canvas');
  c.width = B; c.height = B;
  const g = c.getContext('2d');
  const r = rng(5);
  for (let y = 0; y < B; y++) {
    for (let x = 0; x < B; x++) {
      const a = 0.04 + r() * 0.12;
      g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

/* ------------------------------------------------------------ scene */
export function createScene() {
  const root = document.createElement('figure');
  root.className = 'scene';
  root.innerHTML = `
    <div class="scene-frame"><canvas class="scene-canvas" role="img"></canvas></div>
    <figcaption class="scene-caption"><span class="scene-text"></span></figcaption>`;
  const canvas = root.querySelector('canvas');
  const caption = root.querySelector('.scene-text');
  const g = canvas.getContext('2d');
  const art = document.createElement('canvas');
  const ag = art.getContext('2d');
  const skyLayer = document.createElement('canvas');
  const worldLayer = document.createElement('canvas');
  let speckle = null;

  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const night = () => document.documentElement.dataset.theme !== 'light';

  let run = null;        // { result, processes, colors }
  let trace = [];
  let levels = [{ label: 'Q1' }];
  let bursts = new Map();
  let doneAt = [];       // completed processes up to each frame
  let frame = -1;
  let plan = null;
  let anim = null;       // { start, dur }
  let geo = null;
  let layersKey = '';
  let raf = 0;
  let lastAmbient = 0;
  let onScreen = true;

  /* -------------------------------------------------------- layout */
  function layout() {
    const cssW = Math.max(240, Math.round(root.clientWidth || canvas.clientWidth || 640));
    const S = cssW >= 900 ? 3 : 2;
    const L = levels.length;
    const W = Math.ceil(cssW / S);
    const gy = Math.max(MIN_SKY, (L - 1) * LANE_GAP + 54);
    const H = gy + GROUND;
    const multi = L > 1;
    const laneX0 = WORK_X + 15 + (multi ? 12 : 0);
    const cap = Math.max(2, Math.floor((W - 4 - laneX0 + 2) / PITCH));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    geo = { cssW, S, W, H, gy, L, multi, laneX0, cap, dpr };
    const pw = Math.round(cssW * dpr);
    const ph = Math.round(H * S * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    canvas.style.height = `${H * S}px`;
    if (art.width !== W || art.height !== H) { art.width = W; art.height = H; }
    const key = `${W}x${H}:${L}:${night() ? 'n' : 'd'}`;
    if (key !== layersKey) { layersKey = key; paintLayers(); }
  }

  const laneTop = (k) => geo.gy - (geo.L - 1 - k) * LANE_GAP - B;
  const slot = (pos) => ({ x: geo.laneX0 + Math.min(pos.index, geo.cap - 1) * PITCH, y: laneTop(pos.level) });
  const tablePos = () => ({ x: TABLE_X + 2, y: geo.gy - 16 - B });
  /** Where a carried block sits for Steve at x facing dir. */
  const hand = (x, dir) => ({ x: dir > 0 ? Math.round(x) + 2 : Math.round(x) - 2 - B, y: geo.gy - 27 });

  /* -------------------------------------------------------- static layers */
  function paintLayers() {
    const { W, H, gy, L } = geo;
    const dark = night();
    skyLayer.width = W; skyLayer.height = H;
    worldLayer.width = W; worldLayer.height = H;
    const s = skyLayer.getContext('2d');
    s.fillStyle = dark ? '#0d1230' : '#86b3ff';
    s.fillRect(0, 0, W, H);
    const r = rng(17);
    if (dark) {
      for (let i = 0; i < (W * gy) / 70; i++) {
        s.fillStyle = `rgba(255,255,255,${0.35 + r() * 0.6})`;
        s.fillRect(Math.floor(r() * W), Math.floor(r() * (gy - 14)), 1, 1);
      }
      // Moon: a square with darker craters.
      s.fillStyle = '#e8e8dc'; s.fillRect(W - 30, 7, 10, 10);
      s.fillStyle = '#c4c4b6'; s.fillRect(W - 28, 9, 3, 2); s.fillRect(W - 24, 13, 2, 2);
    } else {
      s.fillStyle = 'rgba(255,246,170,0.35)'; s.fillRect(W - 34, 3, 18, 18);
      s.fillStyle = '#fff3a6'; s.fillRect(W - 31, 6, 12, 12);
    }
    // Distant blocky hills.
    const hr = rng(61);
    let hh = 6;
    s.fillStyle = dark ? '#182044' : '#6d9be6';
    for (let x = 0; x < W; x += 4) {
      if (hr() < 0.45) hh = Math.max(3, Math.min(15, hh + (hr() < 0.5 ? -2 : 2)));
      s.fillRect(x, gy - hh, 4, hh);
    }

    const w = worldLayer.getContext('2d');
    w.clearRect(0, 0, W, H);
    // Ground: a jagged grass top over speckled dirt.
    const img = w.createImageData(W, H - gy);
    const gr = rng(29);
    const k = dark ? 0.55 : 1;
    for (let x = 0; x < W; x++) {
      const depth = 2 + Math.floor(gr() * 3);
      for (let y = 0; y < H - gy; y++) {
        const c = shade((y < depth ? PAL.grass : PAL.dirt)[Math.floor(gr() * 5)], k * (0.92 + gr() * 0.16));
        const i = (y * W + x) * 4;
        img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
      }
    }
    w.putImageData(img, 0, gy);

    // Shelves for the upper queues of multilevel algorithms, on fence posts.
    for (let lv = 0; lv < L - 1; lv++) {
      const y = laneTop(lv) + B;
      const x0 = geo.laneX0 - 3;
      const x1 = geo.laneX0 + geo.cap * PITCH;
      w.fillStyle = '#6b5230';
      w.fillRect(x0, y, 2, gy - y);
      w.fillRect(x1 - 2, y, 2, gy - y);
      w.fillStyle = '#b08f59'; w.fillRect(x0, y, x1 - x0, 2);
      w.fillStyle = '#7a5f37'; w.fillRect(x0, y + 2, x1 - x0, 1);
    }
    paintWorkbench(w, TABLE_X, gy - 16, dark);
  }

  /** The CPU: a sturdy wooden workbench with a grid top. */
  function paintWorkbench(w, x, y, dark) {
    const k = dark ? 0.8 : 1;
    const c = (h) => rgb(shade(h, k));
    w.fillStyle = c('#8a6236'); w.fillRect(x, y, TABLE_W, 16);
    w.fillStyle = c('#b48a52'); w.fillRect(x, y, TABLE_W, 3);
    w.fillStyle = c('#7a5a2f');
    w.fillRect(x + 5, y, 1, 3); w.fillRect(x + 10, y, 1, 3);
    w.fillStyle = c('#4f3519'); w.fillRect(x, y + 3, TABLE_W, 1);
    w.fillStyle = c('#6e4c27');
    for (let i = 3; i < TABLE_W; i += 4) w.fillRect(x + i, y + 4, 1, 12);
    w.fillStyle = c('#9a9a9a'); w.fillRect(x + 2, y + 6, 4, 1); w.fillRect(x + 3, y + 7, 1, 4);
    w.fillStyle = c('#c8c8c8'); w.fillRect(x + 10, y + 6, 3, 2);
    w.fillStyle = c('#7a5530'); w.fillRect(x + 11, y + 8, 1, 4);
    w.fillStyle = c('#3a2610'); w.fillRect(x, y + 15, TABLE_W, 1);
  }

  /* -------------------------------------------------------- planning */
  const progress = (snap, pid) => {
    const b = bursts.get(pid) || 1;
    return (b - snap.remaining[pid]) / b;
  };

  function virtualStart() {
    return {
      time: 0, running: null, runningLevel: null,
      queues: levels.map(() => []),
      remaining: Object.fromEntries([...bursts].map(([pid, b]) => [pid, b])),
      events: [],
    };
  }

  /**
   * Builds the step from snapshot `prev` to snapshot `cur`: what Steve does and
   * where every block is, as a function of p in [0, 1].
   */
  function makePlan(prev, cur, durMs, final) {
    const R0 = prev.running;
    const R1 = cur.running;
    const cont = !!R0 && R0 === R1;
    const done0 = !!R0 && !cont && cur.events.some((e) => e.type === 'complete' && e.pid === R0);
    const back0 = !!R0 && !cont && !done0;
    const P0 = posMap(prev.queues);
    const P2 = posMap(cur.queues);
    // Intermediate layout: the new queues, with the dispatched block still where it waited.
    const inter = cur.queues.map((q) => q.slice());
    if (R1 && !cont) {
      const pp = P0.get(R1);
      if (pp) inter[pp.level].splice(Math.min(pp.index, inter[pp.level].length), 0, R1);
      else inter[Math.max(0, cur.runningLevel ?? 0)].push(R1);
    }
    const P1 = posMap(inter);
    const a = cont ? 1 : R0 ? 0.36 : 0.1;
    const steve = [];
    const tracks = new Map();
    const add = (pid, seg) => { if (!tracks.has(pid)) tracks.set(pid, []); tracks.get(pid).push(seg); };
    const p = { R0, R1, cont, done0, back0, a, prev, cur, steve, tracks, final, layouts: [prev.queues, inter, cur.queues] };
    p.swings = Math.max(1, Math.round((a * durMs) / 420));

    // 1. Mine the running block for one time unit, or wait while the CPU is idle.
    steve.push({ t0: 0, t1: a, type: R0 ? 'mine' : 'idle', x0: WORK_X, x1: WORK_X, dir: R0 ? -1 : 1 });
    if (R0) p.crack = { pid: R0, f0: progress(prev, R0), f1: progress(cur, R0) };
    if (done0) {
      p.brk = { pid: R0, t0: a, t1: Math.min(1, a + 0.22) };
      p.item = { pid: R0, t0: a, t1: Math.min(1, a + 0.3) };
      add(R0, { t0: 0, t1: a, kind: 'table' });
      add(R0, { t0: a, t1: 1, kind: 'gone' });
    } else if (cont) {
      add(R0, { t0: 0, t1: 1, kind: 'table' });
    }

    // 2. Arrivals slide in from the right; waiting blocks make room.
    const arriveT0 = cont ? 0.3 : a;
    for (const [pid, pos] of P1) {
      const to = slot(pos);
      if (pid === R0) continue;
      if (!P0.has(pid)) {
        add(pid, { t0: arriveT0, t1: arriveT0 + 0.22, kind: 'move', from: { x: geo.W + 2, y: to.y }, to, ease: easeOut });
      } else {
        add(pid, { t0: a, t1: Math.min(1, a + 0.18), kind: 'move', from: slot(P0.get(pid)), to, ease: smooth });
      }
    }

    // 3. Steve's errands: return the interrupted block, fetch the next one.
    let t = a + (done0 ? 0.08 : 0);
    let x = WORK_X;
    const legs = [];
    if (back0) {
      const target = slot(P1.get(R0));
      legs.push({ type: 'lift', pid: R0 }, { type: 'walk', to: target.x - 4, carry: R0 }, { type: 'place', pid: R0, target });
    }
    if (R1 && !cont) {
      const from = slot(P1.get(R1));
      legs.push({ type: 'walk', to: from.x - 4 }, { type: 'pick', pid: R1, from }, { type: 'walk', to: WORK_X, carry: R1 }, { type: 'drop', pid: R1 });
    } else if (back0) {
      legs.push({ type: 'walk', to: WORK_X });
    }
    const fixedCount = legs.filter((l) => l.type !== 'walk').length;
    let dist = 0;
    legs.reduce((xx, l) => { if (l.type !== 'walk') return xx; dist += Math.abs(l.to - xx); return l.to; }, WORK_X);
    const avail = Math.max(0, 1 - t - 0.03);
    const fix = fixedCount ? Math.min(0.07, (avail * 0.45) / fixedCount) : 0;
    const walkT = Math.max(0, avail - fix * fixedCount);
    let walked = 0;
    let tPick = null;
    for (const l of legs) {
      if (l.type === 'walk') {
        const d = Math.abs(l.to - x);
        const dt = dist ? (walkT * d) / dist : 0;
        steve.push({ t0: t, t1: t + dt, type: 'walk', x0: x, x1: l.to, dir: l.to >= x ? 1 : -1, carry: l.carry || null, d0: walked });
        if (l.carry) add(l.carry, { t0: t, t1: t + dt, kind: 'carry' });
        walked += d; x = l.to; t += dt;
        continue;
      }
      steve.push({ t0: t, t1: t + fix, type: l.type, x0: x, x1: x });
      if (l.type === 'lift') {
        add(l.pid, { t0: 0, t1: t, kind: 'table' });
        add(l.pid, { t0: t, t1: t + fix, kind: 'move', from: tablePos(), to: hand(x, 1), ease: smooth, held: true });
      } else if (l.type === 'place') {
        add(l.pid, { t0: t, t1: t + fix, kind: 'move', from: hand(x, 1), to: l.target, ease: smooth, held: true });
      } else if (l.type === 'pick') {
        add(l.pid, { t0: t, t1: t + fix, kind: 'move', from: l.from, to: hand(x, -1), ease: smooth, held: true });
        tPick = t + fix;
      } else if (l.type === 'drop') {
        add(l.pid, { t0: t, t1: t + fix, kind: 'move', from: hand(x, -1), to: tablePos(), ease: smooth, held: true });
        add(l.pid, { t0: t + fix, t1: 1, kind: 'table' });
      }
      t += fix;
    }
    steve.push({ t0: t, t1: 1, type: R1 ? 'ready' : final ? 'celebrate' : 'idle', x0: x, x1: x, dir: R1 ? -1 : 1 });

    // 4. Once the next block is picked up, the rest of its queue moves forward.
    if (tPick !== null) {
      for (const [pid, pos] of P2) {
        const from = P1.get(pid);
        if (!from || (from.index === pos.index && from.level === pos.level)) continue;
        add(pid, { t0: tPick, t1: Math.min(1, tPick + 0.15), kind: 'move', from: slot(from), to: slot(pos), ease: smooth });
      }
    }
    // Waiting blocks that never move.
    for (const [pid, pos] of P2) if (!tracks.has(pid)) add(pid, { t0: 0, t1: 1, kind: 'stay', at: slot(pos) });
    for (const segs of tracks.values()) segs.sort((s1, s2) => s1.t0 - s2.t0);
    return p;
  }

  /* -------------------------------------------------------- evaluation */
  function swingAngle(s) {
    return s < 0.4 ? lerp(-2.3, -0.75, easeIn(s / 0.4)) : lerp(-0.75, -2.3, smooth((s - 0.4) / 0.6));
  }

  function steveAt(pl, p, clock) {
    let seg = pl.steve[0];
    for (const s of pl.steve) if (p >= s.t0) seg = s;
    const u = seg.t1 > seg.t0 ? clamp01((p - seg.t0) / (seg.t1 - seg.t0)) : 1;
    const st = { x: seg.x0, dir: seg.dir ?? 1, leg: 0, armF: -0.15, armB: 0.1, head: 0, bob: 0, tool: true, type: seg.type, swing: null };
    const breathe = Math.sin(clock * 2.2) * 0.05;
    switch (seg.type) {
      case 'mine': {
        const s = (u * pl.swings) % 1;
        st.dir = -1; st.armF = u >= 1 ? -2.3 : swingAngle(s); st.armB = -0.45; st.swing = u >= 1 ? null : s;
        break;
      }
      case 'ready': st.dir = -1; st.armF = -2.3 + breathe; st.armB = -0.45; break;
      case 'idle': st.dir = 1; st.armF = -0.15 + breathe; st.armB = 0.1 - breathe; st.head = Math.sin(clock * 1.1) * 0.06; break;
      case 'walk': {
        st.x = lerp(seg.x0, seg.x1, u);
        const ph = (seg.d0 + Math.abs(st.x - seg.x0)) / 2.4;
        st.leg = Math.sin(ph) * 0.8;
        if (seg.carry) { st.armF = -1.3; st.armB = -1.3; st.tool = false; } else { st.armF = -Math.sin(ph) * 0.7; st.armB = Math.sin(ph) * 0.7; }
        break;
      }
      case 'lift': st.dir = u < 0.5 ? -1 : 1; st.armF = -1.3; st.armB = -1.3; st.tool = false; break;
      case 'pick': st.dir = u < 0.5 ? 1 : -1; st.armF = -1.3; st.armB = -1.3; st.tool = false; break;
      case 'place': st.dir = 1; st.armF = lerp(-1.3, -0.4, u); st.armB = lerp(-1.3, -0.3, u); st.tool = false; break;
      case 'drop': st.dir = -1; st.armF = lerp(-1.3, -2.3, u); st.armB = lerp(-1.3, -0.45, u); st.tool = u > 0.6; break;
      case 'celebrate': {
        st.dir = 1;
        st.bob = Math.abs(Math.sin(clock * 6)) * 5;
        st.armF = -2.75 + Math.sin(clock * 12) * 0.25;
        st.armB = -2.75 - Math.sin(clock * 12) * 0.25;
        break;
      }
      default: break;
    }
    return st;
  }

  function blockAt(segs, p, st) {
    let seg = null;
    for (const s of segs) if (p >= s.t0) seg = s;
    if (!seg) {
      const first = segs[0];
      if (first.kind === 'move') return { ...first.from };
      seg = first;
    }
    switch (seg.kind) {
      case 'table': return { ...tablePos(), table: true };
      case 'stay': return { ...seg.at };
      case 'gone': return null;
      case 'carry': return { ...hand(st.x, st.dir), held: true };
      case 'move': {
        const u = seg.t1 > seg.t0 ? (seg.ease || smooth)((p - seg.t0) / (seg.t1 - seg.t0)) : 1;
        return { x: lerp(seg.from.x, seg.to.x, u), y: lerp(seg.from.y, seg.to.y, u), held: seg.held && u < 1 };
      }
      default: return null;
    }
  }

  /* -------------------------------------------------------- drawing */
  function drawBlock(x, y, color, crack = 0) {
    x = Math.round(x); y = Math.round(y);
    ag.fillStyle = color; ag.fillRect(x, y, B, B);
    if (speckle) ag.drawImage(speckle, x, y);
    ag.fillStyle = 'rgba(255,255,255,0.32)'; ag.fillRect(x, y, B, 1); ag.fillRect(x, y, 1, B);
    ag.fillStyle = 'rgba(0,0,0,0.34)'; ag.fillRect(x, y + B - 1, B, 1); ag.fillRect(x + B - 1, y, 1, B);
    if (crack > 0) {
      const n = Math.round(CRACK.length * Math.min(1, crack));
      ag.fillStyle = 'rgba(20,12,8,0.62)';
      for (let i = 0; i < n; i++) ag.fillRect(x + CRACK[i][0], y + CRACK[i][1], 1, 1);
    }
  }

  function limb(px, py, angle, paint) {
    ag.save(); ag.translate(px, py); ag.rotate(angle); paint(); ag.restore();
  }

  function paintArm(dark, tool) {
    ag.fillStyle = dark ? COL.shirtD : COL.shirt; ag.fillRect(-2, -2, 4, 4);
    ag.fillStyle = dark ? COL.skinD : COL.skin; ag.fillRect(-2, 2, 4, 8);
    if (!dark) { ag.fillStyle = COL.skinD; ag.fillRect(1, 2, 1, 8); }
    if (tool) {
      // A diamond pickaxe held forward from the hand.
      ag.fillStyle = COL.stick; ag.fillRect(-1, 8, 11, 2);
      ag.fillStyle = COL.stickD; ag.fillRect(-1, 9, 11, 1);
      ag.fillStyle = COL.pick; ag.fillRect(8, 3, 2, 13); ag.fillRect(7, 2, 2, 2); ag.fillRect(7, 15, 2, 2);
      ag.fillStyle = COL.pickD; ag.fillRect(9, 4, 1, 11);
    }
  }

  function paintLeg(dark) {
    ag.fillStyle = dark ? COL.pantsD : COL.pants; ag.fillRect(-2, 0, 4, 9);
    ag.fillStyle = dark ? COL.shoeD : COL.shoe; ag.fillRect(-2, 9, 4, 3);
  }

  /** Steve in two passes so a carried block can sit between his body and his front arm. */
  function drawSteve(st, pass) {
    ag.save();
    ag.translate(Math.round(st.x), Math.round(geo.gy - st.bob));
    ag.scale(st.dir, 1);
    if (pass === 'back') {
      limb(0, -22, st.armB, () => paintArm(true, false));
      limb(0, -12, -st.leg, () => paintLeg(true));
      limb(0, -12, st.leg, () => paintLeg(false));
      ag.fillStyle = COL.shirt; ag.fillRect(-2, -24, 4, 12);
      ag.fillStyle = COL.shirtD; ag.fillRect(-2, -24, 1, 12);
      ag.fillStyle = COL.pantsD; ag.fillRect(-2, -13, 4, 1);
      limb(0, -24, st.head, () => {
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) { ag.fillStyle = HEAD_COL[HEAD[r][c]]; ag.fillRect(c - 4, r - 8, 1, 1); }
        }
      });
    } else {
      limb(0, -22, st.armF, () => paintArm(false, st.tool));
    }
    ag.restore();
  }

  function drawChest(open) {
    const x = CHEST_X;
    const y = geo.gy;
    const dark = night();
    const c = (h) => rgb(shade(h, dark ? 0.85 : 1));
    ag.fillStyle = c('#3b2410'); ag.fillRect(x - 1, y - 10, 16, 10);
    ag.fillStyle = c('#9b6a2d'); ag.fillRect(x, y - 9, 14, 9);
    ag.fillStyle = c('#7a4f1d'); ag.fillRect(x, y - 2, 14, 2);
    const lift = Math.round(open * 4);
    ag.fillStyle = c('#3b2410'); ag.fillRect(x - 1, y - 15 - lift, 16, 6);
    ag.fillStyle = c('#b07a36'); ag.fillRect(x, y - 14 - lift, 14, 4);
    ag.fillStyle = c('#d8d8d8'); ag.fillRect(x + 6, y - 11 - lift, 2, 3);
    if (open > 0.05) { ag.fillStyle = '#1a0f06'; ag.fillRect(x, y - 10 - lift, 14, lift + 1); }
  }

  function drawClouds(clock) {
    const { W } = geo;
    const span = W + 60;
    const clouds = [[0.1, 8, 26], [0.55, 16, 34], [0.82, 5, 20]];
    ag.fillStyle = night() ? 'rgba(120,130,170,0.35)' : 'rgba(255,255,255,0.92)';
    clouds.forEach(([f, y, w], i) => {
      const x = ((f * span + clock * (1.2 + i * 0.4)) % span) - 40;
      ag.fillRect(Math.round(x), y, w, 4);
      ag.fillRect(Math.round(x) + 4, y - 3, w - 10, 3);
    });
  }

  /** One complete picture for the current plan at progress p. */
  function draw(p, clock) {
    if (!geo) return;
    const { W, H, gy, S, dpr } = geo;
    const labels = [];
    ag.clearRect(0, 0, W, H);
    ag.drawImage(skyLayer, 0, 0);
    drawClouds(clock);
    ag.drawImage(worldLayer, 0, 0);

    const pl = plan;
    const colors = run?.colors || new Map();
    const st = steveAt(pl, p, clock);

    // Chest with the finished count.
    let open = 0;
    if (pl.item) open = clamp01(1 - Math.abs(p - pl.item.t1) / 0.16);
    drawChest(open);
    const live = run && frame >= 0;
    if (live) {
      const finished = doneAt[frame] - (pl.item && p < pl.item.t1 ? 1 : 0);
      labels.push({ text: `${finished}/${bursts.size}`, x: CHEST_X + 7, y: gy - 22, size: 1 });
    }
    labels.push({ text: 'Done', x: CHEST_X + 7, y: gy + 9, size: 0.9 });
    labels.push({ text: 'CPU', x: TABLE_X + TABLE_W / 2, y: gy + 9, size: 0.9 });

    // Queue lane labels and overflow markers.
    const lay = p < pl.a ? pl.layouts[0] : p < 0.999 ? pl.layouts[1] : pl.layouts[2];
    levels.forEach((lv, k) => {
      if (geo.multi) labels.push({ text: lv.label, x: geo.laneX0 - 8, y: laneTop(k) + B / 2, size: 0.95 });
      const n = lay[k]?.length || 0;
      if (n > geo.cap) {
        const sx = geo.laneX0 + (geo.cap - 1) * PITCH;
        ag.fillStyle = 'rgba(0,0,0,0.45)'; ag.fillRect(sx, laneTop(k), B, B);
        labels.push({ text: `+${n - geo.cap + 1}`, x: sx + B / 2, y: laneTop(k) + B / 2, size: 0.9 });
      }
    });
    if (!geo.multi) labels.push({ text: 'Ready queue: front first', x: geo.laneX0, y: gy + 9, size: 0.9, align: 'left' });

    // Blocks: queued ones behind Steve, held ones between his body and his arm.
    const held = [];
    const hiddenSlot = (pid, pos) => {
      if (pos.held || pos.table) return false;
      const lvl = lay.findIndex((q) => q.includes(pid));
      if (lvl < 0) return false;
      const idx = lay[lvl].indexOf(pid);
      return lay[lvl].length > geo.cap && idx >= geo.cap - 1;
    };
    for (const [pid, segs] of pl.tracks) {
      const pos = blockAt(segs, p, st);
      if (!pos || pos.x > W) continue;
      const color = colors.get(pid) || '#888888';
      if (pos.held) { held.push({ pid, pos, color }); continue; }
      if (hiddenSlot(pid, pos)) continue;
      let crack = 0;
      if (pos.table) {
        let f;
        if (pl.crack && pid === pl.crack.pid) f = lerp(pl.crack.f0, pl.crack.f1, clamp01(p / pl.a));
        else f = progress(pl.cur, pid);
        crack = f;
        // Durability bar and units left above the block on the workbench.
        const left = pl.crack && pid === pl.crack.pid && p < pl.a ? pl.prev.remaining[pid] : pl.cur.remaining[pid];
        const bx = Math.round(pos.x); const by = Math.round(pos.y) - 4;
        ag.fillStyle = '#111'; ag.fillRect(bx, by, B, 2);
        const fr = Math.max(0, 1 - f);
        ag.fillStyle = `hsl(${Math.round(fr * 120)} 85% 50%)`; ag.fillRect(bx, by, Math.max(1, Math.round(B * fr)), 1);
        labels.push({ text: `${left} left`, x: bx + B / 2, y: by - 5, size: 0.9 });
      }
      drawBlock(pos.x, pos.y, color, crack);
      labels.push({ text: pid, x: pos.x + B / 2, y: pos.y + B / 2, size: 1, color: textOn(color), plain: true });
    }

    // Mining sparks when the pickaxe hits.
    if (st.swing !== null && st.swing > 0.38 && st.swing < 0.62 && pl.crack) {
      const c = colors.get(pl.crack.pid) || '#888';
      const tp = tablePos();
      const k = (st.swing - 0.38) / 0.24;
      ag.fillStyle = c;
      for (let i = 0; i < 4; i++) ag.fillRect(Math.round(tp.x + B - 1 + i * 2 * k), Math.round(tp.y + 2 + i * 2 - k * 4), 1, 1);
    }

    // A finished block breaks apart and its item hops into the chest.
    if (pl.brk && p >= pl.brk.t0 && p <= pl.brk.t1) {
      const u = (p - pl.brk.t0) / (pl.brk.t1 - pl.brk.t0);
      const c = colors.get(pl.brk.pid) || '#888';
      const r = rng(hash(pl.brk.pid));
      const tp = tablePos();
      ag.globalAlpha = 1 - u;
      for (let i = 0; i < 12; i++) {
        const vx = (r() - 0.5) * 2; const vy = -0.4 - r();
        ag.fillStyle = i % 3 ? c : rgb(shade(c.startsWith('#') ? c : '#888888', 0.6));
        ag.fillRect(Math.round(tp.x + 6 + vx * 16 * u), Math.round(tp.y + 6 + vy * 14 * u + 22 * u * u), 2, 2);
      }
      ag.globalAlpha = 1;
    }
    if (pl.item && p >= pl.item.t0 && p < pl.item.t1) {
      const u = (p - pl.item.t0) / (pl.item.t1 - pl.item.t0);
      const tp = tablePos();
      const x = lerp(tp.x + 3, CHEST_X + 4, u);
      const y = lerp(tp.y + 3, gy - 14, u) - 16 * 4 * u * (1 - u);
      const c = colors.get(pl.item.pid) || '#888';
      ag.fillStyle = '#000'; ag.fillRect(Math.round(x) - 1, Math.round(y) - 1, 8, 8);
      ag.fillStyle = c; ag.fillRect(Math.round(x), Math.round(y), 6, 6);
    }

    drawSteve(st, 'back');
    for (const h of held) {
      drawBlock(h.pos.x, h.pos.y, h.color);
      labels.push({ text: h.pid, x: h.pos.x + B / 2, y: h.pos.y + B / 2, size: 1, color: textOn(h.color), plain: true });
    }
    drawSteve(st, 'front');

    // Upscale the pixel art, then draw crisp text on top.
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(art, 0, 0, W * S * dpr, H * S * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    const base = Math.max(13, Math.round(S * 6.2));
    for (const l of labels) {
      const size = Math.round(base * l.size);
      g.font = `${size}px "VT323", ui-monospace, monospace`;
      g.textAlign = l.align || 'center';
      const lx = l.x * S; const ly = l.y * S + 1;
      if (l.plain) {
        g.fillStyle = l.color; g.fillText(l.text, lx, ly);
      } else {
        g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.strokeText(l.text, lx, ly);
        g.fillStyle = '#ffffff'; g.fillText(l.text, lx, ly);
      }
    }
    // Time readout in the corner, like a debug overlay.
    if (live) {
      g.font = `${Math.round(base * 1.15)}px "VT323", ui-monospace, monospace`;
      g.textAlign = 'left';
      // While a step is acted out, show the interval Steve is working through.
      const t0 = pl.prev?.time;
      const t1 = trace[frame].time;
      const t = anim && p < 1 && t0 !== undefined && t0 !== t1 ? `t = ${t0} → ${t1}` : `t = ${t1}`;
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.strokeText(t, 8, 14);
      g.fillStyle = '#ffffff'; g.fillText(t, 8, 14);
    }
  }

  /* -------------------------------------------------------- caption */
  function describe() {
    if (!run || frame < 0) return 'Steve is waiting for work. Add processes, choose an algorithm and press Run Simulation.';
    const snap = trace[frame];
    const multi = levels.length > 1;
    const notes = [];
    for (const e of snap.events) {
      if (e.type === 'complete') notes.push(`${e.pid} is finished and goes in the chest.`);
      else if (e.type === 'quantum') notes.push(`${e.pid} used its whole quantum, so Steve carries it to the back of the queue.`);
      else if (e.type === 'preempt') notes.push(`${e.pid} was preempted, so Steve puts it back in the queue.`);
      else if (e.type === 'demote') notes.push(`${e.pid} used its whole quantum and moves down a level.`);
    }
    let main;
    if (snap.running) {
      const left = snap.remaining[snap.running];
      const b = bursts.get(snap.running);
      main = `Steve is mining ${snap.running}${multi ? ` from ${levels[snap.runningLevel].label}` : ''} at the CPU: ${left} of ${b} unit${b === 1 ? '' : 's'} left.`;
    } else if (frame === trace.length - 1) {
      main = `All ${bursts.size} processes are finished. Press Play to watch Steve work through the schedule.`;
    } else {
      main = `The CPU is idle. Steve waits for the next arrival at t = ${trace[frame + 1].time}.`;
    }
    return `t = ${snap.time}: ${notes.length ? `${notes.join(' ')} ` : ''}${main}`;
  }

  function updateCaption() {
    const text = describe();
    caption.textContent = text;
    canvas.setAttribute('aria-label', `Animated scene. ${text}`);
  }

  /* -------------------------------------------------------- loop */
  function progressNow(now) {
    if (!anim) return 1;
    return clamp01((now - anim.start) / anim.dur);
  }

  function tick(now) {
    raf = 0;
    if (!root.isConnected || !onScreen || document.hidden) return;
    const p = progressNow(now);
    const animating = !!anim && p < 1;
    if (animating || now - lastAmbient > 50) {
      lastAmbient = now;
      draw(p, now / 1000);
    }
    if (anim && p >= 1) anim = null;
    if (!reduced()) raf = requestAnimationFrame(tick);
  }

  function kick() {
    if (!raf && !reduced()) raf = requestAnimationFrame(tick);
  }

  function redraw() {
    if (!root.isConnected) return;
    layout();
    draw(reduced() ? 1 : progressNow(performance.now()), reduced() ? 0 : performance.now() / 1000);
    kick();
  }

  function idlePlan() {
    return { steve: [{ t0: 0, t1: 1, type: 'idle', x0: WORK_X, x1: WORK_X, dir: 1 }], tracks: new Map(), a: 1, layouts: [[], [], []] };
  }

  /* -------------------------------------------------------- public API */
  function setRun(next) {
    if (next === run) return;
    run = next;
    anim = null;
    frame = -1;
    if (!run) {
      trace = []; levels = [{ label: 'Q1' }]; bursts = new Map(); doneAt = [];
      plan = idlePlan();
      updateCaption();
      redraw();
      return;
    }
    trace = run.result.trace;
    levels = run.result.levels;
    bursts = new Map(run.processes.map((p) => [p.pid, p.burst]));
    let n = 0;
    doneAt = trace.map((s) => { n += s.events.filter((e) => e.type === 'complete').length; return n; });
    plan = idlePlan();
    layersKey = '';
  }

  /**
   * Shows trace frame i. With animate, the step from frame i-1 is acted out over
   * `duration` ms (frame 0 animates the arrivals from an empty world).
   */
  function show(i, { animate = false, duration = 1000 } = {}) {
    if (!run) return;
    const from = frame;
    frame = Math.max(0, Math.min(i, trace.length - 1));
    if (!geo || layersKey === '') layout();
    const final = frame === trace.length - 1;
    const prev = frame === 0 ? virtualStart() : trace[frame - 1];
    const doAnim = animate && !reduced() && (frame === from + 1 || frame === 0);
    plan = makePlan(prev, trace[frame], doAnim ? duration : 1000, final);
    anim = doAnim ? { start: performance.now(), dur: Math.max(60, duration) } : null;
    updateCaption();
    redraw();
  }

  speckle = makeSpeckle();
  plan = idlePlan();
  updateCaption();

  new ResizeObserver(() => { if (root.isConnected) redraw(); }).observe(root);
  new MutationObserver(() => { layersKey = ''; redraw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
      if (onScreen) kick();
    }).observe(root);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => { anim = null; redraw(); });
  document.fonts?.load('20px "VT323"').then(() => redraw()).catch(() => {});

  return { el: root, setRun, show, redraw };
}
