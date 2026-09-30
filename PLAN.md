# Coin pusher — plan

Working notes for the arcade-gaming repo. Started 2026-09-28, updated
2026-09-30.

Live: https://anonymousecheese.github.io/arcade-gaming/

---

## Where this is

A two-deck coin pusher with real rigid-body physics, a pachinko-style drop
chute, a payout tray and synthesised sound. No build step, no CDN.

| File | What it is |
| --- | --- |
| `config.js` | Every dimension and feel knob. One place to tune. |
| `physics.js` | The machine — cabinet, pusher, chute, tray, coin pool, step loop. No three.js, no DOM, so it runs under Node and is tested exactly as it ships. |
| `app.js` | Renderer, input, sound cues, performance panel. |
| `audio.js` | All the sound, synthesised. No audio files. |
| `pile.json` | A pile settled offline. **Generated — do not hand-edit.** |
| `vendor/` | three.js and Rapier, committed. |
| `test/` | See below. All runnable with plain `node`. |

```
node test/physics.test.mjs   # 18 checks, no browser needed
node test/make-pile.mjs      # regenerate pile.json (~2 min)
node test/chute.mjs          # does the drop board jam?
node test/feel.mjs           # why does it shed coins when idle?
node test/bench.mjs          # collider shape and physics rate
node test/overlap.mjs        # is the box collider visible?
```

**Controls:** press and slide to aim, lift to drop. `Sound` toggles audio,
`FPS` opens the performance panel.

**Cache rule:** every intra-app import carries `?v=N`, and `index.html`
references `app.js?v=N` / `style.css?v=N`. Bump them **all together**, or the
browser quietly loads two copies of `config.js`.

---

## What was wrong, and what it actually was

### "The coins are too light — they drop even when I'm not moving"

The weight was a red herring, and the measurement said so. Sweeping gravity,
friction and damping across six settings moved idle drain by almost nothing
(`test/feel.mjs`), because **the pusher is kinematic** — it shoves through any
amount of friction with unlimited force. Sweeping stroke length, cycle period
and starting coin count did nothing either.

The real cause: the machine was filled from an **artificial grid above its
natural capacity**, and then spent about two minutes collapsing into shape,
shedding coins the whole way. That collapse was happening on the player's
time, which is exactly what it looked like — a machine leaking for no reason.

**Fix: settle the pile offline once and ship it.** `test/make-pile.mjs`
over-fills to 620 coins, runs until a full 20-second window passes with
nothing falling (360 simulated seconds), and records every coin's transform to
`pile.json`. The app loads that and starts at rest.

| | coins lost in two idle minutes |
| --- | --- |
| grid seed | 137 |
| **shipped pile** | **12** |

Taking coins off the *top* is how the slider works for smaller piles — lifting
weight off a settled pile leaves the rest settled.

Gravity did go up (−600 → −900) because heavier is what was asked for and it
costs nothing. It just was not the bug.

### The box collider is gone

The settled pile is 378 coins, not the 600 the slider used to allow — and at
that size a true cylinder collider costs **12.6 ms/step, 38% of budget** on a
15-watt laptop. So the box-shaped-collider trick is retired. Coins are real
discs now, which also matters for the chute, where a single coin is under
close watch. `test/overlap.mjs` and the box option remain if it is ever needed
again.

---

## The drop chute

A board at the back that a coin falls through **on edge, behind glass**: two
antlers throw it one way or the other, then 22 pins scatter it. Aim sets where
it enters; the board decides where it lands.

Measured: **89 of 90 clear it**, mean scatter 2.4 coin widths, drift 0.09
(symmetric), aim-to-landing correlation 0.85 — aim matters without deciding.

Getting there took four wrong versions, each caught by `test/chute.mjs` rather
than by eye. Worth recording, because every one of them looked fine in the
source:

1. **Pins 3.0 apart with radius 0.42 — a 2.16 gap for a 2.4 coin.** 89 of 90
   wedged. A pin lattice has to be sized against the coin, sideways *and*
   diagonally to the next staggered row.
2. **A pocket between the outermost pin and the side wall**, 0.5 units wide on
   staggered rows: a coin could enter but not pass. Rows now stop well short
   of the walls.
3. **Deck friction in the chute.** A coin resting on a pin and touching a
   grippy wall simply stuck. The board is slick now, like real plastic.
4. **Overlapping the antlers to remove the apex — which created a worse one.**
   Each bar is highest at its *inner* end, so crossing them puts two high
   corners either side of centre with a dip between: a V-shaped well that
   caught 25 of 25 centre drops and that no nudge could shake loose. The
   antlers now leave a clear gap wider than a coin, so there is no feature at
   the centre at all.

There is still an **anti-jam nudge**: a coin stuck in the chute for 1.2s gets
a flick with a roll on it. A real machine vibrates. Note it sets a *velocity* —
the first version applied an impulse, which has to be divided by mass and
fought against gravity of 900, and which was uniform-random about zero, so it
fired 125 times and moved nothing.

---

## What was learned earlier

- **Rapier has no fast path for cylinder-vs-cylinder contacts.** That drove
  every early performance decision. A 10-sided prism is 5× *worse* than a
  cylinder, so "nearly round" is the worst of both worlds.
- **Sleeping buys nothing in a coin pusher.** The carpet is one connected
  contact island touching a pusher that never stops, so the whole field stays
  awake by construction — measured at 393/393.
- **Multi-threaded physics is unavailable.** It needs COOP/COEP headers, which
  GitHub Pages cannot set. Single-threaded WASM only.
- **The payout rhythm came out of the physics, not a script.** 19–23% of coins
  dropped come back, the gutters eat more than the lip pays, and wins arrive
  in bursts.

---

## Next

1. **Open it on the phone.** The performance panel has coin count, physics
   rate, collider shape and live timings. Everything above is measured on a
   2021 laptop that is slower single-core than a modern iPhone, so these are a
   floor, not a ceiling.
2. **A photo of the real machine.** Six searches in English and Chinese found
   nothing under "Parallel Realms". Web search returns text to me, not
   pictures — but I can read an image file on this PC. Put one outside the
   repo (it is public) and I will build to it. Most useful: the playfield from
   where you stand, the whole cabinet, and anything with the name on it.

## Deliberately not built yet

- **Cabinet art.** There is a marquee, pillars, a hood and a lit drop board,
  but no graphics on any of it. Wants a theme, and the theme depends on the
  machine above.
- **A static coin bed** behind the pile, rendered but not simulated, if a real
  phone turns out tighter than this laptop suggests.
- **Physics in a Web Worker**, same condition.
- **The game around the simulation:** what a coin costs, what you are playing
  for, bonuses, progression.
