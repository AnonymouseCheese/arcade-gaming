/* ------------------------------------------------------------------ *
 *  The machine, built from the block layout.
 *
 *  block-editor.html is where the field is designed, block by block. This
 *  turns what it saves into the parts a physics world needs - and a
 *  renderer can draw the same list, so the two cannot drift apart.
 *
 *  Pure geometry: no Rapier, no three.js, no DOM. It runs under Node and
 *  in the browser alike.
 *
 *  Units: one block is one coin across, 2.4 cm, and the world is in cm.
 *    x = i * S   left/right; a block's centre (blocks are centred on i)
 *    y = j * S   up from the ground
 *    z = k * S   from the back wall toward the player
 * ------------------------------------------------------------------ */

export const S = 2.4;
const SINK = 1.2;
const FOOTING = 8;      // how far blocks on the ground reach down below it, cm        // how far a pusher reaches down into the deck it slides on, cm

const SQ = [[0, 0], [1, 0], [1, 1], [0, 1]];
const T = 0.18;
const dn = T / 2 / Math.SQRT2;
const SHAPES = {
  cube:    { poly: SQ, h: [1, 1, 1, 1] },
  half:    { poly: SQ, h: [.5, .5, .5, .5] },
  quarter: { poly: SQ, h: [.25, .25, .25, .25] },
  slope:   { poly: SQ, h: [1, 1, 0, 0] },
  corner:  { poly: SQ, h: [1, .5, 0, .5] },
  wedge:   { poly: [[0, 0], [1, 0], [0, 1]], h: [1, 1, 1] },
  panel:   { poly: [[0, 0], [1, 0], [1, T], [0, T]], h: [1, 1, 1, 1] },
  dpanel:  { poly: [[dn, -dn], [1 + dn, 1 - dn], [1 - dn, 1 + dn], [-dn, dn]], h: [1, 1, 1, 1] },
  custom:  { poly: SQ },
};

/** A block's outline seen from above, and the height of its top at each corner. */
export function outline(b) {
  const def = SHAPES[b.shape] ?? SHAPES.cube;
  let pts = b.shape === 'custom' && b.outline ? b.outline : def.poly;
  const hs = b.shape === 'custom' ? b.top : def.h;
  for (let r = 0; r < (b.rot || 0); r++) pts = pts.map(([x, z]) => [1 - z, x]);
  return { pts, hs };
}

const key = (i, j, k) => i + ',' + j + ',' + k;
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * If a block is a plain box inside its cell - a cube, a slab, a panel -
 * its extent within the cell as [x0, x1, y0, y1, z0, z1] (0..1). Otherwise null.
 */
function boxIn(b) {
  if (!['cube', 'half', 'quarter', 'panel'].includes(b.shape)) return null;
  const { pts, hs } = outline(b);
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  return [Math.min(...xs), Math.max(...xs), 0, hs[0], Math.min(...zs), Math.max(...zs)];
}

/** Every block of the same kind joined face to face, as lists of [i, j, k]. */
function components(cells, wanted) {
  const seen = new Set(), out = [];
  for (const [kk, b] of cells) {
    if (seen.has(kk) || !wanted(b)) continue;
    const first = kk.split(',').map(Number), list = [], stack = [first];
    seen.add(kk);
    while (stack.length) {
      const c = stack.pop();
      list.push(c);
      for (const d of N6) {
        const n = [c[0] + d[0], c[1] + d[1], c[2] + d[2]], nk = key(...n);
        if (!seen.has(nk) && cells.get(nk)?.kind === b.kind) { seen.add(nk); stack.push(n); }
      }
    }
    out.push({ kind: b.kind, cells: list });
  }
  return out;
}

/**
 * Merge box-shaped blocks into as few big boxes as possible. Two blocks
 * only merge along a direction they fill completely - a panel along the
 * back of its cell can join its neighbours sideways and upward, never
 * front to back, or the box would cover the gap behind it.
 */
