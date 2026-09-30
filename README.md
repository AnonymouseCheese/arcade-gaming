# arcade-gaming

Mobile-first arcade games that run in the browser.

Live: https://anonymousecheese.github.io/arcade-gaming/

## Coin pusher

A two-deck coin pusher with real rigid-body physics, several hundred
simulated coins, a payout tray, and sound synthesised from scratch. No build
step and no CDN — three.js and Rapier are committed under `vendor/`.

The machine loads `pile.json`, a pile settled offline so it starts at rest
rather than collapsing into shape while you watch. Regenerate it with
`node test/make-pile.mjs` after changing anything that affects how coins sit:
gravity, friction, collider shape, or the cabinet geometry.

Press and slide to aim, lift to drop. `Sound` toggles audio; `FPS` opens a
panel with coin count, physics rate and collider shape, plus live timings.

See [PLAN.md](PLAN.md) for what has been measured and what comes next.

```
node test/physics.test.mjs    # 18 checks, no browser needed
node test/make-pile.mjs      # regenerate the settled pile (~2 min)
node test/chute.mjs          # does the drop board jam?
node test/feel.mjs           # why does it shed coins when idle?
node test/bench.mjs           # collider shape and physics rate, deterministic
node test/overlap.mjs         # is the box collider visible?
```

**Cache rule:** every intra-app import carries `?v=N`, and `index.html`
references `app.js?v=N` / `style.css?v=N`. Bump them all together, or the
browser will load two separate copies of `config.js`.
