/* ------------------------------------------------------------------ *
 *  Machine dimensions, shared by the physics and the renderer.
 *
 *  Units: 1 world unit = 1 cm, so a coin is 2.4 cm across.
 *  Gravity is deliberately softer than real life - it keeps peak
 *  velocities low enough that thin discs cannot punch through each
 *  other between physics steps, and a heavy machine looks right anyway.
 * ------------------------------------------------------------------ */

export const CFG = {
  /* ---- how heavy the coins feel ----
   * Gravity is the main lever. Friction is what stops the pile marching
   * forward and shedding coins when nobody is playing: the pusher drives
   * the carpet, and friction against the deck is the only thing resisting.
   * Tuned with test/feel.mjs - do not eyeball these. */
  gravity:      -900,
  coinFriction:   0.55,
  deckFriction:   0.80,
  linDamp:        0.55,
  angDamp:        0.80,
  restitution:    0.02,

  coinShape: 'cylinder',  // what the SOLVER sees - 'cylinder' or 'box'.
                       // A real disc. Box is about twice as cheap but lets
                       // coins overlap slightly, and that shows badly on a
                       // single coin bouncing down the drop chute. At the
                       // pile sizes this machine actually settles at, the
                       // cylinder is affordable - see test/bench.mjs.
  coinR:       1.20,   // visible radius
  coinT:       0.30,   // visible thickness
  colT:        0.40,   // collider thickness - fatter than the visible coin.
                       // Invisible to the eye, but it stops thin discs from
                       // grinding into one another and jittering.

  wallHalfW:  14,      // cabinet inner half-width. Narrower than life, because
                       // a phone is a tall window and a wide machine ends up
                       // as a small object marooned in the middle of it.
  floorHalfW: 12.8,    // lower playfield half-width. The daylight either side
                       // is the gutter, and its width sets the house edge:
                       // 2.0 returns 20%, 1.2 returns 30%, 0.6 returns 50%
                       // and the pile drains. Measured in test/gutter.mjs.
  gutterFromZ: -10,    // gutters only open up from here forward

  backZ:      -26,
  lipZ:        22,     // front edge of the lower deck. Past this, you win.
                       // Deep, so the field you play on dominates the view
                       // instead of competing with the deck above it.

  upperY:      5.5,    // upper deck floor height. Lower than before: a tall
                       // step made the two decks read as a flight of stairs.
  upperFrontZ: -2,     // upper deck front edge - coins tip off here

  slabRise:    0.85,   // pusher slab top, above its own deck
  slabBackZ:  -34,     // far enough back that no gap ever opens behind it
  lowFaceZ:   -6,      // lower slab front face, at the back of the stroke
  upFaceZ:    -12,     // upper slab front face, same
  stroke:      5.5,
  period:      3.2,    // seconds for one full out-and-back cycle

  dropY:      11.5,
  dropZ:      -7,      // over the exposed part of the upper deck
  aimLimit:    9.5,    // how far along the chute you can aim

  /* ---- the drop chute ----
   * A board at the back that the coin falls through on edge, behind glass.
   * Two antlers throw it one way or the other, then a field of pins
   * scatters it, so where it lands is only partly yours to choose. */
  chuteZ:     -20,     // the plane the board lives in
  chuteTopY:   24.5,   // a coin enters here
  chuteExitY:  10.2,   // and falls out of the bottom here
  chuteHalfW:  11.0,
  chuteGap:     0.62,  // depth of the channel - one coin, on edge
  chuteFriction: 0.08, // the board is slick, unlike the decks

  /* The antlers are staggered in height, not mirrored. Two bars meeting at
   * a symmetric apex give a coin a balance point: it lands dead centre, its
   * velocity falls under the sleep threshold, and it perches there forever.
   * No amount of friction fixes a real equilibrium - the apex has to go.
   * Staggering also means a coin genuinely changes direction twice. */
  antlerY:     21.5,
  antlerX:      4.43,  // centres. Set so the inner tips stop short of the
                       // middle and leave a gap wider than a coin.
  antlerStagger: 0,    // mirrored, and NOT overlapping. Each bar is highest
                       // at its inner end, so crossing them puts two high
                       // corners either side of centre with a dip between -
                       // a V-shaped well that caught 25 of 25 centre drops
                       // and that no nudge could shake loose. A clear gap in
                       // the middle has no feature to rest on at all.
  chuteNudgeAfter: 1.2, // seconds stuck in the chute before a shove
  chuteNudge:      5.5, // flick speed. A real machine vibrates; this is that.
  antlerHalfL:  3.1,
  antlerTilt:   0.42,  // radians

  /* The pin lattice has to be sized against the coin, not eyeballed. A coin
   * is 2.4 across, so every gap between neighbouring pins - sideways AND
   * diagonally to the next staggered row - must clear that with room to
   * spare, or coins simply sit on top of the first row and never come down.
   * The first version used 3.0 spacing with 0.42 pins: a 2.16 gap for a 2.4
   * coin. 89 of 90 test drops wedged. See test/chute.mjs. */
  pegTopY:     17.0,
  pegRows:      3,
  pegDY:        3.0,
  pegDX:        3.6,
  pegR:         0.30,

  /* ---- the payout tray ----
   * Coins over the lip land in a real tray with real walls and sit there a
   * moment before being cleared. Watching your winnings clatter in is the
   * whole payoff, and it costs almost nothing: the tray never holds many. */
  trayY:      -5,      // tray floor, top surface
  trayFrontZ:  31,     // inside face of the tray's front wall
  trayHold:    2.2,    // seconds a coin rests there before it is swept away
  payLine:    -1.6,    // drop past this, ahead of the lip, and it is a win

  killY:      -9,      // below this a coin has left play entirely

  maxCoins:  800,
};

export const COLOUR = {
  coin:   0xffc83d,   // gold, and bright enough to read as money
  deck:   0x11414f,   // deep teal. Cool and dark under warm coins, so the
  wall:   0x0d313d,   // coins are the brightest thing on screen by a mile.
  trim:   0x09222b,
  pusher: 0x1d6076,
  tray:   0x071a22,
  chute:  0x103642,
  glass:  0xbfe9f5,
  peg:    0xe4f6fb,
  antler: 0xff7a3d,
  panel:  0x17798f,   // lit side panels
  neon:   0xff3d8b,   // magenta
  neon2:  0x2de2e6,   // cyan
};
