/* ------------------------------------------------------------------ *
 *  Does the drop chute work?
 *
 *      node test/chute.mjs
 *
 *  Three things can go wrong with a peg board. A coin can wedge and never
 *  come out. It can fall straight through without being scattered, which
 *  makes the pins decoration. Or it can scatter so wildly that aiming is
 *  pointless. This measures all three.
 * ------------------------------------------------------------------ */

import * as RAPIER from '../vendor/rapier.es.js';
import { CFG } from '../config.js?v=6';
import * as P from '../physics.js?v=6';
await RAPIER.init();

const HZ = 30;
const m = P.createMachine(RAPIER, { hz: HZ, maxCoins: 800 });
m.seed(360);
for (let i = 0; i < HZ * 20; i++) m.step();      // give it a field to land on

console.log(`chute: ${P.dropperPegs().length} pins, ` +
            `${P.dropperBoxes().length} plates and antlers\n`);

const TRIALS = 90;
const results = [];
const stuckAt = [];
let stuck = 0;

for (let t = 0; t < TRIALS; t++) {
  const aim = ((t % 9) / 8 * 2 - 1) * CFG.aimLimit;     // sweep across the board
  const coin = m.drop(aim);
  if (!coin) break;

  let exitX = null, steps = 0;
  while (steps < HZ * 12) {                             // 12s to clear the chute
    m.step();
    steps++;
    const p = coin.body.translation();
    if (!coin.live) break;                              // already collected
    if (p.y < CFG.chuteExitY - 0.5) { exitX = p.x; break; }
  }
  if (exitX === null) {
    stuck++;
    const p = coin.body.translation();
    stuckAt.push([p.x, p.y]);
    m.park(coin);                 // clear it, so it cannot block the next
    continue;
  }
  results.push({ aim, exitX, steps });
  for (let i = 0; i < HZ * 2; i++) m.step();            // let things calm down
}

const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const dev  = results.map(r => r.exitX - r.aim);
const absd = dev.map(Math.abs);
const times = results.map(r => r.steps / HZ);

console.log(`  coins that cleared the chute   ${results.length} of ${TRIALS}`);
console.log(`  coins that wedged              ${stuck}`);
console.log(`  time to fall through           ${mean(times).toFixed(2)}s ` +
            `(slowest ${Math.max(...times).toFixed(1)}s)`);
console.log(`  average sideways scatter       ${mean(absd).toFixed(2)} units ` +
            `= ${(mean(absd) / CFG.coinR / 2).toFixed(1)} coin widths`);
console.log(`  biggest scatter                ${Math.max(...absd).toFixed(2)} units`);
console.log(`  mean drift (should be ~0)      ${mean(dev).toFixed(2)} units`);

// Does aim still matter? Correlate where you aimed with where it came out.
const ax = mean(results.map(r => r.aim)), ex = mean(results.map(r => r.exitX));
let num = 0, dA = 0, dE = 0;
for (const r of results) {
  num += (r.aim - ax) * (r.exitX - ex);
  dA  += (r.aim - ax) ** 2;
  dE  += (r.exitX - ex) ** 2;
}
const corr = num / Math.sqrt(dA * dE);
console.log(`  aim vs landing correlation     ${corr.toFixed(2)}`);

if (stuckAt.length) {
  console.log('');
  console.log('  where they wedged:');
  const bands = [
    ['on the antlers  ', CFG.antlerY - 1.6, 99],
    ['pin row 1       ', CFG.pegTopY - CFG.pegDY + 0.5, CFG.antlerY - 1.6],
    ['pin rows 2-4    ', CFG.pegTopY - 3.5 * CFG.pegDY, CFG.pegTopY - CFG.pegDY + 0.5],
    ['below the pins  ', -99, CFG.pegTopY - 3.5 * CFG.pegDY],
  ];
  for (const [name, lo, hi] of bands) {
    const hits = stuckAt.filter(q => q[1] >= lo && q[1] < hi);
    if (!hits.length) continue;
    const xs = hits.map(q => q[0]);
    const edge = xs.filter(x => Math.abs(x) > CFG.chuteHalfW - 2.2).length;
    const mid  = xs.filter(x => Math.abs(x) < 1.6).length;
    console.log('    ' + name + String(hits.length).padStart(3) +
                '   ' + edge + ' against a side wall, ' + mid + ' on the centre line');
  }
}

console.log('\nWanted: nothing wedged, scatter of 1-3 coin widths, and a');
console.log('correlation around 0.5-0.9 - aim matters, but does not decide it.');
