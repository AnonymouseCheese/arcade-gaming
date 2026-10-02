/* ------------------------------------------------------------------ *
 *  Deterministic benchmark - same pile every run, median of 3.
 *
 *      node test/bench.mjs
 *
 *  Use this to compare collider shapes and physics rates on a desktop.
 *  For the number that actually matters, open the app on the phone and
 *  use its Performance panel instead.
 * ------------------------------------------------------------------ */

import * as RAPIER from '../vendor/rapier.es.js';
import { CFG } from '../config.js?v=5';
import * as P from '../physics.js?v=5';
await RAPIER.init();

// seeded PRNG, so every configuration starts from an identical pile
const prng = s => () => {
  s = (s + 0x6D2B79F5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const median = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

function run({ n, hz, shape, iters = 4, reps = 3, steps = 240 }) {
  const times = [];
  for (let r = 0; r < reps; r++) {
    const m = P.createMachine(RAPIER, { hz, iterations: iters, shape, maxCoins: 800 });
    m.seed(n, null, prng(12345));
    for (let i = 0; i < 180; i++) m.step();          // settle, identically each time
    const t0 = performance.now();
    for (let i = 0; i < steps; i++) m.step();
    times.push((performance.now() - t0) / steps);
    m.world.free();
  }
  return median(times);
}

const row = (label, ms, hz) => {
  const pct = ms / (1000 / hz) * 100;
  const verdict = pct < 50 ? 'comfortable' : pct < 80 ? 'tight' : pct < 100 ? 'marginal' : 'TOO SLOW';
  console.log(`  ${label.padEnd(28)} ${ms.toFixed(2).padStart(6)} ms   ` +
              `${pct.toFixed(0).padStart(3)}% of budget   ${verdict}`);
};

for (const hz of [60, 30]) {
  console.log(`--- physics at ${hz} Hz (budget ${(1000 / hz).toFixed(1)} ms/step) ---`);
  for (const n of [300, 450, 600]) {
    for (const shape of ['cylinder', 'box']) {
      row(`${n} coins, ${shape}`, run({ n, hz, shape }), hz);
    }
  }
  console.log('');
}

console.log(`--- solver iterations, 600 box coins @ 30 Hz ---`);
for (const it of [2, 4, 8]) {
  row(`${it} iterations`, run({ n: 600, hz: 30, shape: 'box', iters: it }), 30);
}

console.log('\n--- does the box collider still play like a coin pusher? ---');
for (const shape of ['cylinder', 'box']) {
  const m = P.createMachine(RAPIER, { hz: 60, shape, maxCoins: 800 });
  m.seed(450, null, prng(999));
  for (let i = 0; i < 180; i++) m.step();
  const settled = m.active.length;
  let dropped = 0;
  const rnd = prng(7);
  for (let i = 0; i < 60 * 120; i++) {
    if (i % 72 === 0 && m.drop((rnd() * 2 - 1) * CFG.aimLimit)) dropped++;
    m.step();
  }
  console.log(`  ${shape.padEnd(9)} dropped ${dropped}, won ${m.won}, lost ${m.lost}, ` +
              `field ${settled} -> ${m.active.length}`);
  m.world.free();
}
