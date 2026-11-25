/**
 * Background music and sound effects.
 *
 * Music: the tracks in TRACKS play in random order (never the same track twice in a row)
 * from the music/ folder. The music files are NOT part of this project: copy your own
 * files there with the names below (see music/README.md). Missing tracks are skipped.
 *
 * Sound effects (pickaxe hits, block break, chest, footsteps, pick up / place) are
 * synthesised with the Web Audio API, so no sound files are needed for them.
 *
 * Browsers only allow audio after the user interacts with the page, so the music
 * starts on the first click or key press. Both switches are remembered in this browser.
 */
const TRACKS = [
  { title: 'Sweden', artist: 'C418', files: ['music/sweden.mp3', 'music/sweden.ogg'] },
  { title: 'Mice on Venus', artist: 'C418', files: ['music/mice-on-venus.mp3', 'music/mice-on-venus.ogg'] },
  { title: 'Wet Hands', artist: 'C418', files: ['music/wet-hands.mp3', 'music/wet-hands.ogg'] },
];
const MUSIC_VOLUME = 0.4;
const SFX_VOLUME = 0.55;
const KEY = 'cpu-sim-audio';

const settings = (() => {
  try { return { music: true, sfx: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { music: true, sfx: true }; }
})();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage blocked */ } };

let notify = () => {};
let changed = () => {};
let player = null;
let current = -1;
let unlocked = false;
let warnedMissing = false;
const missing = new Set();

/* ------------------------------------------------------------------ music */
function available() {
  return TRACKS.map((_, i) => i).filter((i) => !missing.has(i));
}

function playNext() {
  if (!settings.music || !unlocked) return;
  const list = available();
  if (!list.length) {
    current = -1;
    changed();
    if (!warnedMissing) {
      warnedMissing = true;
      notify('No music files found. Put sweden.mp3, mice-on-venus.mp3 and wet-hands.mp3 in the music folder.', 'warn');
    }
    return;
  }
  const choices = list.length > 1 ? list.filter((i) => i !== current) : list;
  current = choices[Math.floor(Math.random() * choices.length)];
  load(current, 0);
}

/** Tries each file of a track in turn; a track with no playable file is marked missing. */
function load(i, fileIndex) {
  const track = TRACKS[i];
  if (fileIndex >= track.files.length) { missing.add(i); playNext(); return; }
  if (!player) {
    player = new Audio();
    player.preload = 'auto';
    player.addEventListener('ended', playNext);
  }
  player.onerror = () => load(i, fileIndex + 1);
  player.oncanplay = () => {
    player.oncanplay = null;
    changed();
    notify(`Now playing: ${track.title} by ${track.artist}`);
  };
  player.volume = MUSIC_VOLUME;
  player.src = track.files[fileIndex];
  player.play().catch(() => { /* blocked until the next user gesture */ });
}

function startMusic() {
  if (!settings.music) return;
  if (player && current >= 0 && player.src) { player.play().catch(() => {}); return; }
  playNext();
}

/* ---------------------------------------------------------- sound effects */
let ctx = null;
let master = null;
let noiseBuf = null;
const lastPlayed = {};

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = SFX_VOLUME;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function envelope(g, t, peak, dur, attack = 0.003) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

/** Filtered noise burst (crunches, thuds, scrapes). */
function noise(t, { dur, freq, q = 1, type = 'bandpass', gain = 0.5, delay = 0 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  envelope(g, t + delay, gain, dur);
  src.connect(f).connect(g).connect(master);
  src.start(t + delay, Math.random() * 0.5, dur + 0.05);
}

/** Pitched blip with a glide (ticks, pops, creaks). */
function tone(t, { from, to = from, dur, type = 'square', gain = 0.15, delay = 0, lowpass = 0 }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, t + delay);
  o.frequency.exponentialRampToValueAtTime(to, t + delay + dur);
  const g = ctx.createGain();
  envelope(g, t + delay, gain, dur);
  let node = o.connect(g);
  if (lowpass) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lowpass;
    node = node.connect(f);
  }
  node.connect(master);
  o.start(t + delay);
  o.stop(t + delay + dur + 0.05);
}