function mergeBoxes(list, cells) {
  const groups = new Map();
  for (const c of list) {
    const ext = boxIn(cells.get(key(...c)));
    const sig = ext.join(',');
    if (!groups.has(sig)) groups.set(sig, { ext, set: new Set() });
    groups.get(sig).set.add(key(...c));
  }
  const boxes = [];
  for (const { ext, set } of groups.values()) {
    const [x0, x1, y0, y1, z0, z1] = ext;
    const full = [x0 === 0 && x1 === 1, y0 === 0 && y1 === 1, z0 === 0 && z1 === 1];
    const cellsSorted = [...set].map(s => s.split(',').map(Number))
      .sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0]);
    const used = new Set();
    const free = (i, j, k) => set.has(key(i, j, k)) && !used.has(key(i, j, k));
    for (const [i, j, k] of cellsSorted) {
      if (used.has(key(i, j, k))) continue;
      let i1 = i, k1 = k, j1 = j;
      if (full[0]) while (free(i1 + 1, j, k)) i1++;
      const rowFree = (kk, jj) => { for (let x = i; x <= i1; x++) if (!free(x, jj, kk)) return false; return true; };
      if (full[2]) while (rowFree(k1 + 1, j)) k1++;
      const layerFree = jj => { for (let z = k; z <= k1; z++) if (!rowFree(z, jj)) return false; return true; };
      if (full[1]) while (layerFree(j1 + 1)) j1++;
      for (let y = j; y <= j1; y++) for (let z = k; z <= k1; z++) for (let x = i; x <= i1; x++) used.add(key(x, y, z));
      const lo = [i - 0.5 + x0, j + y0, k + z0], hi = [i1 - 0.5 + x1, j1 + y1, k1 + z1];
      boxes.push({ lo: lo.map(v => v * S), hi: hi.map(v => v * S) });
    }
  }
  return boxes.map(b => ({
    c: [0, 1, 2].map(a => (b.lo[a] + b.hi[a]) / 2),
    h: [0, 1, 2].map(a => (b.hi[a] - b.lo[a]) / 2),
  }));
}

/** The corner points of one block, as a convex solid: its outline at the
 *  bottom of the cell, and again at the height of its top. */
function pieceHull(i, j, k, b) {
  const { pts, hs } = outline(b);
  const out = [];
  pts.forEach(([x, z], n) => {
    const X = (i - 0.5 + x) * S, Z = (k + z) * S;
    out.push(X, j * S, Z, X, (j + Math.max(hs[n], 0.02)) * S, Z);
  });
  return out;
}

/**
 * A ramp drawn with the Ramp tool is one flat sloping plane, cut into
 * blocks. If this piece of the field is that - a rectangle seen from above,
 * whose tops all lie on one plane - give it back as a single sloping solid:
 * its top exactly the plane, with no seams between blocks for a rolling
 * coin or ball to catch on.
 */
