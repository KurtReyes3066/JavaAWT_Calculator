# DESIGN.md: CPU Scheduling Simulator

This is the design file for the project. Read it before changing anything visual.
The source of truth for values is `css/styles.css` (the `:root` tokens). This file explains how to use them.

## Product character

The simulator is a study tool for students checking scheduling homework, dressed as a blocky,
Minecraft-style world. **The numbers are still the hero.** The theme is a costume: every visual
decision must keep the Gantt chart, the results table and the metrics easy to read and to verify
against a hand calculation. The animated scene explains the schedule; it never replaces the numbers.

All art is original and procedural (drawn in code from small palettes). The project ships no game
textures, logos, sounds or fonts from any game.

## Color and materials

There are two themes: **Night** (dark, the default) and **Day** (light). The sidebar is dark in both.

| Token | Night | Day | Use |
|---|---|---|---|
| `--tx-page` / `--bg` | dim dirt texture / `#2a1e15` | dirt texture / `#5d4029` | Page background |
| `--tx-top` | dark grass-block side | grass-block side | Top bar (grass fringe on dirt) |
| sidebar | deepslate texture | deepslate texture | Sidebar |
| `--surface` | `#313135` | `#c6c6c6` | Panels (cards), with a bevel |
| `--surface-2` / `-3` | `#222225` / `#3d3d42` | `#b4b4b4` / `#a3a3a3` | Insets ("inventory slots"), then table headers |
| `--hi` / `--lo` | `#5f5f66` / `#18181b` | `#ffffff` / `#555555` | Panel bevel: light top-left, dark bottom-right |
| `--slot-hi` / `--slot-lo` | `#0f0f11` / `#4c4c53` | `#555555` / `#f2f2f2` | Inset bevel: dark top-left, light bottom-right |
| `--text` / `-muted` / `-faint` | `#f4f4f4` / `#c4c4cc` / `#a6a6af` | `#1f1f1f` / `#333333` / `#444444` | Body text, then labels, then hints |
| `--accent` | `#1f7f8f` (diamond) | `#1d5fa3` (lapis) | Selected state, primary buttons, links |
| `--success` | `#4caf2f` | `#2e7d1f` | "Completed", best value |
| `--warning` | `#e5a000` (gold) | `#a86200` | "Outdated" results |
| `--danger` | `#c2352b` (redstone) | `#a3241b` | Delete, validation errors |
| `--xp` | `#80ff20` | `#80ff20` | CPU utilization bar and best bars (always with a black outline) |

**Textures** come from `js/ui/textures.js`: dirt, grass-block side, deepslate, a transparent speckle
(`--tx-noise`, laid over buttons, chips and Gantt blocks) and the IDLE stripes. They are 16×16 pixels,
drawn at 4× with `image-rendering: pixelated`, and generated from a seeded random generator, so they are
identical on every load. Until the script runs, flat fallback colours are shown. Photos (`img`) are never pixelated.

**Process colors** (Gantt chart, swatches, chips, scene blocks) are assigned in order: lapis blue, grass green,
orange, amethyst purple, pink, diamond cyan, gold, redstone red, prismarine teal, indigo, lime, rose,
light blue, magenta, emerald, honey. After that, hues step by the golden angle. Text on a block is dark or white,
whichever has more contrast. Process colors are the only colourful element inside the data views.

**IDLE** is always a grey pixel diagonal stripe with the word IDLE, never a color.

Contrast: body text is at least 4.5:1 on its panel in both themes. Light text placed on textures
(top bar, page titles, scene labels, buttons) always has a hard 2px dark shadow or outline.

## Typography

- **DotGothic16** (pixel font) for all interface text. Bold is synthesized; use 600/700 only for titles and buttons.
  Pixelify Sans was tried and rejected: its capital C reads as O.
- **VT323** for every number a user compares: AT, BT, ET, TT, WT, times on the Gantt axis, metric values and inputs.
  VT323 has a small x-height, so every rule that uses `--mono` also sets `font-size-adjust: var(--mono-adjust)`.
- Base size 15px. Page titles 1.7rem, card titles 1.12rem, metric values 2.2rem.

## Layout

- On desktop, a 252px sidebar sits beside the content. Below 1024px it becomes an off-canvas drawer.
- The top bar always names the page and gives one specific sentence about what the page does.
- Dashboard order: Process Input with Algorithm Selection beside it, then Simulation Results
  (**scene**, playback, live state, Gantt), then Process Table with Performance Metrics beside it, then Compare.
