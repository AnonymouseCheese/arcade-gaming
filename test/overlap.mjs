/* ------------------------------------------------------------------ *
 *  Does the box collider show?
 *
 *      node test/overlap.mjs
 *
 *  The coin you see is always a disc of radius R, so two flat coins in
 *  the same layer should never sit closer than 2R apart. A cylinder
 *  collider guarantees that. A box collider does not: face to face it
 *  allows 2*K*R, which is closer, and the rendered discs then overlap.
 *
 *  This measures how often that actually happens in a settled pile, and
 *  by how much, so the trade is a number rather than a guess.
 *
 *  The cylinder column is the control. It must come out at essentially
 *  zero overlap - if it does not, the filter below is wrong, not Rapier.
 * ------------------------------------------------------------------ */

import * as RAPIER from '../vendor/rapier.es.js';
import { CFG } from '../config.js?v=3';
import * as P from '../physics.js?v=3';
await RAPIER.init();

const prng = s => () => {
  s = (s + 0x6D2B79F5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const D = CFG.coinR * 2;          // the diameter you can see

/** Is this coin lying flat? Its local +Y must still point roughly up. */
function isFlat(q) {
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);      // y of (0,1,0) rotated by q
  return Math.abs(uy) > 0.995;
}

function survey(shape) {
  const m = P.createMachine(RAPIER, { hz: 30, shape, maxCoins: 800 });
  m.seed(500, null, prng(2468));
  for (let i = 0; i < 30 * 25; i++) m.step();       // settle properly

  const flat = [];
  for (const c of m.active) {
    if (isFlat(c.body.rotation())) flat.push(c.body.translation());
  }

  let pairs = 0, over = 0, sum = 0, worst = 0, closest = Infinity;
  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) {
      const a = flat[i], b = flat[j];

      // Truly coplanar only. A coin resting ON another sits a whole collider
      // thickness higher, so anything near that is a stack, not a clash -
      // and counting stacks is what made the first version of this nonsense.
      if (Math.abs(a.y - b.y) > CFG.colT * 0.12) continue;

      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > D * 1.15) continue;                            // not neighbours
      pairs++;
      closest = Math.min(closest, d);
      const gap = D - d;
      if (gap > 0.01) { over++; sum += gap; worst = Math.max(worst, gap); }
    }
  }

  m.world.free();
  return {
    flat: flat.length, pairs, over,
    pct: pairs ? over / pairs * 100 : 0,
    mean: over ? sum / over : 0,
    worst, closest,
  };
}

console.log(`A visible coin is ${D.toFixed(2)} units across. Two flat coins in the`);
console.log('same layer closer than that will look like they are clipping.\n');

for (const shape of ['cylinder', 'box']) {
  const r = survey(shape);
  console.log(shape);
  console.log(`  flat coins surveyed     ${r.flat}`);
  console.log(`  neighbouring pairs      ${r.pairs}`);
  console.log(`  pairs that overlap      ${r.over}  (${r.pct.toFixed(1)}%)`);
  console.log(`  mean overlap            ${r.mean.toFixed(3)} units  = ` +
              `${(r.mean / D * 100).toFixed(1)}% of a coin`);
  console.log(`  worst overlap           ${r.worst.toFixed(3)} units  = ` +
              `${(r.worst / D * 100).toFixed(1)}% of a coin`);
  console.log(`  closest two centres     ${r.closest.toFixed(3)} units  ` +
              `(a disc needs ${D.toFixed(2)})\n`);
}

console.log('Rule of thumb: on a phone a coin is ~20px across, so 5% is 1px');
console.log('and invisible, while 20% is 4px and starts to read as clipping.');