function asOnePlane(comp, cells) {
  const cols = new Map();
  for (const c of comp.cells) {
    const kk = c[0] + ',' + c[2];
    if (!cols.has(kk) || cols.get(kk)[1] < c[1]) cols.set(kk, c);
  }
  const is = comp.cells.map(c => c[0]), ks = comp.cells.map(c => c[2]);
  const i0 = Math.min(...is), i1 = Math.max(...is), k0 = Math.min(...ks), k1 = Math.max(...ks);
  if (cols.size !== (i1 - i0 + 1) * (k1 - k0 + 1)) return null;          // not a rectangle

  // every corner of every column's top, as a point on the slope
  const P = [];
  for (const [i, j, k] of cols.values()) {
    const { pts, hs } = outline(cells.get(key(i, j, k)));
    pts.forEach(([x, z], n) => { if (hs[n] > 1e-6) P.push([i - 0.5 + x, j + hs[n], k + z]); });
  }
  // least squares: y = a + b x + c z
  let n = 0, sx = 0, sz = 0, sy = 0, sxx = 0, szz = 0, sxz = 0, sxy = 0, szy = 0;
  for (const [x, y, z] of P) { n++; sx += x; sz += z; sy += y; sxx += x * x; szz += z * z; sxz += x * z; sxy += x * y; szy += z * y; }
  const M = [[n, sx, sz], [sx, sxx, sxz], [sz, sxz, szz]], R = [sy, sxy, szy];
  const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  if (Math.abs(D) < 1e-9) return null;
  const col = (m, c, v) => m.map((row, r) => row.map((x, cc) => (cc === c ? v[r] : x)));
  const [a, b, c] = [0, 1, 2].map(cc => det(col(M, cc, R)) / D);
  const plane = (x, z) => a + b * x + c * z;
  if (P.some(([x, y, z]) => Math.abs(plane(x, z) - y) > 0.02)) return null;   // not one plane

  const bottom = Math.min(...comp.cells.map(cc => cc[1]));
  const corners = [[i0 - 0.5, k0], [i1 + 0.5, k0], [i1 + 0.5, k1 + 1], [i0 - 0.5, k1 + 1]];
  const pts = [];
  for (const [x, z] of corners) pts.push(x * S, bottom * S, z * S, x * S, plane(x, z) * S, z * S);
  return { points: pts, plane: { a: a * S, b, c, from: [i0 - 0.5, k0], to: [i1 + 0.5, k1 + 1] } };
}

/**
 * Turn a saved layout into the machine.
 *   layout   the block layout (machine.json)
 *   opts.stroke   how far each pusher travels, cm
 *
 * Returns
 *   statics  [{ kind, c, h }]          fixed boxes, centre and half-size, cm
 *   hulls    [{ kind, points, plane? }] fixed convex solids - ramps, odd shapes
 *   pushers  [{ boxes, front, back, x0, x1, top, stroke }]  each its own moving body
 *   rails    [{ a, b, r }]              round bars, cm
 *   zones    { drop: { x0, x1, z0, z1, y } }   where coins pay out and balls count
 *   bounds   { lo, hi }                 everything, cm
 */
