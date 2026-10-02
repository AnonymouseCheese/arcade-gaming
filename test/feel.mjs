/* ------------------------------------------------------------------ *
 *  Why does the machine shed coins when nobody is playing?
 *
 *      node test/feel.mjs
 *
 *  First answer, and it was wrong: friction and gravity. Sweeping them
 *  changed idle drain by almost nothing, because the pusher is kinematic
 *  - it shoves through any amount of friction with unlimited force.
 *
 *  What actually governs the drain is how far the carpet is transported
 *  per cycle, and whether the pile still reaches the lip once it settles.
 *  A real machine stops shedding because its pile ends short of the lip;
 *  ours kept shedding because it was seeded over its natural capacity.
 * ------------------------------------------------------------------ */

import * as RAPIER from '../vendor/rapier.es.js';
import { CFG } from '../config.js?v=4';
import * as P from '../physics.js?v=4';
await RAPIER.init();

const prng = s => () => {
  s = (s + 0x6D2B79F5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const HZ = 30;

/**
 * Geometry lives on CFG and is read when the machine is built, and by
 * pusherZ on every step - so an override has to stay in place for the whole
 * run and be put back afterwards.
 */
function probe({ seed, stroke, period, tune }) {
  const saved = { stroke: CFG.stroke, period: CFG.period };
  if (stroke !== undefined) CFG.stroke = stroke;
  if (period !== undefined) CFG.period = period;

  try {
    const m = P.createMachine(RAPIER, { hz: HZ, maxCoins: 800, tune });
    m.seed(seed, null, prng(31337));

    for (let i = 0; i < HZ * 25; i++) m.step();          // settle off the grid
    const settled = m.active.length;

    let w = m.won + m.lost;
    for (let i = 0; i < HZ * 30; i++) m.step();
    const idle1 = m.won + m.lost - w;
    w = m.won + m.lost;
    for (let i = 0; i < HZ * 30; i++) m.step();
    const idle2 = m.won + m.lost - w;
    const held = m.active.length;

    const rnd = prng(99);
    const w0 = m.won;
    let dropped = 0;
    for (let i = 0; i < HZ * 90; i++) {
      if (i % Math.round(HZ * 1.2) === 0 && m.drop((rnd() * 2 - 1) * CFG.aimLimit)) dropped++;
      m.step();
    }
    const payout = (m.won - w0) / dropped * 100;

    m.world.free();
    return { settled, idle1, idle2, held, payout };
  } finally {
    CFG.stroke = saved.stroke;
    CFG.period = saved.period;
  }
}

const row = (label, r) => console.log(
  `  ${label.padEnd(30)} ${String(r.settled).padStart(5)}  ` +
  `${String(r.idle1).padStart(7)}  ${String(r.idle2).padStart(7)}  ` +
  `${String(r.held).padStart(5)}  ${r.payout.toFixed(0).padStart(5)}%`);

console.log('30 Hz. Idle = coins leaving the field on their own, over two');
console.log('consecutive 30-second windows with nobody playing.\n');
console.log('  setting                        settled  idle 30  idle 60   held  payout');

console.log('\n  -- how many coins we start with --');
for (const n of [450, 380, 320, 260]) row(`seeded ${n}`, probe({ seed: n }));

console.log('\n  -- how far the pusher travels per cycle --');
for (const st of [5.5, 4.0, 3.0, 2.0]) {
  row(`stroke ${st.toFixed(1)}, seeded 320`, probe({ seed: 320, stroke: st }));
}

console.log('\n  -- how fast it cycles --');
for (const pe of [3.2, 4.5, 6.0]) {
  row(`period ${pe.toFixed(1)}s, stroke 3.0`, probe({ seed: 320, stroke: 3.0, period: pe }));
}

console.log('\nWanted: idle 60 near zero, payout still 15-35%.');
