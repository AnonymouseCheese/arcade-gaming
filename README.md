# arcade-gaming

Mobile-first arcade games that run in the browser.

Live: https://anonymousecheese.github.io/arcade-gaming/

## Coin pusher

A coin pusher with real rigid-body physics: three pushers, side stages and
ramps, several hundred simulated coins, and sound synthesised from scratch.
Coins go in at the top, past two swinging wipers and a board of pins, and
out through one of three counting wheels or the gaps between them. No build
step and no CDN — three.js and Rapier are committed under `vendor/`.

The physics runs on its own thread (`physics-worker.js`). The machine is
built from `machine.json` and starts from `field-pile.json`, a pile settled
offline so it starts at rest rather than collapsing into shape while you
watch.

Tap to drop a coin; drag to turn the view. `?worker=0` runs the physics on
the page instead.

**Cache rule:** every intra-app import carries `?v=N`. A module imported in
more than one place must carry the same `?v` everywhere, or the browser
loads two separate copies of it.