export function machineFromLayout(layout, opts = {}) {
  const stroke = opts.stroke ?? 5.5;
  const cells = new Map();
  for (const b of layout.blocks) cells.set(key(b.i, b.j, b.k), b);

  const statics = [], hulls = [], pushers = [];

  for (const comp of components(cells, () => true)) {
    const boxy = comp.cells.filter(c => boxIn(cells.get(key(...c))));
    const odd = comp.cells.filter(c => !boxIn(cells.get(key(...c))));

    if (comp.kind === 'pusher') {
      const boxes = mergeBoxes(boxy, cells);
      const zs = boxes.map(b => b.c[2] - b.h[2]);
      const back = Math.min(...zs);
      // A pusher's body carries on back into the wall behind it, by one
      // stroke, so no gap ever opens behind it for coins to fall into. The
      // wall scrapes its top as it comes back - which is what real ones do.
      for (const b of boxes) {
        if (Math.abs(b.c[2] - b.h[2] - back) < 1e-6) { b.c[2] -= stroke / 2; b.h[2] += stroke / 2; }
      }
      // ...and down into the surface it slides on. A pusher sitting flush on
      // the deck leaves a seam a coin can be caught in, and since nothing
      // stops a pusher, the coin is forced down through the deck and lost.
      const floor = Math.min(...boxes.map(b => b.c[1] - b.h[1]));
      for (const b of boxes) {
        if (Math.abs(b.c[1] - b.h[1] - floor) < 1e-6) { b.c[1] -= SINK / 2; b.h[1] += SINK / 2; }
      }
      const lo = [0, 1, 2].map(a => Math.min(...boxes.map(b => b.c[a] - b.h[a])));
      const hi = [0, 1, 2].map(a => Math.max(...boxes.map(b => b.c[a] + b.h[a])));
      pushers.push({ boxes, back: back, front: hi[2], x0: lo[0], x1: hi[0], top: hi[1], bottom: floor, stroke });
      continue;
    }

    const plane = odd.length ? asOnePlane(comp, cells) : null;
    if (plane) {
      hulls.push({ kind: comp.kind, points: plane.points, plane: plane.plane });
      continue;
    }
    for (const b of mergeBoxes(boxy, cells)) {
      // Anything standing on the ground reaches well below it, out of sight.
      // A deck one block thick can have a coin forced right through it when
      // the coin is pinched against a pusher's face; from deep inside a thick
      // one, the quickest way out is back up.
      if (b.c[1] - b.h[1] < 0.01) { b.c[1] -= FOOTING / 2; b.h[1] += FOOTING / 2; }
      statics.push({ kind: comp.kind, ...b });
    }
    for (const [i, j, k] of odd) hulls.push({ kind: comp.kind, points: pieceHull(i, j, k, cells.get(key(i, j, k))) });
  }

  const rails = (layout.rails || []).map(r => ({
    a: [r.from.x * S, r.from.y * S, r.from.z * S], b: [r.to.x * S, r.to.y * S, r.to.z * S],
    r: (r.across ?? 0.2) / 2 * S,
  }));

  // where coins pay out and balls count: the marked drop area, or failing
  // that, everything in front of the main deck
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const b of layout.blocks) {
    const p = [(b.i - 0.5) * S, b.j * S, b.k * S], q = [(b.i + 0.5) * S, (b.j + 1) * S, (b.k + 1) * S];
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], q[a]); }
  }
  const mark = (layout.marks || []).find(m => m.type === 'catch' && m.area);
  let drop;
  if (mark) {
    const A = mark.area.from, B = mark.area.to;
    drop = { x0: Math.min(A.x, B.x) * S, x1: Math.max(A.x, B.x) * S, z0: Math.min(A.z, B.z) * S, z1: Math.max(A.z, B.z) * S };
  } else {
    const deck = statics.filter(s => s.kind === 'deck');
    const front = Math.max(...deck.map(s => s.c[2] + s.h[2]));
    drop = { x0: Math.min(...deck.map(s => s.c[0] - s.h[0])), x1: Math.max(...deck.map(s => s.c[0] + s.h[0])), z0: front, z1: hi[2] };
  }
  const deckTop = Math.max(...statics.filter(s => s.kind === 'deck').map(s => s.c[1] + s.h[1]), 0);
  drop.y = deckTop;          // below the deck's top, inside the area: it has gone over the edge

  const chute = dropBox(pushers, statics);
  if (chute) {
    statics.push(...chute.parts);
    for (const w of chute.board.wheels) for (const points of w.halves) hulls.push({ kind: 'wheel', points, wheel: w.i });
  }

  // The payout tray: under the drop area, right across the machine. Coins
  // over the front land in it and sit a moment before being cleared away.
  drop.trayY = -6;
  statics.push({ kind: 'tray', c: [(lo[0] + hi[0]) / 2, drop.trayY - 0.5, (drop.z0 + hi[2]) / 2],
                 h: [(hi[0] - lo[0]) / 2, 0.5, (hi[2] - drop.z0) / 2] });

  statics.push(...stopBlocks(statics, lo, hi, drop.trayY - 1));

  return { statics, hulls, pushers, rails, chute, zones: { drop }, bounds: { lo, hi } };
}

/**
 * Where your coin goes in: the glass box at the back of the centre lane,
 * above the centre pusher.
 *
 * A coin is let in at the top middle, standing on its edge, and falls
 * through a slot one coin thick between the back wall and the glass.
 *
 * Just under the top hang two WIPERS:
 * white arms on pivots, swinging side to side together, always parallel,
 * like a car's windscreen wipers. The coin drops between the two pivots.
 * As they swing right, the left wiper's tip sweeps into the middle and
 * knocks the coin right; swinging left, the right one knocks it left. Only
 * a coin that happens to arrive while both hang straight down falls between
 * them untouched - rare, because a swinging arm passes straight-down fastest.
 * Below them it drops out of the bottom of the box onto the centre pusher.
 *
 * Everything is measured off the layout: the lane is the width of the
 * centre pusher, the back of the box is the wall behind it, and the box
 * reaches up to the top of the walls either side.
 */
