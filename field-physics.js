import { CFG } from './config.js?v=15';   // keep the ?v in step with app.js
import { coinCollider } from './physics.js?v=15';

/* ------------------------------------------------------------------ *
 *  The new field's physics, built from the block layout (machine.js).
 *  No renderer, no DOM - it runs under Node, which is how it is tested.
 *
 *  Built around one idea: a coin that is not moving should cost nothing.
 *
 *  The physics engine has its own sleep, but it never kicks in here. Every
 *  coin in a pile touches its neighbours, so the whole carpet is one
 *  connected group - and while a pusher is moving any of it, the engine
 *  counts all of it as moving. In the old machine 387 of 394 coins were
 *  being worked on every step, resting or not.
 *
 *  So this does it by hand. A coin that has sat still for a moment, and is
 *  nowhere near a pusher, is FROZEN: turned into a fixed part of the
 *  scenery. It still holds up and blocks the coins around it, and it still
 *  looks exactly the same, but the solver no longer works on it. When
 *  something shoves it hard enough to have moved it, the engine reports the
 *  force and it is thawed on the spot - along with anything stacked on it,
 *  so nothing is left hanging in the air.
 *
 *  It is a game, not a physics exam: the pile still slides, spills and
 *  clatters where you can see it, and the rest simply waits its turn.
 * ------------------------------------------------------------------ */

const CHUTE_SIDE = +(globalThis.BOARD_SIDE ?? 70);   // cm/s - the fastest a coin may go sideways in the box
const CHUTE_SPEED = 45;   // cm/s - the fastest a coin may fall inside the drop box
const PUSHER_GRIP = 0.45;   // friction of a pusher's surfaces (decks are 0.8)
const CCD_FALL = 60;      // cm/s - falling faster than this, a coin gets full collision checks
/* Coins are a flat square to the solver - far cheaper than a round disc,
 * and in a pile nobody can tell. But a square cannot roll: off a wiper it
 * slid and sat there, and landing on its edge it stood up on a flat side
 * like a domino. So a coin is a true disc from the moment the slot lets it
 * go until it is lying (nearly) flat again on the pusher - only the few in
 * flight at a time pay for it. Same footprint, same weight. */
const ROUND_UNTIL_TILT = 0.42;   // radians off flat: lying flatter than this, back to a square
const ROUND_AT_MOST = 10;        // s after leaving the box: square again, unless still up on its edge
const EDGE_TIP = 2;              // s any coin may stand still on its edge before the shake topples it
const STANDING_TIP = 0.6;        // s balanced on its rim after landing, then the machine's shake tips it
const SURFACE_DEPTH = 2.4;  // cm - pressed less than this into a surface: lift it back on top
const LANDING_SPEED = 20;  // cm/s - from the bottom of the box down onto the pusher
const PIN_BOUNCE = 0.35;  // the board's pins are livelier than anything else
const UNSTICK = 0.03;
// The outlets (machine.js, findOutlets). A coin supply shoots coins out in a
// quick stream, each a little off straight, up or down and to either side,
// the way a real hopper does; most land on the side pusher below it. A ball
// outlet lets a ball roll gently out, so balls gather by the outer wall.
const SHOT_GAP = +(globalThis.SHOT_GAP ?? 0.2);              // s between coins out of one coin supply: 5 a second
const SHOT_SPEED = +(globalThis.SHOT_SPEED ?? 86);           // cm/s, give or take 15%: most clear the pusher and land on the static field
const SHOT_UP = [-8, +(globalThis.SHOT_UP ?? 18)];           // degrees above level, lowest..highest
const SHOT_SIDE = +(globalThis.SHOT_SIDE ?? 27.5);           // degrees either side of straight out: a 55 degree fan (60 sent some over into the middle lane)
// Some coins catch the outlet's lip on the way out and just drop, by the wall.
const SHOT_DRIBBLE = +(globalThis.SHOT_DRIBBLE ?? 0.12);      // share of coins
const DRIBBLE_SPEED = [8, 22];                                // cm/s
// ...and they come out every which way: on their edge rolling, flat, slanted.
const SHOT_ON_EDGE = 0.25, SHOT_SLANT = 0.25;                 // shares; the rest come out flat
const BALL_R = 2.2;          // cm: just under the ball outlet's 4.8 cm opening
const BALL_DENSITY = 0.45;   // a ball weighs about five coins
const BALL_ROLL = 6;         // cm/s it rolls out at
const MAX_BALLS = 24;
// Like a real hopper, the coin supplies only have so much to give: with this many
// coins in play they hold their queue until some have paid out. Prizes cannot
// pile coins up past what a phone can simulate: on Rapier 0.21 SIMD, ~23 ms a
// step at 1,350 coins, ~31 at 1,500, ~40 at 1,700 (budget 33; test/capacity.mjs).
// The cabinet itself holds no more than ~1,800 before coins overflow.
const FIELD_CAP = 1350;
const BALL_HOLD = 1.5;       // s a counted ball stays in the drop area before it is cleared
export const BALL_RADIUS = BALL_R;
const DEG = Math.PI / 180;
const S_BLOCK = 2.4;         // one block, cm     // cm: overlap a coin in the board may have before it is put back out
const CHUTE_STUCK = 3;    // s - in the box this long and it is stuck: flick it. The wipers
                          // keep coins moving; 1.2 s (the old chute's) flicked coins that
                          // were only drifting slowly past them

/* Looking ahead for collisions ("soft CCD") stops a fast coin slipping
 * through a neighbour between steps - but it costs on every coin, and a
 * coin creeping along in the pile does not need it. Only coins moving
 * faster than this get it: 10% off every step, same play, none lost
 * (test/agent-lab.mjs). With it off altogether, 9 coins were lost. */
const CCD_FAST = 30, CCD_AHEAD = CFG.coinR * 1.5;

export const FREEZE = {
  after:     0.25,   // seconds a coin must sit still before it freezes
  speed:     1.2,    // cm/s - slower than this counts as still
  spin:      0.8,    // rad/s - and turning slower than this
  push:      6,      // thaw when shoved sideways by this many times what it takes
                     // to slide a coin. Set well clear of what a resting pile
                     // leans with: in a pile three deep, the weight of the coins
                     // above, on a tilt, is a sideways push of a few coins' worth,
                     // and at 2.5 that alone thawed 250 coins a second
  slam:      10,     // ...or hit from any direction by this many coin-weights
  wave:      1.5,    // cm/s - a coin moving faster than this thaws the frozen
                     // coins in its path, so a push travels through the pile
                     // the way it does through a real one. Without this a
                     // frozen carpet is a wall: in testing, 60 coins played
                     // and not one came out the front
  touch:     2.7,    // cm - "in its path": centres this close, in front of it
  // mode 'creep': judge stillness over a whole pusher stroke instead. A
  // pushed carpet does not move in shoves, it creeps - a fraction of a
  // millimetre a stroke - and a coin that is creeping must never freeze.
  creep:     0.04,   // cm - moved less than this over a full stroke: frozen
  creepWave: 0.35,   // cm/s - in creep mode, this slow already thaws what it runs into
  reach:     2.3,    // cm - thawing a coin also thaws the frozen coins resting
                     // on top of it: higher up, and overlapping it from above.
                     // NOT its neighbours at the same height - in a packed
                     // carpet that spread from coin to coin across the whole
                     // pile, and everything thawed every step
};

