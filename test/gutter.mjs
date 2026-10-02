/* ------------------------------------------------------------------ *
 *  How much should the gutters eat?
 *
 *      node test/gutter.mjs
 *
 *  Making the playfield deeper to fix how it looked also ran every coin
 *  past far more side channel, and the return collapsed from about 20% to
 *  5%. That is not a hard game, it is a broken one.
 *
 *  Two knobs: how wide the gutters are (floorHalfW against wallHalfW) and
 *  how far forward they start (gutterFromZ). This measures both against
 *  the only number that matters - what fraction of coins dropped come
 *  back - so the house edge is chosen rather than inherited.
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

function probe(floorHalfW, gutterFromZ) {
  const saved = { f: CFG.floorHalfW, g: CFG.gutterFromZ };
  CFG.floorHalfW = floorHalfW;
  CFG.gutterFromZ = gutterFromZ;
  try {
    const m = P.createMachine(RAPIER, { hz: HZ, maxCoins: 800 });
    m.seed(420, null, prng(8080));
    for (let i = 0; i < HZ * 18; i++) m.step();      // settle off the grid

    const rnd = prng(404);
    const w0 = m.won, l0 = m.lost;
    let dropped = 0;
    for (let i = 0; i < HZ * 70; i++) {
      if (i % Math.round(HZ * 1.1) === 0 && m.drop((rnd() * 2 - 1) * CFG.aimLimit)) dropped++;
      m.step();
    }
    const won = m.won - w0, lost = m.lost - l0;
    const field = m.active.length;
    m.world.free();
    return { won, lost, dropped, field, ret: won / dropped * 100 };
  } finally {
    CFG.floorHalfW = saved.f;
    CFG.gutterFromZ = saved.g;
  }
}

console.log(`Cabinet is ${CFG.wallHalfW * 2} wide. Gutter = the daylight between the`);
console.log('playfield and the walls, and how far back it runs.\n');
console.log('  gutter   starts at   return   won / lost   on field');
process.stdout.write('');

for (const fw of [12, 12.8, 13.4]) {
  for (const gz of [-10, 6]) {
    const r = probe(fw, gz);
    const gap = (CFG.wallHalfW - fw).toFixed(1);
    const flag = r.ret >= 20 && r.ret <= 45 ? '  <-- playable' : '';
    console.log(`  ${gap.padStart(5)}    ${String(gz).padStart(7)}   ` +
                `${r.ret.toFixed(0).padStart(5)}%   ` +
                `${String(r.won).padStart(3)} / ${String(r.lost).padEnd(4)}  ` +
                `${String(r.field).padStart(5)}${flag}`);
  }
}

console.log('\nWanted: 20-45% back. Below that the machine just eats coins;');
console.log('above it there is no tension and the pile drains.');