export function dropBox(pushers, statics) {
  if (!pushers.length) return null;
  const centre = pushers.reduce((a, p) => (p.top < a.top ? p : a));      // the lowest one
  const x0 = centre.x0, x1 = centre.x1, xc = (x0 + x1) / 2;
  const walls = statics.filter(s => s.kind === 'wall' && s.c[0] + s.h[0] > x0 - 3 && s.c[0] - s.h[0] < x1 + 3 &&
                                     s.c[2] - s.h[2] < centre.back + 1 && s.c[2] + s.h[2] > centre.back - 1);
  const wallTop = walls.length ? Math.max(...walls.map(s => s.c[1] + s.h[1])) : centre.top + 20;
  const gap = 0.62;                       // the slot: one coin thick, on edge, with a little play
  // The slot stands a coin's width in front of the wall behind the pusher,
  // with its own back panel. Flush against the wall, every coin landed in
  // the corner between wall and pusher, and each stroke dragged it into the
  // wall face: about one coin in every one played had to be rescued.
  const back = centre.back + 2.4;
  const zc = back + gap / 2;
  // The bottom of the box sits higher than a coin standing on its edge, so a
  // coin that lands upright on the pusher is clear of the glass and topples
  // out. At 1.4 cm a standing coin's top stayed caught under the glass, the
  // pusher carried it into the glass, and it was squeezed out of the machine.
  const exitY = centre.top + 2 * 1.2 + 0.8;
  const topY = wallTop - 1.2;
  const midY = (topY + exitY) / 2, halfH = (topY - exitY) / 2;
  const glass = { kind: 'glass', c: [xc, midY, back + gap + 0.25], h: [(x1 - x0) / 2, halfH, 0.25], mu: 0.08 };
  // The box's back panel comes down INTO the pusher - the pusher slides
  // through it out of sight, as into a slot in a real machine's wall (the
  // physics never lets a moving pusher and a fixed part touch) - so it is the
  // wall that scrapes the pusher's top, with no gap at all. A gap even thinner
  // than a coin was a trap: pulling back, the pusher dragged a flat coin into
  // it, and the coin vanished into the wall until it was put back.
  // Each time the pusher pulls back, its top slides under the panel and every
  // coin on that strip is pushed forward, so the strip at the back stays
  // clear and every coin dropped joins the line that gets pushed off the
  // front. Stopping short at the box's exit left a
  // strip no wall ever reached: coins rode back and forth on it and piled up
  // - 120 played, 76 more coins sitting on the pusher, 17 sent on.
  // It is solid right back to the wall, so there is no pocket behind it for
  // a coin to end up in.
  const panelBottom = centre.top - 2, panelTop = topY + 1.2;
  const panel = { kind: 'chute', c: [xc, (panelBottom + panelTop) / 2, (centre.back + back) / 2],
                  h: [(x1 - x0) / 2, (panelTop - panelBottom) / 2, (back - centre.back) / 2], mu: 0.08 };
  // The rule: the coin drops between the wipers and almost always touches
  // one; only very rarely does it fall between them untouched. Tilted, two
  // parallel arms close up on each other: at this spacing and swing there is
  // still room for a coin between them at full tilt (pivots 4.1 cm apart
  // pinched coins past 41 degrees). The rule is kept by the slot's timing
  // (see `release`), not by crowding the arms.
  const guards = {
    // The pivots sit far enough down that a coin let in at the top is clear
    // of both arms whatever their angle. Higher up, an arm swung right out
    // passed through the very spot a new coin appears, and the coin started
    // inside it.
    pivotY: topY - 1.6,
    spacing: +(globalThis.WIPER_SPACING ?? 5.4),   // between the two pivots
    length: +(globalThis.WIPER_LENGTH ?? 4.5),     // pivot to tip
    width: 0.7,               // each arm is a rounded bar this wide
    swing: +(globalThis.WIPER_SWING ?? 0.87),   // radians either side of straight down (50 degrees)
    period: +(globalThis.WIPER_PERIOD ?? 2.5),  // seconds for one full swing, left to right and back
    // A coin drifts down through the wipers' reach no faster than this. At
    // full speed it was through in a tenth of a second - the arms barely
    // moved meanwhile, and half the coins fell between them untouched.
    drift: +(globalThis.WIPER_DRIFT ?? 25),     // cm/s - fast enough that a coin rolls off an arm cleanly
    // The slot lets a coin go when the arms are swung out far enough to meet
    // it - a fraction of a second's wait at most, and the player's tap is at a
    // random moment anyway. Swinging slowly, the arms spend long enough near
    // straight down that 1 coin in 4-5 slipped through untouched otherwise.
    // One drop in 25 goes regardless: now and then a clean pass-through.
    release: +(globalThis.WIPER_RELEASE ?? 0.3),   // radians from straight down, and swinging further out...
    releaseAny: 0.7,          // ...or this far out, whichever way they are swinging
    anyway: 0.04,             // chance a coin is let go whatever the arms are doing
  };
  // a new coin's lowest point is above the highest any arm can reach
  const inY = guards.pivotY + S / 2 + guards.width / 2 + 0.2;
  const board = dropBoard(x0, x1, xc, exitY, topY, back, gap, guards);
  return { x0, x1, xc, zc, gap, exitY, topY, inY, guards, board, scrapeZ: back, parts: [glass, panel] };
}

