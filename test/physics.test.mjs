/* ------------------------------------------------------------------ *
 *  Drives the real physics.js. No DOM, no renderer, no browser.
 *
 *      node test/physics.test.mjs
 *
 *  physics.js is deliberately free of three.js and the DOM so that the
 *  machine can be tested exactly as it ships.
 * ------------------------------------------------------------------ */

import * as RAPIER from '../vendor/rapier.es.js';
import { CFG } from '../config.js';
import * as P from '../physics.js';

await RAPIER.init();

let failures = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

/* ---------------- 1. the layout ---------------- */

const cap = P.seedCapacity();
ok('seed layout holds a full machine', cap >= 600, `${cap} coins`);

ok('every seeded coin starts inside the cabinet',
   P.seedLayout(400).every(p =>
     Math.abs(p.x) < CFG.floorHalfW && p.z > CFG.backZ && p.z < CFG.lipZ && p.y > 0));

/* ---------------- 2. the pusher ---------------- */

let lo = Infinity, hi = -Infinity;
for (let t = 0; t < CFG.period * 2; t += 0.01) {
  const z = P.pusherZ(t);
  lo = Math.min(lo, z); hi = Math.max(hi, z);
}
ok('pusher sweeps its full stroke',
   Math.abs(lo) < 1e-6 && Math.abs(hi - CFG.stroke) < 1e-3,
   `${lo.toFixed(3)} .. ${hi.toFixed(3)} of ${CFG.stroke}`);

/* ---------------- 3. it holds together ---------------- */

const m = P.createMachine(RAPIER, { hz: 60, iterations: 4, maxCoins: 800 });
ok('machine seeded', m.seed(400) === 400, `${m.active.length} coins`);

for (let i = 0; i < 180; i++) m.step();

let bad = 0, escaped = 0;
for (const c of m.active) {
  const p = c.body.translation();
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) bad++;
  if (Math.abs(p.x) > CFG.wallHalfW + 3 || p.z < CFG.backZ - 4 || p.y > 30) escaped++;
}
ok('no coin blew up', bad === 0, `${bad} non-finite`);
ok('no coin escaped the cabinet', escaped === 0, `${escaped} outside`);

// Sleeping does NOT save anything here: the carpet is one connected contact
// island touching a pusher that never stops, so it stays awake by
// construction. Recorded so nobody re-discovers this the hard way.
console.log(`      (awake ${m.awake}/${m.active.length} - the pusher keeps the whole island up)`);

/* ---------------- 4. an idle machine settles ---------------- */

// Left alone, a real machine sheds coins until the front of the pile no
// longer reaches the lip, and then stops. It must converge, not run dry.
const drain = () => {
  const n = m.active.length;
  for (let i = 0; i < 60 * 20; i++) m.step();
  return n - m.active.length;
};
const first = drain();
drain();
const third = drain();
ok('an idle machine settles instead of draining', third < first * 0.5,
   `${first} coins fell in the first idle 20s, ${third} in the third`);
ok('an idle machine keeps most of its pile', m.active.length > 250,
   `${m.active.length} left on the field`);

/* ---------------- 5. does it actually pay out? ---------------- */

const field0 = m.active.length, won0 = m.won, lost0 = m.lost;
let dropped = 0;
for (let i = 0; i < 60 * 90; i++) {
  if (i % 72 === 0 && m.drop((Math.random() * 2 - 1) * CFG.aimLimit)) dropped++;
  m.step();
}
const won = m.won - won0, lost = m.lost - lost0;

ok('coins fall off the front and pay out', won > 0, `${won} won`);
ok('coins are also lost down the gutters', lost > 0, `${lost} lost`);
ok('every coin is accounted for',
   m.active.length === field0 + dropped - won - lost,
   `${m.active.length} on field = ${field0} + ${dropped} - ${won} - ${lost}`);

console.log(`\n      dropped ${dropped}, won ${won}, lost ${lost}` +
            `  ->  ${(won / dropped * 100).toFixed(0)}% of coins dropped came back`);

/* ---------------- 6. what does a step cost? ---------------- */

console.log('\n  Step cost on this machine, single core:');
for (const n of [200, 400, 600]) {
  for (const hz of [60, 30]) {
    const b = P.createMachine(RAPIER, { hz, iterations: 4, maxCoins: 800 });
    b.seed(n);
    for (let i = 0; i < 120; i++) b.step();
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) b.step();
    const ms = (performance.now() - t0) / 300;
    console.log(`    ${String(n).padStart(3)} coins @ ${hz}Hz   ${ms.toFixed(2).padStart(5)} ms/step   ` +
                `${(ms / (1000 / hz) * 100).toFixed(0).padStart(3)}% of the ${(1000 / hz).toFixed(1)}ms budget`);
    b.world.free();
  }
}

console.log(`\n${failures ? failures + ' FAILURE(S)' : 'All checks passed'}`);
process.exit(failures ? 1 : 0);
