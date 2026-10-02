/* ------------------------------------------------------------------ *
 *  Settle a pile offline and record it.
 *
 *      node test/make-pile.mjs        ->  writes pile.json
 *
 *  A grid-seeded machine is above its natural capacity and spends about
 *  two minutes collapsing into shape, shedding coins the whole way. Doing
 *  that on the player's machine looks broken - coins fall off while they
 *  are not even playing.
 *
 *  So we do it here, once, and ship the answer. The app loads a pile that
 *  is already at rest and nothing moves until a coin is dropped.
 * ------------------------------------------------------------------ */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as RAPIER from '../vendor/rapier.es.js';
import { CFG } from '../config.js?v=5';
import * as P from '../physics.js?v=5';
await RAPIER.init();

const HZ = 30;
const START = 620;          // over-fill, then let it find its own level
const MAX_MINUTES = 8;
const out = fileURLToPath(new URL('../pile.json', import.meta.url));

const m = P.createMachine(RAPIER, { hz: HZ, maxCoins: 800 });
m.seed(START);
console.log(`seeded ${m.active.length}, settling until it stops shedding...\n`);
console.log('   sim time   on field   fell in the last 20s');

let settledAt = null;
for (let block = 1; block <= MAX_MINUTES * 3; block++) {
  const before = m.won + m.lost;
  for (let i = 0; i < HZ * 20; i++) m.step();
  const fell = m.won + m.lost - before;
  console.log(`   ${String(block * 20).padStart(6)}s   ${String(m.active.length).padStart(8)}   ${String(fell).padStart(20)}`);
  if (fell === 0) { settledAt = block * 20; break; }
}

if (settledAt === null) {
  console.log('\nNever fully stopped. Recording anyway - check the trend above.');
} else {
  console.log(`\nAt rest after ${settledAt}s of simulated time.`);
}

// Park anything still sitting in the payout tray; it is not part of the pile.
for (let i = m.active.length - 1; i >= 0; i--) {
  if (m.active[i].paidAt) m.park(m.active[i]);
}

const r = v => Math.round(v * 1000) / 1000;
const coins = m.active.map(c => {
  const p = c.body.translation(), q = c.body.rotation();
  return [r(p.x), r(p.y), r(p.z), r(q.x), r(q.y), r(q.z), r(q.w)];
});

const pile = {
  note: 'Settled offline by test/make-pile.mjs. Do not hand-edit.',
  shape: CFG.coinShape,
  gravity: CFG.gravity,
  elapsed: r(m.elapsed % CFG.period),      // where the pusher was, so it resumes in phase
  count: coins.length,
  coins,
};

writeFileSync(out, JSON.stringify(pile));
const kb = (JSON.stringify(pile).length / 1024).toFixed(0);
console.log(`\nWrote ${coins.length} coins to pile.json (${kb} KB).`);
console.log(`Lost ${m.lost} down the gutters and paid out ${m.won} getting there.`);