/**
 * The board a coin falls down after the wipers, between the back panel and
 * the glass. Across the bottom, three wheels - red, yellow, green - and four
 * gaps: between the wheels and either side of them. Those are the only ways
 * out, seven in all.
 *
 * Each wheel is a main drop point: a funnel on top and a channel straight
 * through the middle, so a coin landing in the funnel drops through the
 * wheel and is counted. A coin landing on a wheel's shoulder, outside the
 * funnel, rolls off into the gap beside it - a minor drop point.
 *
 * Pins above scatter the coins on the way down. Every pin stands at least
 * a coin's width and a little clear of every other part - the wipers'
 * whole swing included - so nothing can ever pinch a coin.
 */
function dropBoard(x0, x1, xc, exitY, topY, back, gap, G) {
  const W = x1 - x0;
  const R = +(globalThis.BOARD_WHEEL ?? 3.3);          // wheel radius
  const channel = S + 0.6;                    // through the middle: a coin with a little play
  // the gaps between the wheels, at their narrowest; the two outside ones
  // take whatever width is left
  const g = +(globalThis.BOARD_GAP ?? 3.0);
  const d = 2 * R + g;                        // wheel to wheel
  const cy = exitY + 0.3 + R;                 // the wheels stand on the box's bottom edge
  // The board's parts reach well into the back panel and right through the
  // glass, out of sight. Only as deep as the slot, a coin overlapping one
  // was pushed out through its own face, toward the glass; holding it in
  // the slot undid that every step, and it fell straight through the part.
  const zA = back - 2, zB = back + gap + 0.5;
  // the funnel: from this far round the rim, the top slopes down to the channel
  const FUNNEL = 52 * Math.PI / 180, LIP = 1.2;
  const wheels = ['red', 'yellow', 'green'].map((colour, i) => {
    const cx = xc + (i - 1) * d;
    // two halves, either side of the channel, each one convex: the rim from
    // the funnel's edge round to the bottom, up the channel, and back along
    // the funnel's slope
    const bottom = Math.PI - Math.asin(channel / 2 / R);
    const outline = [];
    for (let s = 0; s <= 10; s++) {
      const a = FUNNEL + (bottom - FUNNEL) * s / 10;
      outline.push([R * Math.sin(a), R * Math.cos(a)]);
    }
    outline.push([channel / 2, LIP]);
    const flat = [-1, 1].map(side => (side < 0 ? outline.slice().reverse() : outline).map(([px, py]) => [cx + side * px, cy + py]));
    const halves = flat.map(F => F.flatMap(([x, y]) => [x, y, zA, x, y, zB]));
    return { i, colour, cx, cy, r: R, channel, lip: LIP, halves, flat };
  });
  // Pins in pairs either side of the middle: across, as a share of half the
  // board's width, and down from its top, cm. Found by trying a few hundred
  // layouts (each leaving a coin room to pass everywhere) for the one that
  // spread coins most evenly across the ways out.
  const pin = 0.3, half = W / 2;
  const pins = [];
  for (const [across, down] of [[0.542, 11.73], [0.314, 12.78], [0.521, 7.22], [0.716, 9.29], [0.774, 6.09]]) {
    for (const k of across ? [-1, 1] : [0]) pins.push({ x: xc + k * half * across, y: topY - down, r: pin });
  }
  return { wheels, pins, zA, zB };      // plain data: it is sent to the drawing thread as it is
}

