# arcade-gaming

Mobile-first arcade games that run in the browser.

Live: https://anonymousecheese.github.io/arcade-gaming/

## Coin pusher

A two-deck coin pusher with real rigid-body physics and several hundred
simulated coins. Press and slide to aim, lift to drop.

The FPS button opens a performance panel: coin count, physics rate and
collider shape, with live timings. See [PLAN.md](PLAN.md) for what has been
measured and what comes next.

```
node test/physics.test.mjs    # 11 checks, no browser needed
node test/bench.mjs           # deterministic shape and rate comparison
```
