import { CFG } from './config.js?v=17';   // keep the ?v in step with app.js

/* ------------------------------------------------------------------ *
 *  The machine, as physics only. No renderer, no DOM - so this file
 *  runs unchanged under Node, which is how it gets tested.
 *
 *  The box lists below are the single source of truth for the cabinet
 *  shape: this file turns them into colliders, and app.js turns the
 *  same lists into meshes. They cannot drift apart.
 * ------------------------------------------------------------------ */

/** Every fixed part of the cabinet, as centre + half-extents. */
export function cabinetBoxes() {
  const C = CFG;
  const out = [];

  // Lower deck floor, in two pieces. The back piece runs the full width,
  // the front piece is narrower, and that difference IS the gutter.
  const backD = (C.gutterFromZ - C.backZ) / 2;
  out.push({ kind: 'deck', c: [0, -1.5, C.backZ + backD], h: [C.wallHalfW, 1.5, backD] });

  const frontD = (C.lipZ - C.gutterFromZ) / 2;
  out.push({ kind: 'deck', c: [0, -1.5, C.gutterFromZ + frontD], h: [C.floorHalfW, 1.5, frontD] });

  // Upper deck floor. Full width, so it is sealed by the side walls and
  // only ever leaks forward, over its own front edge.
  const upD = (C.upperFrontZ - C.backZ) / 2;
  out.push({ kind: 'deck', c: [0, C.upperY - 1.25, C.backZ + upD], h: [C.wallHalfW, 1.25, upD] });

  // Side walls and back panel.
  const sideD = (C.lipZ - C.backZ) / 2, sideCz = C.backZ + sideD;
  for (const s of [-1, 1]) {
    out.push({ kind: 'wall', c: [s * (C.wallHalfW + 1), 4, sideCz], h: [1, 7.5, sideD] });
  }
  out.push({ kind: 'trim', c: [0, 5, C.backZ - 1], h: [C.wallHalfW + 2, 10, 1] });

  // The payout tray, with real walls, sitting below and ahead of the lip.
  const trayD = (C.trayFrontZ - (C.lipZ - 1)) / 2;
  const trayCz = (C.lipZ - 1) + trayD;
  out.push({ kind: 'tray', c: [0, C.trayY - 1, trayCz], h: [C.floorHalfW + 2, 1, trayD] });
  out.push({ kind: 'tray', c: [0, C.trayY + 2, C.trayFrontZ + 1], h: [C.floorHalfW + 2, 2, 1] });
  for (const s of [-1, 1]) {
    out.push({ kind: 'tray', c: [s * (C.floorHalfW + 3), C.trayY + 2, trayCz], h: [1, 2, trayD] });
  }

  return out;
}

/**
 * The two slabs of the pusher, positioned relative to the pusher body.
 * One rigid body carries both - the real machine's L-shaped plate, where
 * a single stroke sweeps each deck at once.
 */
export function pusherSlabs() {
  const C = CFG;

  const lowD = (C.lowFaceZ - C.slabBackZ) / 2;
  const lowH = (C.slabRise + 2) / 2;           // extends below its deck, so
  const lowCy = C.slabRise - lowH;             // no gap can open underneath

  const upperTop = C.upperY + C.slabRise;
  const upD = (C.upFaceZ - C.slabBackZ) / 2;
  const upH = (C.slabRise + 2) / 2;
  const upCy = upperTop - upH;

  return [
    { c: [0, lowCy, C.slabBackZ + lowD], h: [C.wallHalfW, lowH, lowD] },
    { c: [0, upCy,  C.slabBackZ + upD],  h: [C.wallHalfW, upH,  upD]  },
  ];
}

/* ------------------------------------------------------------------ *
 *  The drop chute
 *
 *  A pachinko board standing at the back of the machine. The coin enters
 *  on edge, hits two antlers that throw it one way or the other, then
 *  rattles down through a field of pins. Where it lands is partly your
 *  aim and partly luck - which is the point.
 * ------------------------------------------------------------------ */