- Square corners everywhere. Panels have a 3px black outline and a 3px bevel; insets have a 2px reversed bevel.
- Use the 4/8px spacing rhythm: 8 / 10 / 12 / 14 / 16 / 20 / 24.
- Do not lay out repeating rows of three identical cards. Group related readouts in **one** container
  with dividers, as the live-state strip (CPU, then ready queues, then events) does.

## Components

- **Buttons:** stone (default), primary (diamond/lapis), Run (grass green), danger (redstone) and disabled (dark stone,
  grey text). White text with a shadow on all of them. Hover draws a white outline; pressing shifts the button down 2px.
  Buttons are at least 40px tall, and icon buttons are 38–44px square.
- **Inputs:** black fields with a light grey border and white VT323 digits; focus turns the border white with an accent ring.
- **Algorithm tiles:** inventory slots. The selected tile is filled with the accent and framed in white, like a hotbar selection.
- **Icons:** inline SVG with 2px strokes and square caps, from `js/ui/icons.js`. **No emoji and no Unicode symbols
  (★ ✓ ⚠) used as icons.** Hide decorative icons with `aria-hidden`. Every icon-only button needs an `aria-label`.
- **Status:** a chip with an icon and a word: Not run yet, Simulation completed, Outdated: run again. Never use color alone.
- **CPU utilization:** an experience-style bar (green, segmented) with the percentage above it in outlined green digits.
- **Best value:** a green bar together with a trophy icon or the word "Best".
- **Gantt chart:** blocks look like wool blocks (speckle plus bevel). Widths are proportional and there are at least
  26px per time unit, so long runs scroll sideways. Multilevel algorithms get one row per queue plus a combined CPU row.
  The playback cursor is a gold (Night) or black (Day) line with a pixel arrow.

## The scene: Steve runs the CPU

`js/ui/scene.js` draws a side view above the playback bar:

```
[chest: finished]  [workbench: the CPU, Steve mines here]  [ready-queue lane(s): front … back]  <- arrivals slide in
```

- Each process is a block in its process colour, labelled with its PID. Multilevel algorithms get one shelf per queue
  (Q1 on top, the last queue on the ground), labelled at the left.
- On dispatch, Steve walks to the block, carries it to the workbench and mines it: one time unit per step. The crack and the
  durability bar above the block show work done; the label shows units left.
- Quantum expiry, preemption and MLFQ demotion: Steve carries the block back to its (new) queue position.
- Completion: the block breaks and its item hops into the chest; the count above the chest goes up.
- Idle CPU: Steve faces the queue and waits. End of the schedule: Steve celebrates.
- The scene is a pure function of (trace frame, progress through the step), so it always matches the Gantt chart and the
  live panel, at every speed, when scrubbing and when stepping back. Play and Step forward animate; every other control jumps.
- The caption under the scene says what is happening in words, and the canvas `aria-label` repeats it.
- One playback step lasts 1.2 s at 1× so Steve has time to walk; the speed menu changes it.

## Motion

Motion shows cause and effect: Steve's work, blocks moving between queues, the playback cursor, bar widths and toasts.
Ambient motion is limited to Steve breathing, slow clouds and the end-of-schedule celebration, and pauses when the scene
is off screen. **No scroll fade-ins, parallax or entrance animations.** Under `prefers-reduced-motion`, all motion stops
and the scene shows still frames that still change with each step.

## Content rules

- Every headline names the specific thing. Avoid generic slogans.
- Do not use fake people, testimonials, logos or placeholder data. About Us shows only members the team adds,
  with their real photos. Members without a photo get an initials avatar.
- Use the course's terminology: ET means **Ending Time**, then TT, then WT. Priority 1 is the highest.
- Screenshots in `docs/screenshots/` must be real captures of the running app, retaken whenever the UI changes.

## Removed on purpose (do not reintroduce)

- The navy flat theme with IBM Plex Sans and JetBrains Mono (replaced by the blocky theme on 2026-11-25).
- The CPU utilization ring (replaced by the experience-style bar).
- Glows, neon halos and rounded "app" corners.
- The ★ symbol in the comparison chart, now a trophy icon.
- The three separate CPU / queue / events cards, now merged into one divided strip.
