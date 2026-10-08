/* ------------------------------------------------------------------ *
 *  The wheel spin: what can be won when all three wheels are lit.
 *
 *  A ring of eight prizes on the screen over the coin slot. A spin picks one
 *  (by weight, not by the size of its slot - every slot looks the same).
 *  The Black Hole is not a prize itself: it opens, and a second draw is
 *  made from its own, bigger pool.
 *
 *  Placeholders, to be set with the economy (see the plan): coins come
 *  from the two coin supplies, balls from the ball outlets. Super Push pulls
 *  every pusher right back into its wall - the coins riding on it are
 *  scraped off onto the field - then pushes slowly out to its full reach,
 *  shoving them and the pile on toward the edge.
 * ------------------------------------------------------------------ */

// clockwise from the top
export const RING = [
  { kind: 'coins',  n: 5,  label: '5',    sub: 'COINS',      color: '#9fb4d8', weight: 18 },
  { kind: 'coins',  n: 10, label: '10',   sub: 'COINS',      color: '#5fd0ff', weight: 18 },
  { kind: 'balls',  n: 2,  label: '2',    sub: 'BALLS',      color: '#4d8dff', weight: 14 },
  { kind: 'coins',  n: 20, label: '20',   sub: 'COINS',      color: '#ffd23d', weight: 12 },
  { kind: 'hole',          label: '',     sub: 'BLACK HOLE', color: '#ff6a2a', weight: 12 },
  { kind: 'double',        label: '×2',   sub: 'NEXT SPIN',  color: '#c44bff', weight: 8 },
  { kind: 'push',   times: 1, label: 'PUSH', sub: 'SUPER',   color: '#3dff7a', weight: 10 },
  { kind: 'coins',  n: 50, label: '50',   sub: 'COINS',      color: '#ff3b52', weight: 4 },
];

// what the Black Hole can give
export const HOLE = [
  { kind: 'coins', n: 60,  label: '60',   sub: 'COIN SHOWER',     color: '#ffd23d', weight: 30 },
  { kind: 'balls', n: 6,   label: '6',    sub: 'BALLS',           color: '#4d8dff', weight: 25 },
  { kind: 'push',  times: 2, label: 'PUSH ×2', sub: 'DOUBLE SUPER PUSH', color: '#3dff7a', weight: 25 },
  { kind: 'coins', n: 100, label: '100',  sub: 'COINS',           color: '#ff3b52', weight: 20 },
];

/** An index into list, by weight. */
export function pickIndex(list, rnd = Math.random) {
  const total = list.reduce((a, p) => a + p.weight, 0);
  let r = rnd() * total;
  for (let i = 0; i < list.length; i++) if ((r -= list[i].weight) < 0) return i;
  return list.length - 1;
}

/** One spin: { slot, prize } - and hole, the draw from its pool, if it lands on the Black Hole. */
export function spinOnce(rnd = Math.random) {
  const slot = pickIndex(RING, rnd);
  const out = { slot, prize: RING[slot] };
  if (RING[slot].kind === 'hole') { out.hole = pickIndex(HOLE, rnd); out.prize = HOLE[out.hole]; }
  return out;
}

/** The prize in words, times mult (a ×2 from the last spin). */
export function describe(prize, mult = 1) {
  if (prize.kind === 'coins') return `${prize.n * mult} coins`;
  if (prize.kind === 'balls') return `${prize.n * mult} big balls`;
  if (prize.kind === 'push') return prize.times * mult > 1 ? `Super Push ×${prize.times * mult}` : 'Super Push';
  if (prize.kind === 'double') return 'Next spin ×2';
  return '';
}
