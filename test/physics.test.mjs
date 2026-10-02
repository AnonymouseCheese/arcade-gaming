/* ------------------------------------------------------------------ *
 *  Drives the real physics.js. No DOM, no renderer, no browser.
 *
 *      node test/physics.test.mjs
 *
 *  physics.js is deliberately free of three.js and the DOM so that the
 *  machine can be tested exactly as it ships.
 * ------------------------------------------------------------------ */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as RAPIER from '../vendor/rapier.es.js';
import { CFG } from '../config.js?v=5';
import * as P from '../physics.js?v=5';

await RAPIER.init();

let failures = 0;
const ok = (name, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

/* ---------------- 1. the layout ---------------- */

const cap = P.seedCapacity();
// The cabinet was narrowed deliberately to suit a portrait screen, so this
// is lower than it was. It still has to hold a convincingly full machine.
ok('seed layout holds a full machine', cap >= 520, `${cap} coins`);

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

// Coins that have been paid are still on the active list while they sit in
// the tray, so 'on the field' means active minus whatever is in the tray.
const inTray = () => m.active.reduce((n, c) => n + (c.paidAt ? 1 : 0), 0);
const field0 = m.active.length - inTray(), won0 = m.won, lost0 = m.lost;
let sawTray = 0;
let dropped = 0;
for (let i = 0; i < 60 * 90; i++) {
  if (i % 72 === 0 && m.drop((Math.random() * 2 - 1) * CFG.aimLimit)) dropped++;
  m.step();
  sawTray = Math.max(sawTray, inTray());
}
const won = m.won - won0, lost = m.lost - lost0;

ok('coins fall off the front and pay out', won > 0, `${won} won`);
ok('coins are also lost down the gutters', lost > 0, `${lost} lost`);
const field1 = m.active.length - inTray();
ok('winnings land in the payout tray', sawTray > 0, `${sawTray} coins in it at once`);
ok('the tray empties itself', inTray() < 60, `${inTray()} sitting in it now`);
ok('every coin is accounted for',
   field1 === field0 + dropped - won - lost,
   `${field1} on field = ${field0} + ${dropped} - ${won} - ${lost}`);

console.log(`\n      dropped ${dropped}, won ${won}, lost ${lost}` +
            `  ->  ${(won / dropped * 100).toFixed(0)}% of coins dropped came back`);

/* ---------------- 6. the pile we actually ship ---------------- */

// This is the regression guard for the complaint that started it: coins
// falling off while nobody is playing. A grid-seeded machine sheds well over
// a hundred coins in its first two idle minutes as it collapses into shape.
// The shipped pile was settled offline and must not.
const pile = JSON.parse(readFileSync(
  fileURLToPath(new URL('../pile.json', import.meta.url)), 'utf8'));

ok('the shipped pile matches the collider we ship', pile.shape === CFG.coinShape,
   `pile built for ${pile.shape}, config says ${CFG.coinShape}`);

const q = P.createMachine(RAPIER, { hz: 30, maxCoins: 800 });
ok('the pile loads', q.seedFrom(pile, pile.count) === pile.count, `${pile.count} coins`);

let shed = 0;
for (let w = 0; w < 6; w++) {
  const before = q.won + q.lost;
  for (let i = 0; i < 30 * 20; i++) q.step();
  shed += q.won + q.lost - before;
}
ok('a settled machine stays put when nobody plays', shed < 25,
   `${shed} coins fell in two idle minutes`);
ok('and keeps its pile', q.active.length > pile.count * 0.9,
   `${q.active.length} of ${pile.count} left`);

const t1 = performance.now();
for (let i = 0; i < 300; i++) q.step();
const settledMs = (performance.now() - t1) / 300;
console.log(`
      the shipped pile costs ${settledMs.toFixed(2)} ms/step at 30 Hz ` +
            `= ${(settledMs / 33.3 * 100).toFixed(0)}% of budget here`);
q.world.free();

/* ---------------- 7. what does a step cost? ---------------- */

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