/** Plates, walls and the two antlers. `rz` is a tilt about the z axis. */
export function dropperBoxes() {
  const C = CFG;
  const midY  = (C.chuteTopY + C.chuteExitY) / 2;
  const halfH = (C.chuteTopY - C.chuteExitY) / 2;
  const half  = C.chuteGap / 2;
  const out = [];

  // Everything in the chute is slick. At deck friction a coin resting on a
  // pin and touching a side wall simply sticks there, which is what the last
  // few wedges in test/chute.mjs turned out to be.
  const MU = C.chuteFriction;

  out.push({ kind: 'chute', c: [0, midY, C.chuteZ - half - 0.25],
             h: [C.chuteHalfW + 1.2, halfH, 0.25], mu: MU });
  out.push({ kind: 'glass', c: [0, midY, C.chuteZ + half + 0.25],
             h: [C.chuteHalfW + 1.2, halfH, 0.25], mu: MU });

  for (const s of [-1, 1]) {
    out.push({ kind: 'chute', c: [s * (C.chuteHalfW + 0.6), midY, C.chuteZ],
               h: [0.6, halfH, half], mu: MU });
  }

  for (const s of [-1, 1]) {
    out.push({ kind: 'antler',
               c: [s * C.antlerX, C.antlerY - s * C.antlerStagger, C.chuteZ],
               h: [C.antlerHalfL, 0.22, half * 0.8],
               rz: -s * C.antlerTilt, mu: MU });
  }

  return out;
}

/**
 * The pins. These are ball colliders: the coin is held flat against the
 * board's plane by the glass, so in that plane a sphere behaves exactly
 * like a round pin - and a ball is the cheapest shape Rapier has.
 */
export function dropperPegs() {
  const C = CFG, out = [];

  // Rows are laid out symmetrically from the centre, and stop well short of
  // the side walls. Running them out to the edge leaves a pocket between the
  // last pin and the wall that a coin can enter but not pass - that was 14 of
  // 90 test drops, every one of them jammed against a wall.
  const reach = C.chuteHalfW - 2 * C.coinR - C.pegR - 0.6;

  for (let row = 0; row < C.pegRows; row++) {
    const y = C.pegTopY - row * C.pegDY;
    const staggered = row % 2 === 1;
    if (staggered) out.push({ c: [0, y, C.chuteZ], r: C.pegR });
    for (let k = 0; ; k++) {
      const x = staggered ? (k + 1) * C.pegDX : (k + 0.5) * C.pegDX;
      if (x > reach) break;
      out.push({ c: [ x, y, C.chuteZ], r: C.pegR });
      out.push({ c: [-x, y, C.chuteZ], r: C.pegR });
    }
  }
  return out;
}

/** Where the pusher sits, as a function of elapsed physics time. */
export function pusherZ(elapsed) {
  const s = (1 - Math.cos((elapsed / CFG.period) * Math.PI * 2)) / 2;
  return s * CFG.stroke;
}

/**
 * Where the coins sit when you walk up to a machine that is already full.
 * Pure geometry, so the layout can be checked without a physics world.
 */
export function seedLayout(n, rand = Math.random) {
  const C = CFG, step = 2.55, top = C.upperY + C.slabRise;
  const edge = C.floorHalfW - 1.4;        // derived, so narrowing the machine
  const regions = [                       // does not strand coins in the gutters
    { z0: -3,  z1: C.lipZ - 3,  ys: [0.30, 0.78, 1.26, 1.74] },               // lower deck
    { z0: -20, z1: -9,  ys: [C.slabRise + 0.30, C.slabRise + 0.78] },         // on the lower slab
    { z0: -11, z1: C.upperFrontZ - 1,
      ys: [C.upperY + 0.30, C.upperY + 0.78, C.upperY + 1.26] },
    { z0: -24, z1: -14, ys: [top + 0.30, top + 0.78] },                       // on the upper slab
  ];

  const out = [];
  for (const r of regions) {
    for (const y of r.ys) {
      for (let z = r.z0; z <= r.z1; z += step) {
        for (let x = -edge; x <= edge; x += step) {
          if (out.length >= n) return out;
          out.push({
            x: x + (rand() - 0.5) * 0.5,
            y,
            z: z + (rand() - 0.5) * 0.5,
            spin: rand() * Math.PI,
          });
        }
      }
    }
  }
  return out;
}

/** How many coins the seed layout holds before it runs out of room. */
export function seedCapacity() {
  return seedLayout(Infinity, () => 0.5).length;
}

/* ------------------------------------------------------------------ *
 *  The machine
 * ------------------------------------------------------------------ */

/**
 * A coin's collider. The visible coin is always a disc; this is only what
 * the solver sees.
 *
 * Rapier has no fast path for cylinder-against-cylinder contacts, and with
 * several hundred coins touching at once that cost dominates everything
 * else. A box is far cheaper. BOX_K sizes the square so it covers the same
 * ground as the disc it stands in for, which keeps a packed carpet of coins
 * the same density either way.
 */
const BOX_K = Math.sqrt(Math.PI) / 2;        // equal footprint area

export function coinCollider(RAPIER, shape, t = CFG) {
  const d = shape === 'box'
    ? RAPIER.ColliderDesc.cuboid(CFG.coinR * BOX_K, CFG.colT / 2, CFG.coinR * BOX_K)
    : RAPIER.ColliderDesc.cylinder(CFG.colT / 2, CFG.coinR);
  return d.setFriction(t.coinFriction).setRestitution(t.restitution).setDensity(2.4);
}

