# Coin pusher — plan

Working notes for the arcade-gaming repo. Written 2026-09-28, after building
and measuring v1.

Live: https://anonymousecheese.github.io/arcade-gaming/

---

## Where this is

A playable two-deck coin pusher. Real rigid-body physics, hundreds of coins,
runs in the browser with no build step.

| File | What it is |
| --- | --- |
| `config.js` | Every machine dimension. One place to tune the feel. |
| `physics.js` | The machine — cabinet, pusher, coin pool, the step loop. No three.js, no DOM, so it runs under Node and can be tested exactly as it ships. |
| `app.js` | Renderer, input, HUD, performance panel. |
| `index.html` / `style.css` | Shell and UI. |
| `vendor/` | three.js and Rapier, committed. No CDN at runtime. |
| `test/physics.test.mjs` | `node test/physics.test.mjs` — 11 checks, all passing. |
| `test/bench.mjs` | `node test/bench.mjs` — deterministic shape and rate comparison. |

**Controls:** press and slide to aim, lift to drop. The FPS button top-right
opens the performance panel.

---

## The question this was built to answer

> As many coins as a normal arcade machine, running well on mobile Safari.

Short answer: **yes, 600 coins is fine.** On a 2021 15-watt laptop it uses a
third of the frame budget, and a modern iPhone is faster than that laptop.

---

## What was measured

Ryzen 5 5500U, single core, Node. Treat these as a **pessimistic floor** —
a recent iPhone is roughly 1.5–2.5× faster single-core than this chip.

Physics at 30 Hz, budget 33.3 ms per step:

| Coins | Cylinder collider | Box collider |
| --- | --- | --- |
| 300 | 12.75 ms — 38% | **5.04 ms — 15%** |
| 450 | 16.74 ms — 50% | **7.62 ms — 23%** |
| 600 | 24.01 ms — 72% | **10.68 ms — 32%** |

Solver iterations, 600 box coins at 30 Hz: 2 → 8.0 ms, 4 → 10.7 ms, 8 → 17.3 ms.
Four is the default and is comfortably affordable.

---

## What was learned

**1. The collider shape was the whole ballgame.** Rapier has no fast path for
cylinder-against-cylinder contacts, and with hundreds of coins touching at
once that cost dominated everything else. Swapping the *collider* to a box —
sized to cover the same ground as the disc — roughly halves the cost. The coin
you look at is still a disc; only the solver sees a square. In an isolated
test a box was 7× cheaper than a cylinder, and a 10-sided prism was 5× *worse*
than the cylinder, so "nearly round" is the worst of both worlds.

**2. Sleeping buys nothing here, and I was wrong to expect it to.** The usual
big win in a physics pile is that settled bodies fall asleep and cost nothing.
It does not apply: the coin carpet is one connected contact island touching a
pusher that never stops, so the whole field stays awake by construction —
measured at 400/400 awake. The step costs above are the real steady state,
not a warm-up.

**3. Multi-threaded physics is off the table.** It needs COOP/COEP HTTP
headers, which GitHub Pages cannot set. Single-threaded WASM only. This is why
the numbers above matter — there is no second core to fall back on.

**4. An idle machine settles instead of draining.** Left alone it sheds coins
until the front of the pile no longer reaches the lip, then stops: 68 coins in
the first 10 seconds, decaying to ~2, stabilising around 334 on the field.
That is what a real machine does, and it is now a test.

**5. It already plays like a coin pusher.** At equilibrium, 16–23% of dropped
coins come back, the gutters eat more than the lip pays, and wins arrive in
bursts — 37 in one ten-second window, then nothing for twenty. That stop-start
avalanche rhythm is the thing that makes the real machine compelling, and it
came out of the physics rather than being scripted.

---

## Decisions taken

- **Rapier** (Rust → WASM) for physics, **three.js** for rendering. Both
  vendored into the repo; Rapier's WASM is inlined as base64, so there is no
  build step, no CDN and nothing to go wrong offline.
- **Physics at 30 Hz, rendering at 60 fps**, interpolating between the last two
  physics states. Halves the physics cost, and a slow-moving pusher loses
  nothing visually.
- **Box collider by default**, with a cylinder toggle in the performance panel
  so the real device can settle it.
- **One instanced draw call** for every coin. Rendering is not a factor.
- **Coins are created once and recycled forever.** A coin that leaves play is
  disabled and returned to the pool, never destroyed. Flat memory, no
  allocation stalls, however long it runs.
- **450 coins default, 600 maximum.** The seed layout holds 638.

---

## Next, in order

1. **Open it on the phone.** The performance panel has a coin slider, a
   physics-rate toggle, a collider-shape toggle and live FPS. Slide the coins
   up until the frame rate stops holding — that number is the real budget, and
   every estimate above is a stand-in for it.
2. **Look at whether the box collider shows.** It is invisible in principle;
   the risk is coins overlapping slightly where a disc would not. If it reads
   wrong, the cylinder is affordable at 450 coins and the toggle is already
   there.
3. **Nail down the mechanics of the real machine.** Still outstanding, and it
   is the only thing blocking the actual game:
   - What makes it *parallel* — two playfields at once? coins crossing between
     two sides?
   - What do the special slots or holes do when a coin lands in one?
   - Is there a jackpot meter, and what fills it?
   - Anything on the field besides coins — prizes, capsules, special coins?

   The Chinese name on the cabinet would let me search for it directly; four
   searches in English and Chinese found nothing under "Parallel Realms".

---

## Deliberately not built yet

Listed so they are choices rather than oversights:

- **A static coin bed** at the back, rendered but not simulated, to make the
  field look fuller than what is being solved. Not needed at 600 coins — hold
  it in reserve in case a real phone disappoints.
- **Physics in a Web Worker.** Would keep rendering smooth under load. Worth
  doing if the phone turns out tight, not before.
- **Sound.** A coin pusher is half sound. It matters more than it looks.
- **The look.** Right now it is untextured blocks — correct, not pretty. No
  cabinet art, no reflections, no payout tray animation.
- **Everything that makes it a game** rather than a simulation: what a coin
  costs, what you are playing for, bonuses, progression.
