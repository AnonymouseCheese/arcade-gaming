# Coin pusher — plan

Working notes for the arcade-gaming repo. Started 2026-09-28, updated
2026-09-30.

Live: https://anonymousecheese.github.io/arcade-gaming/

---

## Where this is

A playable two-deck coin pusher with real rigid-body physics, hundreds of
coins, a payout tray, and synthesised sound. No build step, no CDN.

| File | What it is |
| --- | --- |
| `config.js` | Every machine dimension. One place to tune the feel. |
| `physics.js` | The machine — cabinet, pusher, tray, coin pool, step loop. No three.js, no DOM, so it runs under Node and is tested exactly as it ships. |
| `app.js` | Renderer, input, sound cues, performance panel. |
| `audio.js` | All the sound, synthesised. No audio files. |
| `index.html` / `style.css` | Shell and UI. |
| `vendor/` | three.js and Rapier, committed. |
| `test/physics.test.mjs` | 14 checks. All passing. |
| `test/bench.mjs` | Deterministic shape and rate comparison. |
| `test/overlap.mjs` | Whether the box collider is visible. |

**Controls:** press and slide to aim, lift to drop. `Sound` toggles audio,
`FPS` opens the performance panel.

**Cache rule:** every intra-app import carries `?v=N`, and `index.html`
references `app.js?v=N` / `style.css?v=N`. Bump them **all together** — if
`app.js` and `physics.js` disagree about the version on `config.js`, the
browser quietly loads two separate copies of it.

---

## The question this was built to answer

> As many coins as a normal arcade machine, running well on mobile Safari.

**Yes, 600 coins is fine.** On a 2021 15-watt laptop it uses under a third of
the frame budget, and a modern iPhone is faster than that laptop.

Ryzen 5 5500U, single core, Node — a **pessimistic floor**, since a recent
iPhone is roughly 1.5–2.5× faster single-core:

| Coins | 30 Hz, cylinder | 30 Hz, box |
| --- | --- | --- |
| 300 | 12.75 ms — 38% | **5.04 ms — 15%** |
| 450 | 16.74 ms — 50% | **7.62 ms — 23%** |
| 600 | 24.01 ms — 72% | **9.68 ms — 29%** |

---

## What was learned

**1. The collider shape was the whole ballgame.** Rapier has no fast path for
cylinder-against-cylinder contacts, and with hundreds of coins touching that
cost dominated everything else. Swapping the *collider* to a box — sized to
cover the same ground as the disc — roughly halves the cost. The coin you look
at is still a disc; only the solver sees a square. A 10-sided prism was 5×
*worse* than the cylinder, so "nearly round" is the worst of both worlds.

**2. The box cheat is nearly invisible, and that is measured, not assumed.**
`test/overlap.mjs` compares how close two dead-flat coplanar coins get. The
cylinder is the control and bottoms out at 2.306 units against a 2.40 disc —
that 3.9% is solver contact slop. The box reaches 2.008: **7% of a coin
overlap on average, 16% worst case**, or roughly 1–3 px on a phone. Mean is
invisible; worst case might show in a freeze-frame. The cylinder toggle is in
the performance panel if you disagree.

*Getting there took two wrong answers.* The first filter counted **stacked**
coins as clipping; the second allowed 26° of tilt, so shingled coins leaning
on each other showed as overlap. Both times the cylinder control gave an
impossible number, which is what caught it. Keep the control.

**3. Sleeping buys nothing here, and I was wrong to expect it to.** The usual
big win in a physics pile is that settled bodies sleep and cost nothing. It
does not apply: the coin carpet is one connected contact island touching a
pusher that never stops, so the whole field stays awake — measured at 400/400.
The step costs above are steady state, not a warm-up.

**4. Multi-threaded physics is off the table.** It needs COOP/COEP headers,
which GitHub Pages cannot set. Single-threaded WASM only.

**5. An idle machine settles instead of draining.** Left alone it sheds coins
until the front of the pile no longer reaches the lip, then stops — 68 in the
first 10 seconds, decaying to ~2, stabilising around 334 on the field. That is
what a real machine does, and it is now a test.

**6. It plays like a coin pusher without being told to.** At equilibrium
16–23% of dropped coins come back, the gutters eat more than the lip pays, and
wins arrive in bursts — 37 in one ten-second window, then nothing for twenty.
That avalanche rhythm fell out of the physics rather than being scripted.

---

## Decisions taken

- **Rapier** (Rust → WASM) and **three.js**, both vendored. Rapier's WASM is
  inlined as base64, so there is no build step and no CDN at runtime.
- **Physics at 30 Hz, rendering at 60 fps**, interpolating between the last two
  states. Halves the physics cost; a slow pusher loses nothing visually.
- **Box collider by default**, cylinder available in the panel.
- **One instanced draw call** for every coin. Rendering is not a factor.
- **Coins are created once and recycled forever.** Flat memory, no allocation
  stalls, however long it runs.
- **The payout tray has real walls.** Winnings clatter in, rest for a couple of
  seconds and are swept. It never holds many, so it costs almost nothing, and
  watching them land is the payoff.
- **Sound is synthesised**, not sampled — inharmonic partials for the metal
  ring, filtered noise for the strike, a motor drone and a pile-rustle layer
  whose level follows how much the coins are actually moving.
- **450 coins default, 600 maximum.** The seed layout holds 638.

---

## Next, in order

1. **Open it on the phone.** Slide the coin count up until the frame rate stops
   holding — that number is the real budget, and every figure above is a
   stand-in for it. Also try the cylinder toggle and see whether you can tell.
2. **Nail down the mechanics of the real machine.** The only thing blocking the
   actual game:
   - What makes it *parallel* — two playfields at once? coins crossing between
     two sides?
   - What do the special slots or holes do when a coin lands in one?
   - Is there a jackpot meter, and what fills it?
   - Anything on the field besides coins — prizes, capsules, special coins?

   The Chinese name on the cabinet would let me search for it directly; four
   searches in English and Chinese found nothing under "Parallel Realms".

---

## Deliberately not built yet

Choices, not oversights:

- **A static coin bed** at the back, rendered but not simulated, to make the
  field look fuller than what is solved. Not needed at 600 coins — held in
  reserve in case a real phone disappoints.
- **Physics in a Web Worker.** Would keep rendering smooth under load. Worth
  doing only if the phone turns out tight.
- **Cabinet art.** There is a marquee, pillars and a hood, but no graphics on
  them. Wants a theme, and the theme depends on the machine above.
- **The game around the simulation:** what a coin costs, what you are playing
  for, bonuses, progression, anything to keep playing for.
