/* ------------------------------------------------------------------ *
 *  The field's physics, on its own thread.
 *
 *  A web page normally does everything on one processor core: physics,
 *  drawing, input. Phones have several. Run here, in a worker, the physics
 *  gets a core to itself - its whole step budget, without the drawing
 *  eating into it - and the page stays smooth even when the pile is busy.
 *
 *  The page sends: { type: 'init', layout, pile, opts }, then 'insert',
 *  'tower', 'pause' / 'resume'.
 *  This sends back, after every physics step it runs:
 *    { type: 'state', t, n, slots, xf, frozen, pushers, guards, stats, paid }
 *  where xf holds x, y, z, qx, qy, qz, qw for each live coin, in the order
 *  of slots. The arrays are transferred, not copied.
 * ------------------------------------------------------------------ */

import { loadRapier } from './engine.js?v=14';
import { CFG } from './config.js?v=14';
import { machineFromLayout } from './machine.js?v=14';
import { createField, snapshot } from './field-physics.js?v=14';

let RAPIER = null, field = null, M = null, running = true, paid = 0, stepMs = 0, timer = 0;
let clockStart = 0, simAtStart = 0;

self.onmessage = async e => {
  const m = e.data;
  if (m.type === 'init') {
    RAPIER = await loadRapier();
    M = machineFromLayout(m.layout, { stroke: CFG.stroke });
    field = createField(RAPIER, M, { hz: m.opts?.hz ?? 30, shape: 'box', freeze: m.opts?.freeze ?? false, shot: m.opts?.shot, fieldCap: m.opts?.fieldCap,
                                     freezeMode: m.opts?.freezeMode });
    if (m.pile) field.seedFrom(m.pile);
    clockStart = performance.now();
    simAtStart = field.elapsed;
    self.postMessage({ type: 'ready', chute: M.chute, pushers: field.pushers.map(p => ({ boxes: p.boxes, back: p.back, bottom: p.bottom })),
                       max: field.coins.length });
    send();
    loop();
  } else if (m.type === 'insert') {
    if (field) field.insert();
  } else if (m.type === 'supply') {
    if (field) field.supply(m.n ?? 10);
  } else if (m.type === 'ball') {
    if (field) field.ball();
  } else if (m.type === 'tower') {
    if (field) field.tower(m.n ?? 15);
  } else if (m.type === 'pause') {
    running = false;
  } else if (m.type === 'resume') {
    running = true;
    clockStart = performance.now();
    simAtStart = field.elapsed;
    loop();
  }
};

/** Keep simulated time in step with the real clock: run however many steps
 *  are due (at most three - if the phone cannot keep up, time slows down
 *  rather than the steps piling up), then report. */
function loop() {
  clearTimeout(timer);
  if (!running || !field) return;
  const step = field.world.timestep;
  const due = (performance.now() - clockStart) / 1000 + simAtStart;
  let n = 0;
  const t0 = performance.now();
  while (field.elapsed + step <= due && n < 3) {
    field.step(null, (c, won, k) => { if (won) paid += k || 1; });
    n++;
  }
  if (n) {
    stepMs = stepMs * 0.85 + (performance.now() - t0) / n * 0.15;
    if (field.elapsed + step <= due) {          // fell behind: let the clock slip
      clockStart = performance.now();
      simAtStart = field.elapsed;
    }
    send();
  }
  const wait = Math.max(0, (field.elapsed + step - simAtStart) * 1000 - (performance.now() - clockStart));
  timer = setTimeout(loop, wait);
}

function send() {
  const [msg, transfer] = snapshot(field, paid, stepMs);
  self.postMessage(msg, transfer);
  paid = 0;
}
