/** Gantt chart, colour assignment and shared formatting helpers. */
import { DISCIPLINES } from '../engine/core.js';
// Block colours (lapis, grass, orange wool, amethyst, pink, diamond, gold, redstone, prismarine,
// indigo, lime, rose, light blue, magenta, emerald, honey), assigned in order.
const PALETTE = [
  '#3c6fd8', '#5fbf3a', '#e8822b', '#9b4fd0', '#e87fa6', '#3fc4c9', '#f2c531', '#c93a32',
  '#2a9d8f', '#5b5fd6', '#9fd13a', '#d9476b', '#46a8e8', '#c454c4', '#2fbf71', '#d99a2b',
];

export function colorFor(index) {
  if (index < PALETTE.length) return PALETTE[index];
  const hue = Math.round((index * 137.508) % 360);
  return `hsl(${hue} 70% 52%)`;
}

/** Readable text colour (dark or white) for a background. */
export function textOn(color) {
  let r, g, b;
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16);
    r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
  } else {
    return '#ffffff';
  }
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  // Pick whichever gives better contrast.
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#0b1220' : '#ffffff';
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');

/**
 * Renders the Gantt chart.
 * @param {object} result   simulation result
 * @param {Map} colors      pid -> colour
 * @param {number} cursor   time up to which execution is revealed
 * @param {boolean} showLevels  annotate queue level in each block
 */
export function ganttHTML(result, colors, cursor, showLevels) {
  const segs = result.segments;
  const total = segs.length ? segs[segs.length - 1].end : 0;
  if (!total) return '';
  // At least 26px per time unit so short blocks stay readable; scroll beyond that.
  const minWidth = Math.max(total * 26, 0);
  const levelName = (lvl) => (lvl === null || lvl === undefined ? '' : result.levels[lvl]?.label ?? '');

  const blocks = segs.map((s) => {
    const w = ((s.end - s.start) / total) * 100;
    const dur = s.end - s.start;
    const label = s.pid ?? 'IDLE';
    const tip = `${label}: ${s.start} → ${s.end} (${dur} unit${dur === 1 ? '' : 's'})${showLevels && s.pid ? `, ${levelName(s.level)}` : ''}`;
    if (!s.pid) {
      return `<div class="gblock idle" style="width:${w}%" title="${esc(tip)}" role="listitem" aria-label="${esc(tip)}"><span>IDLE</span></div>`;
    }
    const bg = colors.get(s.pid) || '#64748b';
    const lvl = showLevels ? `<span class="lvl">${esc(levelName(s.level))}</span>` : '';
    return `<div class="gblock" style="width:${w}%;background-color:${bg};color:${textOn(bg)}" title="${esc(tip)}" role="listitem" aria-label="${esc(tip)}"><span>${esc(s.pid)}</span>${lvl}</div>`;
  }).join('');

  const tickRow = (list) => {
    const times = [...new Set(list.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b);
    return `<div class="gantt-ticks">${times.map((t) => `<span class="tick" style="left:${(t / total) * 100}%">${t}</span>`).join('')}</div>`;
  };

  // Multilevel algorithms: one row per queue (only that queue's executions), then the combined CPU row.
  let levelRows = '';
  if (showLevels && result.levels.length > 1) {
    levelRows = result.levels.map((lvl, i) => {
      const mine = segs.filter((s) => s.pid && s.level === i);
      const desc = lvl.discipline === 'RR' ? `RR, quantum ${lvl.quantum}` : DISCIPLINES[lvl.discipline]?.label ?? lvl.discipline;
      const cells = mine.map((s) => {
        const bg = colors.get(s.pid) || '#64748b';
        const tip = `${s.pid} in ${lvl.label}: ${s.start} → ${s.end}`;
        return `<div class="gblock abs" style="left:${(s.start / total) * 100}%;width:${((s.end - s.start) / total) * 100}%;background-color:${bg};color:${textOn(bg)}" title="${esc(tip)}" role="listitem" aria-label="${esc(tip)}"><span>${esc(s.pid)}</span></div>`;
      }).join('');
      return `<div class="gantt-row-label">${esc(lvl.label)} <span>${esc(desc)}</span></div>
        <div class="gantt-bar level-bar" role="list" aria-label="${esc(lvl.label)} executions">${cells}</div>
        ${mine.length ? tickRow(mine) : '<div class="gantt-ticks"></div>'}`;
    }).join('') + '<div class="gantt-row-label">CPU <span>all levels</span></div>';
  }

  const mask = `<div class="gantt-mask" aria-hidden="true"${cursor >= total ? ' hidden' : ''} style="left:${maskLeft(cursor, total)}"></div>`;

  return `
    <div class="gantt-scroll" tabindex="0" aria-label="Gantt chart, scrollable">
      <div class="gantt" style="min-width:${minWidth}px">
        ${levelRows}
        <div class="gantt-bar" role="list" aria-label="Execution timeline from 0 to ${total}">${blocks}</div>
        ${tickRow(segs)}
        ${mask}
      </div>
    </div>`;
}

/** CSS `left` for the playback mask (the chart has 16px side padding). */
export function maskLeft(cursor, total) {
  const f = total ? Math.min(Math.max(cursor, 0), total) / total : 0;
  return `calc(16px + (100% - 32px) * ${f})`;
}

export function legendHTML(pids, colors, hasIdle) {
  const items = pids.map((pid) => `<span><i class="swatch" style="background:${colors.get(pid)}"></i>${esc(pid)}</span>`);
  if (hasIdle) items.push('<span><i class="swatch swatch-idle"></i>IDLE</span>');
  return `<div class="legend" aria-label="Legend">${items.join('')}</div>`;
}