export function createField(RAPIER, M, opts = {}) {
  const hz      = opts.hz ?? 30;
  const iters   = opts.iterations ?? 4;
  const shape   = opts.shape ?? 'box';
  // Off by default. Measured: under play nearly the whole deck carpet is
  // creeping, and every way of freezing coins that saved real time either
  // stopped the payout dead or barely saved anything (test/field-play.mjs).
  const freeze  = opts.freeze ?? false;
  const mode    = opts.freezeMode ?? 'creep';
  const max     = opts.maxCoins ?? 1700;      // the coin pool: the cap, plus coins in the tray and in flight
  const boardFall = opts.boardFall ?? CHUTE_SPEED;   // cm/s, the fastest a coin falls in the drop box
  const period  = opts.period ?? CFG.period;

  const world = new RAPIER.World({ x: 0, y: CFG.gravity, z: 0 });
  world.timestep = 1 / hz;
  world.numSolverIterations = iters;
  // Rapier 0.21 (the engine.js builds) has a newer solver with its own
  // tolerances. This machine is in cm, the engine assumes metres: told the
  // unit is 10 and given stiffer contacts, it needs the safety net least and
  // the pile still creeps (test/archive/engine notes in PLAN.md).
  const newSolver = 'contact_natural_frequency' in Object.getPrototypeOf(world.integrationParameters);
  if (newSolver) {
    world.lengthUnit = opts.lengthUnit ?? 10;
    world.integrationParameters.contact_natural_frequency = opts.contactHz ?? 960;
    // contacts counted from 0.1 cm apart, not 0.2: ~7% less work in a packed pile, same play
    world.integrationParameters.normalizedPredictionDistance = opts.predict ?? 0.01;
  } else if (opts.lengthUnit) world.lengthUnit = opts.lengthUnit;
  // any other engine setting, by name (for tuning): { normalizedAllowedLinearError: .., contact_erp: .. }
  for (const [k, v] of Object.entries(opts.engine || {})) world.integrationParameters[k] = v;
  const events = new RAPIER.EventQueue(true);

  /* ---- the machine ---- */
  const kindOf = new Map();
  const fixed = () => world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const add = (desc, body, kind, mu = CFG.deckFriction) =>
    kindOf.set(world.createCollider(desc.setFriction(mu).setRestitution(CFG.restitution), body).handle, kind);

  for (const s of M.statics) add(RAPIER.ColliderDesc.cuboid(...s.h).setTranslation(...s.c), fixed(), s.kind, s.mu ?? (s.kind === 'glass' ? 0.2 : (s.kind === 'deck' || s.playfield) ? CFG.playfieldFriction : CFG.deckFriction));
  // (the board's wheels are slippery, so a coin on a funnel slides in)
  for (const h of M.hulls) add(RAPIER.ColliderDesc.convexHull(new Float32Array(h.points)), fixed(), h.kind,
                               h.mu ?? (h.kind === 'ramp' ? 0.25 : h.kind === 'wheel' ? 0.08 : CFG.deckFriction));
  for (const r of M.rails) {
    const d = [0, 1, 2].map(a => r.b[a] - r.a[a]), len = Math.hypot(...d), u = d.map(v => v / len);
    const ax = [u[2], 0, -u[0]], s = Math.hypot(...ax), half = Math.acos(Math.max(-1, Math.min(1, u[1]))) / 2;
    const q = s < 1e-9 ? { x: 0, y: 0, z: 0, w: 1 }
      : { x: ax[0] / s * Math.sin(half), y: 0, z: ax[2] / s * Math.sin(half), w: Math.cos(half) };
    add(RAPIER.ColliderDesc.capsule(len / 2, r.r).setRotation(q)
      .setTranslation((r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2, (r.a[2] + r.b[2]) / 2), fixed(), 'rail', 0.3);
  }

  // Each pusher is its own moving body. The centre one and the side ones
  // run half a cycle apart, so the machine never lurches all at once.
  const pushers = M.pushers.map(p => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    // A pusher's top grips well enough that coins ride with every stroke (it
    // never accelerates hard) but lets a coin the wall is scraping slide,
    // rather than dragging it into the corner where wall meets pusher.
    for (const b of p.boxes) add(RAPIER.ColliderDesc.cuboid(...b.h).setTranslation(...b.c), body, 'pusher', PUSHER_GRIP);
    const mid = (p.x0 + p.x1) / 2, width = M.bounds.hi[0] - M.bounds.lo[0];
    return {
      ...p, body, z: 0,
      phase: Math.abs(mid - (M.bounds.lo[0] + M.bounds.hi[0]) / 2) < width * 0.1 ? 0 : Math.PI,
      // Coins riding on top of a pusher are never frozen: they go where it
      // goes, and a frozen coin would hang in the air while the pusher slid
      // away underneath it.
      riding: { x0: p.x0 - 0.5, x1: p.x1 + 0.5, y0: p.top - 0.6, y1: p.top + 5,
                z0: p.back - p.stroke, z1: p.front + p.stroke },
      // Coins in front of it may freeze while it is pulled back - they are
      // just lying there - and are thawed as its face comes up to them.
      sweep: { x0: p.x0 - 1.5, x1: p.x1 + 1.5, y0: p.bottom - 1, y1: p.top + 1 },
    };
  });
  const inside = (t, Z) => t.x > Z.x0 && t.x < Z.x1 && t.y > Z.y0 && t.y < Z.y1 && t.z > Z.z0 && t.z < Z.z1;
  const nearPusher = t => pushers.some(p => inside(t, p.riding));

  /* ---- the drop box's two wipers ----
   * Each is a rounded bar hanging from a pivot, as a moving body turning
   * about that pivot. Both always at the same angle. */
  const ch = M.chute;
  const guards = ch ? [-1, 1].map(side => {
    const G = ch.guards;
    const cx = ch.xc + side * G.spacing / 2, cy = G.pivotY;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(cx, cy, ch.zc));
    // Rounded at the edges a coin can touch, and deep front to back - into
    // the back panel and through the glass - so a coin it overlaps is always
    // pushed out sideways, never through its own face (see the board, below).
    const B = ch.board, r = G.width / 2, deep = (B.zB - B.zA) / 2 - r;
    add(RAPIER.ColliderDesc.roundCuboid(0.001, (G.length - G.width) / 2, deep, r)
          .setTranslation(0, -G.length / 2, (B.zA + B.zB) / 2 - ch.zc), body, 'guard', 0.15);
    return { body, cx, cy, side };
  }) : [];
  /* ---- the board under the wipers: pins, and three wheels to drop through ---- */
  const board = ch?.board;
  if (board) {
    // round metal posts from the panel to the glass (a cylinder stands along
    // y; turned a quarter about x, it runs along z). Lively, like pachinko pins.
    const along = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
    for (const p of board.pins) {
      const desc = RAPIER.ColliderDesc.cylinder((board.zB - board.zA) / 2, p.r).setRotation(along)
        .setTranslation(p.x, p.y, (board.zA + board.zB) / 2);
      kindOf.set(world.createCollider(desc.setFriction(0.1).setRestitution(PIN_BOUNCE), fixed()).handle, 'pin');
    }
  }
  /* A coin in the board moves only in the slot's plane, so if it is ever
   * found overlapping a pin, a wheel or a wiper, the way out is in that plane
   * too: put it back on the surface, and take away the part of its speed that
   * was carrying it in. The stop-box idea, for the board - and it costs next
   * to nothing, with only the coin or two falling at any moment to check. */
  const R_COIN = CFG.coinR;
  function unstick(c, t) {
    let px = t.x, py = t.y, moved = false;
    const v = c.body.linvel();
    let vx = v.x, vy = v.y;
    const out = (nx, ny, depth) => {        // depth > 0: overlapping that much
      px += nx * depth; py += ny * depth; moved = true;
      const vn = vx * nx + vy * ny;
      if (vn < 0) { vx -= nx * vn * 1.2; vy -= ny * vn * 1.2; }
    };
    for (const p of board.pins) {
      const dx = px - p.x, dy = py - p.y, d = Math.hypot(dx, dy) || 1e-6, depth = R_COIN + p.r - d;
      if (depth > UNSTICK) out(dx / d, dy / d, depth);
    }
    for (const w of board.wheels) for (const P of w.flat) {
      const [nx, ny, dist] = fromOutline(px, py, P);
      if (R_COIN - dist > UNSTICK) out(nx, ny, R_COIN - dist);
    }
    const G = ch.guards, wa = wiperAngle(), s = Math.sin(wa), k = -Math.cos(wa);
    for (const g of guards) {
      const r0 = G.width / 2, r1 = G.length - G.width / 2;
      const ax = g.cx + s * r0, ay = g.cy + k * r0, bx = g.cx + s * r1, by = g.cy + k * r1;
      const ex = bx - ax, ey = by - ay, u = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey)));
      const dx = px - ax - u * ex, dy = py - ay - u * ey, d = Math.hypot(dx, dy) || 1e-6, depth = R_COIN + G.width / 2 - d;
      if (depth > UNSTICK) out(dx / d, dy / d, depth);
    }
    if (!moved) return;
    f.unstuck++;
    c.body.setTranslation({ x: px, y: py, z: ch.zc }, false);
    c.body.setLinvel({ x: vx, y: vy, z: 0 }, true);
  }
  // From a point to a convex outline: the way out (a unit vector) and how
  // far the outline's surface is - below zero when the point is inside it.
  function fromOutline(x, y, P) {
    let best = Infinity, bx = 0, by = 0, sign = 0, inside = true, edge = 0, edgeD = Infinity;
    for (let n = 0; n < P.length; n++) {
      const [ax, ay] = P[n], [cx, cy] = P[(n + 1) % P.length];
      const ex = cx - ax, ey = cy - ay, len = Math.hypot(ex, ey);
      const u = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (len * len)));
      const qx = ax + u * ex, qy = ay + u * ey, d = Math.hypot(x - qx, y - qy);
      if (d < best) { best = d; bx = qx; by = qy; }
      const cr = ex * (y - ay) - ey * (x - ax);
      if (cr) { const sg = Math.sign(cr); if (!sign) sign = sg; else if (sg !== sign) inside = false; }
      if (Math.abs(cr) / len < edgeD) { edgeD = Math.abs(cr) / len; edge = n; }
    }
    if (!inside) { const d = best || 1e-6; return [(x - bx) / d, (y - by) / d, best]; }
    // inside: out through the nearest edge, along its normal pointing away
    // from the middle of the outline
    const [ax, ay] = P[edge], [cx, cy] = P[(edge + 1) % P.length], len = Math.hypot(cx - ax, cy - ay);
    let nx = (cy - ay) / len, ny = -(cx - ax) / len, mx = 0, my = 0;
    for (const [qx, qy] of P) { mx += qx / P.length; my += qy / P.length; }
    if (nx * ((ax + cx) / 2 - mx) + ny * ((ay + cy) / 2 - my) < 0) { nx = -nx; ny = -ny; }
    return [nx, ny, -edgeD];
  }
  // Which way a coin leaving the board went: 0 the far-left gap ... 6 the
  // far right. Through a wheel if it went down that wheel's channel; if not,
  // the gap on its side of the nearest wheel. (Where it leaves is no guide:
  // a coin rolling off a wheel's shoulder drops past underneath the wheel.)
  const exitOf = (x, wheel) => {
    if (wheel !== null) return 1 + 2 * wheel;
    const w = board.wheels.reduce((a, b) => (Math.abs(b.cx - x) < Math.abs(a.cx - x) ? b : a));
    return x < w.cx ? 2 * w.i : 2 * w.i + 2;
  };
  // in a wheel's channel, below its funnel: going through it
  const wheelAt = t => board?.wheels.find(w => Math.abs(t.x - w.cx) < w.channel / 2 && t.y < w.cy + w.lip && t.y > w.cy - w.r);
  const inChute = t => ch && t.y > ch.exitY - 0.5 && Math.abs(t.z - ch.zc) < 1.6 && t.x > ch.x0 && t.x < ch.x1;
  // the short drop from the bottom of the box to the pusher: still capped,
  // or a coin hits the pusher's top fast enough to sink into it
  const centreTop = pushers.length ? Math.min(...pushers.map(p => p.top)) : 0;
  const inDrop = t => ch && t.y < ch.exitY && t.y > centreTop + 0.6 && Math.abs(t.z - ch.zc) < 2.2 && t.x > ch.x0 && t.x < ch.x1;

  /* ---- coins: one pool, made once, recycled forever ---- */
  const coins = [], byCollider = new Map();
  for (let i = 0; i < max; i++) {
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, -500, 0)
      .setLinearDamping(CFG.linDamp).setAngularDamping(CFG.angDamp).setCanSleep(true);
    const body = world.createRigidBody(desc);
    const collider = world.createCollider(coinCollider(RAPIER, shape), body);
    body.setEnabled(false);
    const coin = { body, collider, slot: i, live: false, frozen: false, still: 0, paidAt: 0, cell: null, inChute: 0 };
    byCollider.set(collider.handle, coin);
    coins.push(coin);
  }
  const weight = coins[0].collider.mass() * -CFG.gravity;
  const SQUARE = coins[0].collider.shape;
  const DISC = new RAPIER.Cylinder(CFG.colT / 2, CFG.coinR);
  const square = c => { if (c.round) { c.collider.setShape(SQUARE); c.round = false; } };
  // Done by hand each step rather than with the engine's own axis locks:
  // those, mixed with swapping the coin's shape and the moving wipers, blew
  // up - coins flung thousands of cm away and lost.
  const planar = (c, on) => { c.planar = on; };
  const SIDE = Math.SQRT1_2;               // a quarter turn about x: the coin's face toward the glass
  function keepInSlot(c, t) {
    const q = c.body.rotation();
    // the coin's own x axis, as it points now: its turn in the slot's plane
    const lx = 1 - 2 * (q.y * q.y + q.z * q.z), ly = 2 * (q.x * q.y + q.w * q.z);
    const phi = Math.atan2(ly, lx), cz = Math.cos(phi / 2), sz = Math.sin(phi / 2);
    // upright in the slot, turned by phi: (turn phi about z) after (quarter turn about x)
    c.body.setRotation({ x: cz * SIDE, y: sz * SIDE, z: sz * SIDE, w: cz * SIDE }, false);
    c.body.setTranslation({ x: t.x, y: t.y, z: ch.zc }, false);
    const v = c.body.linvel(), w = c.body.angvel();
    c.body.setLinvel({ x: v.x, y: v.y, z: 0 }, false);
    c.body.setAngvel({ x: 0, y: 0, z: w.z }, true);
  }
  const slide = weight * CFG.coinFriction;

  /* Frozen coins, filed by where they are, so thawing one can find what
   * rests on it without looking at every coin in the machine. */
  const grid = new Map();
  const cellOf = (x, z) => Math.floor(x / 3) + ',' + Math.floor(z / 3);

  function doFreeze(c) {
    const t = c.body.translation();
    c.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
    c.collider.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    c.collider.setContactForceEventThreshold(Math.min(slide * FREEZE.push, weight * FREEZE.slam));
    c.frozen = true;
    f.freezes++;
    c.at = t;
    c.cell = cellOf(t.x, t.z);
    if (!grid.has(c.cell)) grid.set(c.cell, new Set());
    grid.get(c.cell).add(c);
    f.frozen++;
  }

  function thaw(c, why = 'push') {
    if (c.frozen) f.why[why] = (f.why[why] || 0) + 1;
    const queue = [c];
    while (queue.length) {
      const cur = queue.pop();
      if (!cur.frozen) continue;
      grid.get(cur.cell)?.delete(cur);
      cur.frozen = false;
      cur.still = 0;
      cur.ref = null;
      cur.collider.setActiveEvents(RAPIER.ActiveEvents.NONE);
      cur.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      f.frozen--;
      f.thaws++;
      // anything frozen sitting on it, or leaning on it, goes too
      const p = cur.at;
      const [gx, gz] = [Math.floor(p.x / 3), Math.floor(p.z / 3)];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const set = grid.get((gx + a) + ',' + (gz + b));
        if (!set) continue;
        for (const o of set) {
          const q = o.at;
          if (q.y > p.y + 0.15 && Math.hypot(q.x - p.x, q.z - p.z) < FREEZE.reach) { if (o.frozen) f.why.stack = (f.why.stack || 0) + 1; queue.push(o); }
        }
      }
    }
  }

  /* ---- nothing gets lost ----
   * Coins only ever leave at the front. Physics engines can still be beaten
   * - a coin pinched between a pusher, which nothing can stop, and a wall
   * will be squeezed out through something solid - so every moving coin is
   * checked against the machine's solid parts, and one found inside a wall,
   * the deck, a pusher or the glass is put back where it last legally was. */
  // How far into something a coin's centre may be before it counts as inside.
  // A coin pressed hard against a surface overlaps it a little - that is
  // normal contact, and must never trigger this. Deeper than these, it has
  // been forced through.
  const SKIN = 0.25, PUSHER_SKIN = 0.7;
  const shrink = (b, k) => [b.c[0] - b.h[0] + k, b.c[0] + b.h[0] - k, b.c[1] - b.h[1] + k,
                            b.c[1] + b.h[1] - k, b.c[2] - b.h[2] + k, b.c[2] + b.h[2] - k];
  const solidBoxes = M.statics.map(b => shrink(b, SKIN));
  const pusherBoxes = pushers.map(p => p.boxes.map(b => shrink(b, PUSHER_SKIN)));
  const ramps = M.hulls.filter(h => h.plane).map(h => h.plane);
  const inBox = (t, b, dz = 0) => t.x > b[0] && t.x < b[1] && t.y > b[2] && t.y < b[3] && t.z > b[4] + dz && t.z < b[5] + dz;
  /** If t is deep inside a pusher, where to put it instead: out of its
   *  front or over its top, whichever is nearer. Those are the only open
   *  sides - behind is the wall, below is the deck, either side the lane
   *  walls - and they move with it, so the coin cannot end up back inside. */
  function outOfPusher(t) {
    for (let n = 0; n < pushers.length; n++) {
      const dz = pushers[n].z;
      for (const b of pusherBoxes[n]) {
        if (!inBox(t, b, dz)) continue;
        const front = b[5] + PUSHER_SKIN + dz, top = b[3] + PUSHER_SKIN;
        return front - t.z < top - t.y ? { x: t.x, y: t.y, z: front + CFG.coinR + 0.2 } : { x: t.x, y: top + 0.4, z: t.z };
      }
    }
    return null;
  }
  /** If t has been pressed a little way down into the top of something it
   *  lies on - the deck, a stage, a ramp - the height of that surface, so it
   *  can simply be lifted back onto it where it is. Otherwise null. */
  function surfaceAbove(t) {
    for (const b of solidBoxes) {
      if (inBox(t, b) && b[3] + SKIN - t.y < SURFACE_DEPTH) return b[3] + SKIN;
    }
    for (const r of ramps) {
      if (t.x > r.from[0] * 2.4 && t.x < r.to[0] * 2.4 && t.z > r.from[1] * 2.4 && t.z < r.to[1] * 2.4) {
        const h = r.a + r.b * t.x + r.c * t.z;
        if (t.y < h - SKIN && h - t.y < SURFACE_DEPTH) return h;
      }
    }
    return null;
  }
  function insideSolid(t) {
    for (const b of solidBoxes) if (inBox(t, b)) return true;
    for (const r of ramps) {
      if (t.x > r.from[0] * 2.4 && t.x < r.to[0] * 2.4 && t.z > r.from[1] * 2.4 && t.z < r.to[1] * 2.4 &&
          t.y < r.a + r.b * t.x + r.c * t.z - SKIN && t.y > 0) return true;
    }
    return false;
  }

  /* ---- towers ----
   * A tower is a stack of coins that gets pushed off the centre pusher and
   * across the deck, and must not fall apart on the way. A real stack of
   * loose discs would wobble and spill at the first nudge, so a tower is
   * ONE solid body - a single cylinder the height of the stack - and it is
   * not allowed to tip. It slides, it drops off the pusher still standing,
   * it shoves through the pile. Only at the front edge is it let go: it
   * tips over the edge and bursts into its loose coins, all of them yours. */
  const towers = [];
  const STACK = CFG.coinT;                 // one coin's thickness in a stack, cm

  const active = [];
  const slot = [];                         // coins dropped in, waiting for the wipers
  const D = M.zones.drop;
  const midX = (M.bounds.lo[0] + M.bounds.hi[0]) / 2;
  const coinOutlets = (M.outlets || []).filter(o => o.kind === 'coin');
  // the coin supply's shot - the defaults above, or what the game asks for
  const fieldCap = opts.fieldCap ?? FIELD_CAP;
  const shot = { speed: opts.shot?.speed ?? SHOT_SPEED, side: opts.shot?.side ?? SHOT_SIDE,
                 gap: opts.shot?.gap ?? SHOT_GAP, dribble: opts.shot?.dribble ?? SHOT_DRIBBLE };
  const ballOutlets = (M.outlets || []).filter(o => o.kind === 'ball');
  // each coin supply's queue: coins still to come out, and when the next one is due
  const supplies = coinOutlets.map(o => ({ o, left: 0, next: 0, onWake: null }));
  /* ---- big balls: a small pool of spheres, made once ---- */
  const balls = [];
  for (let i = 0; i < MAX_BALLS; i++) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, -700 - i * 10, 0)
      .setLinearDamping(CFG.linDamp).setAngularDamping(0.6).setCanSleep(true));
    const collider = world.createCollider(RAPIER.ColliderDesc.ball(BALL_R).setDensity(BALL_DENSITY)
      .setFriction(0.3).setRestitution(0.15), body);
    body.setEnabled(false);
    balls.push({ body, collider, slot: i, live: false, inAt: 0 });
  }
  const parkBall = b => {
    if (b.emerge) { b.body.setBodyType(RAPIER.RigidBodyType.Dynamic, false); b.emerge = null; }
    b.body.setEnabled(false);
    b.body.setTranslation({ x: 0, y: -700 - b.slot * 10, z: 0 }, false);
    b.live = false;
  };
  // positive turns a hanging arm's tip toward +x (to the right)
  const wiperAngle = (at = f.elapsed) => ch ? ch.guards.swing * Math.sin(at / ch.guards.period * Math.PI * 2) : 0;

  /** Towers: hold them upright until the front edge, shove the pile
   *  aside in front of them, and burst them into coins over the edge. */
  function stepTowers(onCollected) {
    for (let i = towers.length - 1; i >= 0; i--) {
      const T = towers[i];
      const t = T.body.translation(), v = T.body.linvel();
      // nearly at the front edge, with nothing under its far side: let it tip
      if (T.standing && t.z > D.z0 - CFG.coinR * 0.5 && t.x > D.x0 && t.x < D.x1) {
        T.standing = false;
        T.body.lockRotations(false, true);
      }
      // gone over: it bursts into its coins, already paid for
      if (t.y < D.y && t.z > D.z0 - 1) {
        f.won += T.n;
        f.towersWon++;
        const q = T.body.rotation();
        for (let k = 0; k < T.n; k++) {
          const c = f.take();
          if (!c) break;
          const up = (k + 0.5) * STACK - T.h / 2;
          const s = Math.random() * Math.PI;
          f.wakeAt(c, [t.x + (Math.random() - 0.5) * 0.8, t.y + up, t.z + (Math.random() - 0.5) * 0.8, 0, Math.sin(s / 2), 0, Math.cos(s / 2)]);
          c.body.setLinvel({ x: v.x + (Math.random() - 0.5) * 12, y: v.y, z: v.z + Math.random() * 8 }, true);
          c.paidAt = f.elapsed;
        }
        if (onCollected) onCollected(T, true, T.n);
        world.removeRigidBody(T.body);
        towers.splice(i, 1);
        continue;
      }
      // the pile in front of a moving tower makes way for it
      const flat = v.x * v.x + v.z * v.z;
      if (freeze && f.frozen && flat > FREEZE.wave * FREEZE.wave) {
        const gx = Math.floor(t.x / 3), gz = Math.floor(t.z / 3);
        for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
          const set = grid.get((gx + a) + ',' + (gz + b));
          if (!set) continue;
          for (const o of set) {
            const q = o.at, dx = q.x - t.x, dz = q.z - t.z;
            if (Math.abs(q.y - t.y) < T.h / 2 + 1 && dx * dx + dz * dz < (CFG.coinR * 2 + 0.6) ** 2 && dx * v.x + dz * v.z > 0) thaw(o, "tower");
          }
        }
      }
      if ((insideSolid(t) || outOfPusher(t)) && T.safe) {
        T.body.setTranslation({ x: T.safe.x, y: T.safe.y + 0.3, z: T.safe.z }, true);
        T.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        f.rescues++;
      } else {
        T.safe = t;
      }
      if (t.y < -10) { world.removeRigidBody(T.body); towers.splice(i, 1); f.lost += T.n; }
    }
  }

  const f = {
    world, coins, active, pushers, kindOf, weight, towers, towersWon: 0,
    wheels: [0, 0, 0], exits: new Array(7).fill(0), unstuck: 0, toppled: 0,
    balls, ballsIn: 0, ballsLost: 0, outlets: M.outlets || [],
    supplyLeft: () => supplies.map(q => q.left),        // coins still to come out of each coin supply     // coins through each wheel; out of each of the board's 7 ways
    elapsed: 0, won: 0, lost: 0, frozen: 0, thaws: 0, freezes: 0, moving: 0, why: {}, nudges: 0, rescues: 0, lifts: 0, rescueLog: [], guards,

    setRate(newHz) { world.timestep = 1 / newHz; },

    take() {
      for (let i = 0; i < coins.length; i++) if (!coins[i].live) return coins[i];
      return null;
    },

    /** Put a coin in play at an exact transform [x, y, z, qx, qy, qz, qw]. */
    wakeAt(c, t, frozen = false) {
      c.body.setBodyType(RAPIER.RigidBodyType.Dynamic, false);
      c.body.setEnabled(true);
      c.body.setTranslation({ x: t[0], y: t[1], z: t[2] }, false);
      c.body.setRotation({ x: t[3], y: t[4], z: t[5], w: t[6] }, false);
      c.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
      c.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      c.body.wakeUp();
      c.live = true;
      c.frozen = false;
      c.still = 0;
      c.ref = null;
      c.paidAt = 0;
      c.inChute = 0;
      c.safe = null;
      if (c.ccd) { c.body.enableCcd(false); c.ccd = false; }
      active.push(c);
      if (frozen) doFreeze(c);
      return c;
    },

    park(c) {
      square(c);
      planar(c, false);
      if (c.frozen) { grid.get(c.cell)?.delete(c); c.frozen = false; f.frozen--; }
      c.collider.setActiveEvents(RAPIER.ActiveEvents.NONE);
      c.body.setBodyType(RAPIER.RigidBodyType.Dynamic, false);
      c.body.setEnabled(false);
      c.body.setTranslation({ x: 0, y: -500, z: 0 }, false);
      c.live = false;
      c.paidAt = 0;
      const i = active.indexOf(c);
      if (i !== -1) active.splice(i, 1);
    },

    /** Drop a coin in, moving at velocity v. */
    drop(x, y, z, v = { x: 0, y: 0, z: 0 }, onWake) {
      const c = f.take();
      if (!c) return null;
      const s = Math.random() * Math.PI;
      f.wakeAt(c, [x, y, z, 0, Math.sin(s / 2), 0, Math.cos(s / 2)]);
      c.body.setLinvel(v, true);
      // launched fast: full collision checks from its very first step, not
      // its second - by then a fast enough coin is already through a wall
      if (v.x * v.x + v.y * v.y + v.z * v.z > CCD_FALL * CCD_FALL) { c.body.enableCcd(true); c.ccd = true; }
      if (onWake) onWake(c);
      return c;
    },

    /** Fire every coin supply: n coins out of each, one after another. */
    supply(n = 10, onWake) {
      // pressed again while it is still going: more coins in the same queue,
      // not a second stream alongside it
      for (const q of supplies) {
        if (!q.left) q.next = f.elapsed;
        q.left += n;
        if (onWake) q.onWake = onWake;
      }
      return supplies.length * n;
    },

    /** One ball out of every ball outlet, rolling gently out of it. */
    ball(onWake) {
      let n = 0;
      for (const o of ballOutlets) {
        const b = balls.find(x => !x.live);
        if (!b) break;
        const off = (Math.random() - 0.5) * Math.max(0, o.width - 2 * BALL_R) * 0.6;
        // It starts hidden inside the outlet and rolls out of its mouth on a
        // set path - inside a solid block the physics would fling it out -
        // then carries on under the physics at the same speed and spin.
        // as deep inside as the solid behind the face allows, without poking out the back
        const inside = Math.min(BALL_R + 0.1, Math.max(0, (o.depth ?? 2 * S_BLOCK) - BALL_R - 0.05)), clear = BALL_R + 0.15;
        const x = o.mouth[0] - o.dir[0] * inside + o.across[0] * off;
        const z = o.mouth[2] - o.dir[2] * inside + o.across[2] * off;
        const y = o.bottom + BALL_R + 0.05;
        b.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        b.body.setTranslation({ x, y, z }, true);
        b.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        b.body.setEnabled(true);
        const v = BALL_ROLL * (0.7 + Math.random() * 0.6), wob = (Math.random() - 0.5) * 2;
        b.emerge = { o, x, y, z, v, wob, dist: inside + clear, t0: f.elapsed };
        b.live = true;
        b.inAt = 0;
        if (onWake) onWake(b);
        n++;
      }
      return n;
    },

    /** Drop a coin into the slot. It falls into the box when the wipers
     *  are ready for it (see machine.js, guards.release) - at once, or a
     *  fraction of a second later. Returns false if the machine is full. */
    insert(onWake) {
      if (!ch) return false;
      if (active.length + slot.length >= coins.length) return false;
      slot.push({ onWake, anyway: Math.random() < ch.guards.anyway, at: f.elapsed });
      return true;
    },

    /** Let a coin into the top of the drop box, standing on its edge,
     *  facing the glass. */
    release(onWake) {
      if (!ch) return null;
      const c = f.take();
      if (!c) return null;
      const s = Math.SQRT1_2;
      // between the wipers, but not dead centre: a little to one side or the
      // other, as a real coin drops - so one wiper is usually close enough to
      // brush it even when both are near straight down
      const G = ch.guards, room = Math.max(0, (G.spacing - G.width) / 2 - CFG.coinR - 0.1);
      const off = Math.min(1.1, room) * (0.35 + Math.random() * 0.65) * (Math.random() < 0.5 ? -1 : 1);
      f.wakeAt(c, [ch.xc + off, ch.inY, ch.zc, s, 0, 0, s]);
      c.wheel = null;
      c.exit = null;
      if (shape !== 'cylinder') { c.collider.setShape(DISC); c.round = true; c.outAt = 0; }
      // In the slot - one coin thick - a coin can only move in the slot's
      // plane: down, sideways, and turning like a wheel. A wiper's rounded
      // arm otherwise pushed it sideways into the glass or the back panel,
      // where it wedged against the moving arm and seemed stuck to it -
      // 21 coins in 120, up to 3 mm into the glass.
      planar(c, true);
      // Falling the height of the box, a coin hits the pusher at several cm
      // per step - enough to pass into its solid top between two steps and be
      // carried out through the back wall. Full collision checking until it
      // has landed stops that.
      c.body.enableCcd(true);
      c.ccd = true;
      if (onWake) onWake(c);
      return c;
    },

    /** Put a tower of n coins on the centre pusher's top - x, z in cm, or by
     *  default in the middle, a little in from the back. */
    tower(n, x, z, onWake) {
      const centre = pushers.reduce((a, p) => (p.top < a.top ? p : a));
      const h = n * STACK;
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x ?? (centre.x0 + centre.x1) / 2, centre.top + h / 2 + 0.05, (z ?? centre.back + 3) + centre.z)
        .setLinearDamping(CFG.linDamp).setAngularDamping(CFG.angDamp).setCanSleep(false));
      body.lockRotations(true, true);
      const collider = world.createCollider(RAPIER.ColliderDesc.cylinder(h / 2, CFG.coinR)
        .setFriction(CFG.coinFriction).setRestitution(CFG.restitution)
        .setDensity(coins[0].collider.mass() / (Math.PI * CFG.coinR * CFG.coinR * STACK)), body);
      body.enableCcd(true);
      const t = { body, collider, n, h, standing: true, safe: null };
      towers.push(t);
      if (onWake) onWake(t);
      return t;
    },

    /** Where the guards are, for drawing them. */
    guardAt(g) {
      return { x: g.cx, y: g.cy, z: ch.zc, ang: wiperAngle() };
    },

    /** A recorded pile: [x, y, z, qx, qy, qz, qw] per coin. Loaded frozen -
     *  it was at rest when it was recorded - except near the pushers. */
    seedFrom(pile, onWake) {
      for (let i = active.length - 1; i >= 0; i--) f.park(active[i]);
      // the pushers have to be where they were when it was recorded, or the
      // coins resting on them start out inside them
      f.elapsed = pile.elapsed ?? 0;
      for (const p of pushers) {
        p.z = (1 - Math.cos(f.elapsed / period * Math.PI * 2 + p.phase)) / 2 * p.stroke;
        p.body.setTranslation({ x: 0, y: 0, z: p.z }, true);
      }
      for (const t of pile.coins) {
        const c = f.take();
        if (!c) break;
        f.wakeAt(c, t, freeze && !nearPusher({ x: t[0], y: t[1], z: t[2] }));
        if (onWake) onWake(c);
      }
      return active.length;
    },

    /** Everything at rest right now, as a pile that seedFrom() can load. */
    record() {
      return { elapsed: Math.round(f.elapsed * 1e4) / 1e4, coins: f.recordCoins() };
    },
    recordCoins() {
      return active.map(c => {
        const t = c.body.translation(), q = c.body.rotation();
        return [t.x, t.y, t.z, q.x, q.y, q.z, q.w].map(v => Math.round(v * 1e4) / 1e4);
      });
    },

    /**
     * One fixed physics step. onMoved fires for every coin that can have
     * moved - frozen coins cannot, and they are most of the pile.
     */
    step(onMoved, onCollected) {
      f.elapsed += world.timestep;
      const tick = Math.round(f.elapsed / world.timestep);      // steps so far
      for (const p of pushers) {
        p.z = (1 - Math.cos(f.elapsed / period * Math.PI * 2 + p.phase)) / 2 * p.stroke;
        p.body.setNextKinematicTranslation({ x: 0, y: 0, z: p.z });
      }
      for (const b of balls) {
        if (!b.live || !b.emerge) continue;
        const E = b.emerge, d = E.o.dir, s = Math.min(E.dist, (f.elapsed - E.t0) * E.v);
        const ax = d[2], az = -d[0];                  // rolls about the level line across its path
        if (s < E.dist) {
          const th = s / BALL_R / 2;
          b.body.setNextKinematicTranslation({ x: E.x + d[0] * s, y: E.y, z: E.z + d[2] * s });
          b.body.setNextKinematicRotation({ x: ax * Math.sin(th), y: 0, z: az * Math.sin(th), w: Math.cos(th) });
        } else {
          b.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
          b.body.setLinvel({ x: d[0] * E.v + E.o.across[0] * E.wob, y: 0, z: d[2] * E.v + E.o.across[2] * E.wob }, true);
          // only a little of its roll goes with it: the full spin carried balls
          // away from the outer wall once they landed (8 cm out, not 4)
          b.body.setAngvel({ x: ax * E.v / BALL_R * 0.2, y: 0, z: az * E.v / BALL_R * 0.2 }, true);
          b.emerge = null;
        }
      }
      const wa = wiperAngle();
      for (const g of guards) g.body.setNextKinematicRotation({ x: 0, y: 0, z: Math.sin(wa / 2), w: Math.cos(wa / 2) });
      world.step(events);
      stepTowers(onCollected);

      // coin supplies: each coin that is due goes out now, a little off straight
      for (const q of supplies) {
        if (!q.left || q.next > f.elapsed) continue;
        if (active.length >= fieldCap) { q.next = f.elapsed + shot.gap; continue; }   // hopper waits for room
        const { o, onWake } = q;
        q.left--;
        q.next = f.elapsed + shot.gap * (0.9 + Math.random() * 0.2);
        const off = (Math.random() - 0.5) * Math.max(0, o.width - 2 * CFG.coinR) * 0.9;     // anywhere across the mouth
        const dribble = Math.random() < shot.dribble;
        const up = (dribble ? -30 + Math.random() * 30 : SHOT_UP[0] + Math.random() * (SHOT_UP[1] - SHOT_UP[0])) * DEG;
        const side = (Math.random() - 0.5) * 2 * (dribble ? shot.side * 1.25 : shot.side) * DEG;
        const sp = dribble ? DRIBBLE_SPEED[0] + Math.random() * (DRIBBLE_SPEED[1] - DRIBBLE_SPEED[0])
                           : shot.speed * (0.85 + Math.random() * 0.3);
        const flat = sp * Math.cos(up);
        const hx = o.dir[0] * Math.cos(side) + o.across[0] * Math.sin(side);
        const hz = o.dir[2] * Math.cos(side) + o.across[2] * Math.sin(side);
        const c = f.drop(o.mouth[0] + o.dir[0] * (CFG.coinR + 0.2) + o.across[0] * off, o.mouth[1],
                         o.mouth[2] + o.dir[2] * (CFG.coinR + 0.2) + o.across[2] * off,
                         { x: hx * flat, y: sp * Math.sin(up), z: hz * flat }, onWake);
        if (c) {
          // round while it flies, so one on its edge can roll; square again once it lies flat
          if (shape !== 'cylinder') { c.collider.setShape(DISC); c.round = true; }
          c.outAt = f.elapsed;
          const style = Math.random(), len = Math.hypot(hx, hz) || 1, ax = -hz / len, az = hx / len;
          if (style < SHOT_ON_EDGE) {
            // on its edge, its face side-on to the way it is going, spinning to roll that way
            const s = Math.SQRT1_2, w = -flat / CFG.coinR;
            c.body.setRotation({ x: az * s, y: 0, z: -ax * s, w: s }, true);
            c.body.setAngvel({ x: ax * w, y: (Math.random() - 0.5) * 2, z: az * w }, true);
          } else if (style < SHOT_ON_EDGE + SHOT_SLANT) {
            // slanted, any way round, tumbling
            const tilt = (25 + Math.random() * 50) * DEG, turn = Math.random() * Math.PI * 2;
            const ux = Math.cos(turn), uz = Math.sin(turn);
            c.body.setRotation({ x: ux * Math.sin(tilt / 2), y: 0, z: uz * Math.sin(tilt / 2), w: Math.cos(tilt / 2) }, true);
            c.body.setAngvel({ x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 10 }, true);
          } else {
            c.body.setAngvel({ x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 4 }, true);
          }
        }
      }

      // balls: counted once they drop into the payout area, then cleared
      for (const b of balls) {
        if (!b.live) continue;
        const t = b.body.translation();
        if (b.inAt) { if (f.elapsed - b.inAt > BALL_HOLD) parkBall(b); continue; }
        if (t.y < D.y && t.z > D.z0) { b.inAt = f.elapsed; f.ballsIn++; continue; }
        if (t.y < -10) { f.ballsLost++; parkBall(b); }
      }

      // the slot: let the next coin go when the wipers are swung out to meet it
      // (swinging back toward straight down, an arm moves away from the coin)
      const outward = Math.abs(wiperAngle(f.elapsed + world.timestep)) > Math.abs(wa);
      const ready = Math.abs(wa) >= ch.guards.releaseAny || (outward && Math.abs(wa) >= ch.guards.release);
      if (slot.length && (ready || slot[0].anyway)) {
        const s = slot.shift();
        f.release(s.onWake);
      }

      // thaw whatever each pusher's face is about to reach
      if (freeze) {
        for (const p of pushers) {
          const face = p.front + p.z, reach = face + CFG.coinR + 1.2;
          const Z = p.sweep;
          for (let gx = Math.floor(Z.x0 / 3); gx <= Math.floor(Z.x1 / 3); gx++) {
            for (let gz = Math.floor((face - 3) / 3); gz <= Math.floor(reach / 3); gz++) {
              const set = grid.get(gx + ',' + gz);
              if (!set) continue;
              for (const c of set) {
                const q = c.at;
                if (q.z < reach && q.z > face - 3 && q.x > Z.x0 && q.x < Z.x1 && q.y > Z.y0 && q.y < Z.y1) thaw(c, 'pusher face');
              }
            }
          }
        }
      }

      // shoved hard enough to have moved: thaw
      events.drainContactForceEvents(e => {
        const dir = e.maxForceDirection(), mag = e.maxForceMagnitude();
        const sideways = mag * Math.hypot(dir.x, dir.z);
        if (sideways < slide * FREEZE.push && mag < weight * FREEZE.slam) return;
        const a = byCollider.get(e.collider1()), b = byCollider.get(e.collider2());
        const why = mag >= weight * FREEZE.slam ? 'hit' : 'shoved';
        if (a?.frozen) thaw(a, why);
        if (b?.frozen) thaw(b, why);
      });

      const dt = world.timestep;
      f.moving = 0;
      for (let i = active.length - 1; i >= 0; i--) {
        const c = active[i];
        if (c.frozen) continue;
        f.moving++;
        const t = c.body.translation();
        if (onMoved) onMoved(c, t, c.body.rotation());

        // Paid: it lies in the tray a moment, then it is cleared away.
        if (c.paidAt) {
          if (f.elapsed - c.paidAt > CFG.trayHold || t.y < D.trayY - 4) f.park(c);
          continue;
        }
        // Over the front edge, anywhere across the machine: the front is the
        // only way out, and every coin that goes that way is yours.
        if (t.y < D.y && t.z > D.z0) {
          f.won++;
          c.paidAt = f.elapsed;
          if (onCollected) onCollected(c, true);
          continue;
        }
        if (t.y < -10) {
          f.lost++;
          f.lostAt = (f.lostAt || []).concat([[c.last?.x, c.last?.y, c.last?.z].map(v => Math.round(v * 10) / 10)]);
          if (onCollected) onCollected(c, false);
          f.park(c);
          continue;
        }

        const out = outOfPusher(t);
        if (out) {
          if (f.rescueLog.length < 400) f.rescueLog.push(['pusher', +t.x.toFixed(1), +t.y.toFixed(1), +t.z.toFixed(1)]);
          c.body.setTranslation(out, true);
          c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          c.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          c.safe = out;
          f.rescues++;
          continue;
        }
        if (insideSolid(t) && !(t.y < D.y && t.z > D.z0)) {
          if (f.rescueLog.length < 400) f.rescueLog.push(['solid', +t.x.toFixed(1), +t.y.toFixed(1), +t.z.toFixed(1)]);
          // Pressed a little into a surface it lies on: lift it straight back
          // onto the surface where it is, still moving - nobody sees that.
          const top = surfaceAbove(t);
          if (top !== null) {
            const v = c.body.linvel();
            c.body.setTranslation({ x: t.x, y: top + CFG.colT / 2 + 0.05, z: t.z }, true);
            c.body.setLinvel({ x: v.x, y: Math.max(0, v.y), z: v.z }, true);
            f.rescues++;
            f.lifts++;
            continue;
          }
          const back = c.safe ?? t;
          c.body.setTranslation({ x: back.x, y: back.y + 0.3, z: back.z }, true);
          c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          c.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          f.rescues++;
          continue;
        }
        c.safe = t;
        if (t.y > -2) c.last = t;

        // Anti-jam. A coin that finds somewhere to rest inside the box gets
        // a flick, the way a real machine shakes itself loose.
        if (inChute(t)) {
          if (c.planar) { keepInSlot(c, t); if (board) unstick(c, t); }
          if (board && c.wheel === null) {
            const w = wheelAt(t);
            if (w) { c.wheel = w.i; f.wheels[w.i]++; }
          }
          // A real box slows a coin with its pins and wheels. This one just
          // will not let it go faster than this - at that speed nobody can tell.
          // Only its fall is held back: capping its whole speed took the
          // sideways throw off a wiper away in proportion as it fell, and no
          // coin ever got further than the wheel next to the middle.
          const v = c.body.linvel();
          const G = ch.guards, cap = t.y > G.pivotY - G.length - 1 ? Math.min(G.drift, boardFall) : boardFall;
          const vy = Math.max(-cap, Math.min(cap, v.y)), vx = Math.max(-CHUTE_SIDE, Math.min(CHUTE_SIDE, v.x));
          if (vy !== v.y || vx !== v.x) c.body.setLinvel({ x: vx, y: vy, z: v.z }, true);
          c.inChute += world.timestep;
          if (c.inChute > CHUTE_STUCK) {
            f.nudges++;
            const dir = Math.random() < 0.5 ? -1 : 1;
            c.body.setLinvel({ x: dir * CFG.chuteNudge, y: CFG.chuteNudge * 0.5, z: 0 }, true);
            c.body.setAngvel({ x: 0, y: 0, z: -dir * CFG.chuteNudge * 0.8 }, true);
            c.inChute = 1e-4;
          }
          continue;                     // never frozen while in the box
        } else if (c.inChute) {
          c.inChute = 0;
          // Out of the bottom of the box, on its edge, right against the
          // panel: nudge it forward off the panel, as the lip at a real box's
          // exit does, so it does not lean back on the panel and get wedged
          // into the corner as the pusher pulls back. (Spinning it forward
          // instead swung its bottom corner back INTO the panel.)
          // A touch of wobble too: a coin landing on its rim tips to one side.
          planar(c, false);                      // out of the slot: free again
          if (board && c.exit === null) { c.exit = exitOf(t.x, c.wheel); f.exits[c.exit]++; }
          const v = c.body.linvel(), w = c.body.angvel();
          c.body.setLinvel({ x: v.x, y: v.y, z: v.z + 6 }, true);
          c.body.setAngvel({ x: w.x + 1 + Math.random(), y: w.y, z: w.z + (Math.random() - 0.5) * 4 }, true);
          c.outAt = f.elapsed;
        }
        if (inDrop(t)) {
          // the last few cm onto the pusher, slowly: at full box speed a coin
          // on its edge went 1.7 cm into the pusher's top in a single step
          const v = c.body.linvel(), sp = Math.hypot(v.x, v.y, v.z);
          if (sp > LANDING_SPEED) c.body.setLinvel({ x: v.x * LANDING_SPEED / sp, y: v.y * LANDING_SPEED / sp, z: v.z * LANDING_SPEED / sp }, true);
        }
        const v = c.body.linvel();
        const v2 = v.x * v.x + v.y * v.y + v.z * v.z;
        // a round coin goes back to being a square once it is lying flat and
        // slowing down - or after a few seconds regardless
        if (c.round && c.outAt) {
          const q = c.body.rotation(), up = Math.abs(1 - 2 * (q.x * q.x + q.z * q.z));   // its axis, against straight up
          const onEdge = up < Math.cos(1.2);                                             // within ~20 degrees of upright
          if ((up > Math.cos(ROUND_UNTIL_TILT) && v2 < 100) || (f.elapsed - c.outAt > ROUND_AT_MOST && !onEdge)) square(c);
          // Still up on its rim a moment after landing - usually propped
          // against the box's back panel: a real machine's shake would have
          // toppled it. Push its top edge forward, away from the panel, and a
          // little to one side, so it tips and rolls off as a real coin does.
          // (A spin turns it about its middle, and half the time drove it back
          // into the panel, which held it up.)
          else if (onEdge && f.elapsed - c.outAt > STANDING_TIP && v2 < 225 &&
                   (t.y < ch.exitY - 1 || t.x < ch.x0 || t.x > ch.x1)) {
            const m = c.collider.mass();
            c.body.applyImpulseAtPoint({ x: (Math.random() - 0.5) * m * 8, y: 0, z: m * 9 },
                                       { x: t.x, y: t.y + CFG.coinR * 0.9, z: t.z }, true);
            c.outAt = f.elapsed - STANDING_TIP + 0.5;      // look again shortly
          }
        }
        // Anything falling fast - out of the box, off the front of a pusher -
        // gets full collision checking until it has slowed down. A coin
        // dropping off the centre pusher onto bare deck hits it at several cm
        // a step, enough to sink into it between two steps.
        if (!c.ccd && v2 > CCD_FALL * CCD_FALL) { c.body.enableCcd(true); c.ccd = true; }
        else if (c.ccd && v2 < 400 && !(ch && t.y > ch.exitY)) { c.body.enableCcd(false); c.ccd = false; }
        const ahead = v2 > CCD_FAST * CCD_FAST;
        if (ahead !== c.ahead) { c.body.setSoftCcdPrediction(ahead ? CCD_AHEAD : 0); c.ahead = ahead; }

        // Anywhere in the machine, a coin left standing on its edge, nearly
        // still, gets the machine's shake after a moment and topples - one
        // leaning against the step down to a side ramp stayed there for good.
        // Looked at twice a second: it costs next to nothing.
        if (!c.round && tick % 15 === c.slot % 15) {
          const q = c.body.rotation(), up = Math.abs(1 - 2 * (q.x * q.x + q.z * q.z));
          if (up < Math.cos(1.2) && v2 < 25) {
            c.edgeSince ??= f.elapsed;
            if (f.elapsed - c.edgeSince > EDGE_TIP) {
              // tip it over its face - the way it can fall - toward the middle
              // and front of the machine, so away from whatever it leans on
              const m = c.collider.mass();
              let ax = 2 * (q.x * q.y - q.w * q.z), az = 2 * (q.y * q.z + q.w * q.x);
              const len = Math.hypot(ax, az) || 1;
              ax /= len; az /= len;
              if (ax * (midX - t.x) + az * (D.z0 - t.z) < 0) { ax = -ax; az = -az; }
              c.body.applyImpulseAtPoint({ x: ax * m * 6, y: 0, z: az * m * 6 }, { x: t.x, y: t.y + CFG.coinR * 0.9, z: t.z }, true);
              c.edgeSince = undefined;
              f.toppled++;
            }
          } else c.edgeSince = undefined;
        }
        if (!freeze) continue;
        const w = c.body.angvel();

        // a moving coin thaws whatever frozen coins it is running into
        const flat = v.x * v.x + v.z * v.z;
        const waveV = mode === 'creep' ? FREEZE.creepWave : FREEZE.wave;
        if (flat > waveV * waveV && f.frozen) {
          const gx = Math.floor(t.x / 3), gz = Math.floor(t.z / 3);
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
            const set = grid.get((gx + a) + ',' + (gz + b));
            if (!set) continue;
            for (const o of set) {
              const q = o.at, dx = q.x - t.x, dz = q.z - t.z;
              if (Math.abs(q.y - t.y) < 1.4 && dx * dx + dz * dz < FREEZE.touch * FREEZE.touch &&
                  dx * v.x + dz * v.z > 0) thaw(o, 'wave');
            }
          }
        }
        if (mode === 'creep') {
          // where was it one stroke ago? hardly moved since: frozen
          if (!c.ref) c.ref = { x: t.x, y: t.y, z: t.z, at: f.elapsed };
          else if (f.elapsed - c.ref.at >= period) {
            const d2 = (t.x - c.ref.x) ** 2 + (t.y - c.ref.y) ** 2 + (t.z - c.ref.z) ** 2;
            if (d2 < FREEZE.creep * FREEZE.creep && !nearPusher(t)) doFreeze(c);
            c.ref = { x: t.x, y: t.y, z: t.z, at: f.elapsed };
          }
          continue;
        }
        const still = v.x * v.x + v.y * v.y + v.z * v.z < FREEZE.speed * FREEZE.speed &&
                      w.x * w.x + w.y * w.y + w.z * w.z < FREEZE.spin * FREEZE.spin;
        c.still = still ? c.still + dt : 0;
        if (c.still > FREEZE.after && !nearPusher(t)) doFreeze(c);
      }
    },
  };
  return f;
}

