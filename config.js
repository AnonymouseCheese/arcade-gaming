/* ------------------------------------------------------------------ *
 *  Machine dimensions, shared by the physics and the renderer.
 *
 *  Units: 1 world unit = 1 cm, so a coin is 2.4 cm across.
 *  Gravity is deliberately softer than real life - it keeps peak
 *  velocities low enough that thin discs cannot punch through each
 *  other between physics steps, and a heavy machine looks right anyway.
 * ------------------------------------------------------------------ */

export const CFG = {
  gravity:    -600,

  coinShape:  'box',   // what the SOLVER sees - 'box' or 'cylinder'. The coin
                       // you look at is always a disc; see coinCollider().
  coinR:       1.20,   // visible radius
  coinT:       0.30,   // visible thickness
  colT:        0.40,   // collider thickness - fatter than the visible coin.
                       // Invisible to the eye, but it stops thin discs from
                       // grinding into one another and jittering.

  wallHalfW:  17,      // cabinet inner half-width
  floorHalfW: 15,      // lower playfield half-width. The 2 units of daylight
                       // on each side is the gutter the house eats.
  gutterFromZ: -10,    // gutters only open up from here forward

  backZ:      -26,
  lipZ:        16,     // front edge of the lower deck. Past this, you win.

  upperY:      7.5,    // upper deck floor height
  upperFrontZ:  0,     // upper deck front edge - coins tip off here

  slabRise:    0.85,   // pusher slab top, above its own deck
  slabBackZ:  -34,     // far enough back that no gap ever opens behind it
  lowFaceZ:   -6,      // lower slab front face, at the back of the stroke
  upFaceZ:    -12,     // upper slab front face, same
  stroke:      5.5,
  period:      3.2,    // seconds for one full out-and-back cycle

  dropY:      11.5,
  dropZ:      -7,      // over the exposed part of the upper deck
  aimLimit:   13,

  /* ---- the payout tray ----
   * Coins over the lip land in a real tray with real walls and sit there a
   * moment before being cleared. Watching your winnings clatter in is the
   * whole payoff, and it costs almost nothing: the tray never holds many. */
  trayY:      -5,      // tray floor, top surface
  trayFrontZ:  25,     // inside face of the tray's front wall
  trayHold:    2.2,    // seconds a coin rests there before it is swept away
  payLine:    -1.6,    // drop past this, ahead of the lip, and it is a win

  killY:      -9,      // below this a coin has left play entirely

  maxCoins:  800,
};

export const COLOUR = {
  coin:   0xf2c14b,
  deck:   0x39435e,
  wall:   0x222a3d,
  trim:   0x171d2c,
  pusher: 0x4a5878,
  tray:   0x11161f,
};