export function createMachine(RAPIER, opts = {}) {
  const hz        = opts.hz ?? 60;
  const iters     = opts.iterations ?? 4;
  const maxCoins  = opts.maxCoins ?? CFG.maxCoins;
  const shape     = opts.shape ?? CFG.coinShape;
  const t         = { ...CFG, ...(opts.tune ?? {}) };   // feel knobs, overridable

  const world = new RAPIER.World({ x: 0, y: t.gravity, z: 0 });
  world.timestep = 1 / hz;
  world.numSolverIterations = iters;

  /* ---- cabinet and drop chute ---- */
  for (const b of cabinetBoxes().concat(dropperBoxes())) {
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(b.c[0], b.c[1], b.c[2]);
    if (b.rz) desc.setRotation({ x: 0, y: 0, z: Math.sin(b.rz / 2), w: Math.cos(b.rz / 2) });
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(b.h[0], b.h[1], b.h[2])
        .setFriction(b.mu ?? t.deckFriction).setRestitution(t.restitution),
      world.createRigidBody(desc));
  }

  for (const g of dropperPegs()) {
    world.createCollider(
      RAPIER.ColliderDesc.ball(g.r).setFriction(0.18).setRestitution(0.38),
      world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(g.c[0], g.c[1], g.c[2])));
  }

  const pusher = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, 0));
  for (const s of pusherSlabs()) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(s.h[0], s.h[1], s.h[2])
        .setTranslation(s.c[0], s.c[1], s.c[2])
        .setFriction(t.deckFriction).setRestitution(t.restitution),
      pusher);
  }

  /* ---- coins ----
   * Every coin is created once, here, and then recycled forever. A coin
   * that falls out of play is disabled and handed back to the pool - never
   * destroyed, never re-created. No allocation stalls, and memory stays
   * flat however long the machine runs. */
  const coins = [];
  for (let i = 0; i < maxCoins; i++) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, -500, 0)
      .setLinearDamping(t.linDamp)
      .setAngularDamping(t.angDamp)
      .setCanSleep(true);
    // Soft CCD looks a little way ahead, so a fast coin cannot slip through
    // a neighbour between steps. Far cheaper than full continuous detection.
    if (typeof desc.setSoftCcdPrediction === 'function') {
      desc.setSoftCcdPrediction(CFG.coinR * 1.5);
    }
    const body = world.createRigidBody(desc);
    world.createCollider(coinCollider(RAPIER, shape, t), body);
    body.setEnabled(false);
    coins.push({ body, slot: i, live: false, paidAt: 0, inChute: 0 });
  }

  const active = [];
  const m = {
    world, pusher, coins, active,
    elapsed: 0, awake: 0, won: 0, lost: 0, nudges: 0,

    setRate(newHz)   { world.timestep = 1 / newHz; },
    setSolver(n)     { world.numSolverIterations = n; },

    take() {
      for (let i = 0; i < coins.length; i++) if (!coins[i].live) return coins[i];
      return null;
    },

    wake(coin, x, y, z, spin) {
      const b = coin.body;
      b.setEnabled(true);
      b.setTranslation({ x, y, z }, false);
      const half = (spin ?? Math.random() * Math.PI) / 2;
      b.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, false);
      b.setLinvel({ x: 0, y: 0, z: 0 }, false);
      b.setAngvel({ x: 0, y: 0, z: 0 }, false);
      b.wakeUp();
      coin.live = true;
      coin.paidAt = 0;
      active.push(coin);
      return coin;
    },

    park(coin) {
      coin.body.setEnabled(false);
      coin.body.setTranslation({ x: 0, y: -500, z: 0 }, false);
      coin.live = false;
      coin.paidAt = 0;
      coin.inChute = 0;
      const i = active.indexOf(coin);
      if (i !== -1) active.splice(i, 1);
    },

    /** Place one coin at an exact recorded transform. */
    wakeAt(coin, c) {
      const b = coin.body;
      b.setEnabled(true);
      b.setTranslation({ x: c[0], y: c[1], z: c[2] }, false);
      b.setRotation({ x: c[3], y: c[4], z: c[5], w: c[6] }, false);
      b.setLinvel({ x: 0, y: 0, z: 0 }, false);
      b.setAngvel({ x: 0, y: 0, z: 0 }, false);
      b.wakeUp();
      coin.live = true;
      coin.paidAt = 0;
      coin.inChute = 0;
      active.push(coin);
      return coin;
    },

    /**
     * Load a pile that was already settled offline, by test/make-pile.mjs.
     *
     * This is how the machine should normally be filled. seed() below lays
     * coins out on a grid, which sits above the machine's natural capacity
     * and then takes about two minutes to collapse into shape - two minutes
     * during which coins fall off on their own and it looks broken. A
     * recorded pile starts at rest, so nothing moves until you play.
     *
     * Coins are dropped from the top down when fewer are wanted, because
     * taking weight off the top of a settled pile leaves the rest settled.
     */
    seedFrom(pile, n, onWake) {
      for (let i = active.length - 1; i >= 0; i--) m.park(active[i]);
      m.elapsed = pile.elapsed ?? 0;

      let coins = pile.coins;
      if (n < coins.length) {
        coins = coins.slice().sort((a, b) => a[1] - b[1]).slice(0, n);
      }
      for (const c of coins) {
        const coin = m.take();
        if (!coin) break;
        m.wakeAt(coin, c);
        if (onWake) onWake(coin);
      }
      return active.length;
    },

    /** Fill the machine on a grid. Only for generating a pile, or for the
     *  benchmark - it is not at rest, see seedFrom(). */
    seed(n, onWake, rand) {
      for (let i = active.length - 1; i >= 0; i--) m.park(active[i]);
      for (const p of seedLayout(n, rand)) {
        const coin = m.take();
        if (!coin) break;
        m.wake(coin, p.x, p.y, p.z, p.spin);
        if (onWake) onWake(coin);
      }
      return active.length;
    },

    /** Release a coin into the top of the chute, standing on edge. */
    drop(x, onWake) {
      const coin = m.take();
      if (!coin) return null;              // field saturated, nothing spare
      const s = Math.SQRT1_2;              // a quarter turn about x, so the
      const jitter = (Math.random() - 0.5) * 0.4;   // coin faces the glass
      m.wakeAt(coin, [x + jitter, CFG.chuteTopY, CFG.chuteZ, s, 0, 0, s]);
      if (onWake) onWake(coin);
      return coin;
    },

    /**
     * One fixed physics step. onMoved fires for every coin that actually
     * moved - sleeping coins are skipped, which is most of the pile most
     * of the time, and is the single biggest saving in here.
     */
    step(onMoved, onCollected) {
      m.elapsed += world.timestep;
      pusher.setNextKinematicTranslation({ x: 0, y: 0, z: pusherZ(m.elapsed) });
      world.step();

      m.awake = 0;
      for (let i = active.length - 1; i >= 0; i--) {
        const coin = active[i];
        // Coins resting in the tray still need their clock read, so they are
        // not skipped even once they fall asleep down there.
        if (coin.body.isSleeping() && !coin.paidAt && !coin.inChute) continue;
        m.awake++;
        const p = coin.body.translation();
        if (onMoved) onMoved(coin, p, coin.body.rotation());

        // Anti-jam. A peg board will always find some resting place nobody
        // predicted - a coin balanced on an apex, or propped against a wall -
        // and a coin that never comes out is a coin the player paid for. Real
        // machines shake themselves loose; this is that, and it fires rarely.
        if (p.y > CFG.chuteExitY && Math.abs(p.z - CFG.chuteZ) < 1.6) {
          coin.inChute += world.timestep;
          if (coin.inChute > CFG.chuteNudgeAfter) {
            coin.body.wakeUp();
            m.nudges++;
            // Set a velocity rather than apply an impulse. An impulse has to
            // be divided by the coin's mass and fought against gravity of 900
            // to mean anything, and a uniform random one is mostly near zero
            // anyway - the first version nudged 125 times and moved nothing.
            // A flick with a random sign and a roll on it always works.
            const dir = Math.random() < 0.5 ? -1 : 1;
            coin.body.setLinvel({ x: dir * CFG.chuteNudge, y: CFG.chuteNudge * 0.5, z: 0 }, true);
            coin.body.setAngvel({ x: 0, y: 0, z: -dir * CFG.chuteNudge * 0.8 }, true);
            // NOT zero: the sleep-skip above keys off this counter, so zeroing
            // it lets a coin doze straight back off and never be looked at
            // again. Which is exactly what happened the first time.
            coin.inChute = 1e-4;
          }
        } else if (coin.inChute) {
          coin.inChute = 0;
        }

        if (!coin.paidAt && p.z > CFG.lipZ && p.y < CFG.payLine) {
          m.won++;
          coin.paidAt = m.elapsed;                 // it is yours the moment it
          if (onCollected) onCollected(coin, true); // clears the lip
        }

        if (coin.paidAt) {
          if (m.elapsed - coin.paidAt > CFG.trayHold) m.park(coin);
        } else if (p.y < CFG.killY) {
          m.lost++;
          m.park(coin);
          if (onCollected) onCollected(coin, false);
        }
      }
    },
  };

  return m;
}