/**
 * Everything the page needs to draw one step: every live coin's position and
 * turn, which are frozen, the pushers, the guards, any towers, and the
 * running totals. The physics thread posts this after each step; the page
 * draws from it whichever thread the physics ran on.
 * Returns [message, the arrays to hand over rather than copy].
 */
export function snapshot(f, paid = 0, stepMs = 0) {
  const act = f.active, n = act.length;
  const slots = new Int16Array(n), xf = new Float32Array(n * 7), frozen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const c = act[i], t = c.body.translation(), q = c.body.rotation(), o = i * 7;
    slots[i] = c.slot;
    xf[o] = t.x; xf[o + 1] = t.y; xf[o + 2] = t.z;
    xf[o + 3] = q.x; xf[o + 4] = q.y; xf[o + 5] = q.z; xf[o + 6] = q.w;
    frozen[i] = c.frozen ? 1 : 0;
  }
  const towers = new Float32Array(f.towers.length * 8);
  f.towers.forEach((T, i) => {
    const t = T.body.translation(), q = T.body.rotation();
    towers.set([t.x, t.y, t.z, q.x, q.y, q.z, q.w, T.n], i * 8);
  });
  // balls: slot, then position and turn
  const live = f.balls.filter(b => b.live);
  const balls = new Float32Array(live.length * 8);
  live.forEach((b, i) => {
    const t = b.body.translation(), q = b.body.rotation();
    balls.set([b.slot, t.x, t.y, t.z, q.x, q.y, q.z, q.w], i * 8);
  });
  const msg = {
    type: 'state', t: f.elapsed, n, slots, xf, frozen, towers, balls,
    pushers: f.pushers.map(p => p.z),
    guards: f.guards.map(g => f.guardAt(g)),
    stats: { won: f.won, lost: f.lost, moving: f.moving, frozen: f.frozen, rescues: f.rescues, coins: n, stepMs,
             wheels: f.wheels.slice(), ballsIn: f.ballsIn, supplyLeft: f.supplyLeft() },
    paid,
  };
  return [msg, [slots.buffer, xf.buffer, frozen.buffer, towers.buffer, balls.buffer]];
}
