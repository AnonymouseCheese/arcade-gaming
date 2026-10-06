# arcade-gaming

Mobile-first arcade games that run in the browser.

Live: https://anonymousecheese.github.io/arcade-gaming/

## Coin pusher

A two-deck coin pusher with real rigid-body physics, several hundred
simulated coins, a payout tray, and sound synthesised from scratch. No build
step and no CDN — three.js and Rapier are committed under `vendor/`.

The machine loads `pile.json`, a pile settled offline so it starts at rest
rather than collapsing into shape while you watch.

Press and slide to aim, lift to drop. `Sound` toggles audio; `FPS` opens a
panel with coin count, physics rate and collider shape, plus live timings.

A new machine is in testing at `play.html`
(https://anonymousecheese.github.io/arcade-gaming/play.html). Its physics
runs on its own thread; it loads `machine.json` and the settled `field-pile.json`.

**Cache rule:** every intra-app import carries `?v=N`, and `index.html`
references `app.js?v=N` / `style.css?v=N`. Bump them all together, or the
browser will load two separate copies of `config.js`.
