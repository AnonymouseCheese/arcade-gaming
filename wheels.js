/* ------------------------------------------------------------------ *
 *  The drop board's three wheels.
 *
 *  Each has six slices. Going clockwise from the top: a special prize,
 *  nothing, coins, nothing, coins, nothing. One slice is lit. Every coin
 *  that drops through a wheel moves its light one slice on, clockwise; if
 *  the light stops on a prize, that prize is won.
 *
 *  A coin through a wheel also lights it. With all three lit, there is a
 *  bigger prize, and the lights go out again.
 *
 *  For now the special prize is balls (one out of every ball outlet), coins
 *  are a shower from the coin supplies, and all three lit is a bigger
 *  shower - a placeholder.
 * ------------------------------------------------------------------ */

export const SLICES = ['special', null, 'coins', null, 'coins', null];

/** The wheels' state. onPrize(wheel, kind) when a light stops on a prize;
 *  onAllLit() when the third wheel lights up. */
export function createWheels(onPrize, onAllLit) {
  const lit = [0, 1, 2].map(() => Math.floor(Math.random() * SLICES.length));
  const on = [false, false, false];
  return {
    lit, on,
    /** While the wheel spin plays, coins still move the lights and win the
     *  slices' prizes, but light no wheel: the lamps start again after it. */
    hold: false,
    /** A coin dropped through wheel i: move its light on one slice, and light the wheel. */
    advance(i) {
      lit[i] = (lit[i] + 1) % SLICES.length;
      const kind = SLICES[lit[i]];
      if (kind) onPrize(i, kind);
      if (this.hold) return kind;
      on[i] = true;
      if (on.every(Boolean)) { on.fill(false); if (onAllLit) onAllLit(); }
      return kind;
    },
  };
}

/**
 * Paint a wheel's face onto a square canvas: six slices round a hub, the lit
 * one bright, prizes marked (a ball for the special, a stack of coins for
 * coins) and the empty slices with arrows pointing the way the light goes.
 * glow 0..1 brightens the lit slice further while a prize is being won.
 */
export function paintWheel(ctx, size, hex, lit, glow = 0, lampOn = false) {
  const c = size / 2, r = size / 2 - 4, n = SLICES.length;
  const rgb = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  const shade = k => `rgb(${rgb.map(v => Math.round(v * k)).join(',')})`;
  const mix = k => `rgb(${rgb.map(v => Math.round(v + (255 - v) * k)).join(',')})`;
  ctx.clearRect(0, 0, size, size);
  for (let s = 0; s < n; s++) {
    // slice s is centred on -90 + 60 s degrees: the top, then on clockwise
    const mid = (-90 + 360 / n * s) * Math.PI / 180, half = Math.PI / n;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, r, mid - half, mid + half);
    ctx.closePath();
    ctx.fillStyle = s === lit ? mix(0.35 + glow * 0.5) : shade(s % 2 ? 0.42 : 0.6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 3;
    ctx.stroke();
    // what is on it, two thirds of the way out
    const ix = c + Math.cos(mid) * r * 0.64, iy = c + Math.sin(mid) * r * 0.64, u = size / 15;
    ctx.save();
    ctx.translate(ix, iy);
    if (SLICES[s] === 'special') {
      const g = ctx.createRadialGradient(-u * 0.4, -u * 0.4, u * 0.2, 0, 0, u * 1.25);
      g.addColorStop(0, '#bfe0ff'); g.addColorStop(1, '#1f5fe0');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, u * 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0b2a70'; ctx.lineWidth = 2; ctx.stroke();
    } else if (SLICES[s] === 'coins') {
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = '#e9edf4'; ctx.strokeStyle = '#7a8496'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse((k - 1) * u * 0.55, (1 - k) * u * 0.35, u * 0.85, u * 0.45, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
    } else {
      // arrows pointing clockwise round the wheel
      ctx.rotate(mid + Math.PI / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = u * 0.32; ctx.lineCap = 'round';
      for (const dx of [-0.45, 0.45]) {
        ctx.beginPath(); ctx.moveTo((dx - 0.3) * u, -0.55 * u); ctx.lineTo((dx + 0.3) * u, 0); ctx.lineTo((dx - 0.3) * u, 0.55 * u); ctx.stroke();
      }
    }
    ctx.restore();
  }
  // the rim: a ring of light when the wheel is lit, plain when it is not
  ctx.beginPath(); ctx.arc(c, c, r - 2, 0, Math.PI * 2);
  if (lampOn) {
    ctx.shadowColor = '#fff3a0'; ctx.shadowBlur = 18;
    ctx.strokeStyle = '#fffbe0'; ctx.lineWidth = 10; ctx.stroke();
    ctx.shadowBlur = 0;
  } else {
    ctx.strokeStyle = '#8d93a8'; ctx.lineWidth = 6; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(c, c, r * 0.24, 0, Math.PI * 2);
  ctx.fillStyle = '#c8202e'; ctx.fill();
  ctx.strokeStyle = '#f2f4fa'; ctx.lineWidth = 4; ctx.stroke();
}