/**
 * Invisible stop blocks round the outside of the machine - the "clip"
 * walls of a game like Counter-Strike. A physics engine can always be
 * beaten: a coin squeezed against a wall by a pusher, which nothing can
 * stop, is pushed into the wall, and if the wall is thin - the front glass
 * is 4 mm - it comes out the far side. With a thick block behind every
 * outside face, the quickest way out for a coin pushed in is always back
 * into the machine. A lid over the top means nothing ever leaves that way
 * either. They are never drawn.
 */
function stopBlocks(statics, lo, hi, floorY) {
  const T = 12;                                                  // cm thick
  const glass = statics.filter(s => s.kind === 'glass' && s.h[0] * 2 > (hi[0] - lo[0]) * 0.9);
  const front = glass.length ? Math.max(...glass.map(s => s.c[2] + s.h[2])) : hi[2];
  const lid = hi[1] + 0.6;
  const box = (x0, x1, y0, y1, z0, z1) => ({ kind: 'clip', c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
                                             h: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2] });
  const X0 = lo[0] - T, X1 = hi[0] + T, Y0 = floorY - T, Y1 = lid + T, Z0 = lo[2] - T, Z1 = front + T;
  return [
    box(X0, lo[0], Y0, Y1, Z0, Z1),          // left
    box(hi[0], X1, Y0, Y1, Z0, Z1),          // right
    box(X0, X1, Y0, Y1, Z0, lo[2]),          // back
    box(X0, X1, Y0, Y1, front, Z1),          // in front of the glass
    box(X0, X1, lid, Y1, Z0, Z1),            // the lid
    box(X0, X1, Y0, floorY, Z0, Z1),         // under the tray
  ];
}

/** Add batches of extra blocks, rails and marks to a layout: blocks into
 *  empty space only. */
export function withAdditions(layout, additions) {
  const out = { ...layout, blocks: [...layout.blocks], rails: [...(layout.rails || [])], marks: [...(layout.marks || [])] };
  const have = new Set(out.blocks.map(b => key(b.i, b.j, b.k)));
  const pt = p => ({ x: p[0], y: p[1], z: p[2] });
  for (const d of additions.batches ?? [additions]) {
    for (const b of d.blocks || []) if (!have.has(key(b.i, b.j, b.k))) { out.blocks.push(b); have.add(key(b.i, b.j, b.k)); }
    for (const r of d.rails || []) out.rails.push({ from: pt(r.a), to: pt(r.b), across: r.r * 2 });
    for (const m of d.marks || []) out.marks.push({ type: m.type, name: m.label, at: pt(m.at),
      ...(m.area ? { area: { from: pt(m.area.a), to: pt(m.area.b) } } : {}) });
  }
  return out;
}