const jitter = (x, k = 0.12) => x * (1 - k + Math.random() * 2 * k);

const SOUNDS = {
  // Pickaxe on a block: a bright stony click plus a short knock.
  hit: (t) => {
    noise(t, { dur: 0.07, freq: jitter(2300), q: 1.4, gain: 0.55 });
    tone(t, { from: jitter(190), to: 90, dur: 0.06, gain: 0.12 });
  },
  // The block breaks: a longer crunch with a low rumble.
  brk: (t) => {
    noise(t, { dur: 0.26, freq: 950, q: 0.8, gain: 0.6 });
    noise(t, { dur: 0.2, freq: 380, type: 'lowpass', gain: 0.5, delay: 0.02 });
    noise(t, { dur: 0.12, freq: 2600, q: 1.2, gain: 0.25, delay: 0.06 });
  },
  // Footstep on grass: a soft, dull crunch.
  step: (t) => {
    noise(t, { dur: 0.06, freq: jitter(900, 0.25), q: 0.7, gain: 0.32 });
    noise(t, { dur: 0.04, freq: 260, type: 'lowpass', gain: 0.25 });
  },
  // Chest lid opening: a wooden creak and a knock.
  open: (t) => {
    tone(t, { from: 120, to: 230, dur: 0.3, type: 'sawtooth', gain: 0.09, lowpass: 900 });
    noise(t, { dur: 0.08, freq: 320, type: 'lowpass', gain: 0.45, delay: 0.02 });
  },
  // Chest lid closing: a deeper thunk.
  close: (t) => {
    noise(t, { dur: 0.13, freq: 260, type: 'lowpass', gain: 0.65 });
    tone(t, { from: 95, to: 55, dur: 0.12, type: 'sine', gain: 0.35 });
  },
  // Picking a block up and putting it down.
  pick: (t) => tone(t, { from: 480, to: 920, dur: 0.07, type: 'sine', gain: 0.18 }),
  place: (t) => {
    noise(t, { dur: 0.07, freq: 600, type: 'lowpass', gain: 0.45 });
    tone(t, { from: 230, to: 140, dur: 0.07, type: 'sine', gain: 0.2 });
  },
  // Every process finished: a short rising arpeggio.
  done: (t) => [523, 659, 784, 1047].forEach((f, i) => tone(t, { from: f, dur: 0.16, type: 'square', gain: 0.07, delay: i * 0.09, lowpass: 2500 })),
};

/** Plays a named effect. Repeats of the same effect closer than 45 ms are dropped (fast playback). */
export function sfx(name) {
  if (!settings.sfx || !SOUNDS[name]) return;
  if (!unlocked) return;
  const now = performance.now();
  if (now - (lastPlayed[name] || 0) < 45) return;
  lastPlayed[name] = now;
  if (!ac()) return;
  SOUNDS[name](ctx.currentTime + 0.005);
}

/* ------------------------------------------------------------------ API */
export const audio = {
  init({ notify: n, onChange } = {}) {
    if (n) notify = n;
    if (onChange) changed = onChange;
    const unlock = () => {
      if (unlocked) return;
      unlocked = true;
      if (settings.sfx) ac();
      startMusic();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  },
  musicOn: () => settings.music,
  sfxOn: () => settings.sfx,
  nowPlaying: () => (current >= 0 && settings.music ? `${TRACKS[current].title} by ${TRACKS[current].artist}` : ''),
  toggleMusic() {
    settings.music = !settings.music;
    save();
    unlocked = true;
    if (settings.music) startMusic(); else player?.pause();
    changed();
  },
  toggleSfx() {
    settings.sfx = !settings.sfx;
    save();
    unlocked = true;
    if (settings.sfx) { ac(); sfx('pick'); }
    changed();
  },
};
