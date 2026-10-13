/* ------------------------------------------------------------------ *
 *  The screen over the coin slot: the wheel spin, painted on a canvas.
 *
 *  Idle, it shows the ring of prizes round a glowing portal, and the three
 *  lamps still to light. When all three wheels are lit, a show plays:
 *
 *    spin      a light races round the ring, slows, stops on a prize
 *    land      that prize flashes
 *    vortex    (Black Hole only) the portal tears open into a fiery whirl
 *    draw      (Black Hole only) its own prizes flick past in the middle
 *    congrats  the prize, in a banner - and it is paid out
 *
 *  Down the right side is the star bar, ten bars of star power. When it is
 *  full a show of its own plays - STAR TOWER! - and the towers come out.
 *
 *  Nothing here touches the machine: onPrize(prize, mult) is called when
 *  the banner goes up, and onTowers() as the star tower show starts; the
 *  game does the rest.
 * ------------------------------------------------------------------ */
import { RING, HOLE, STAR_FULL } from './spin.js?v=41';
import { starPath } from './wheels.js?v=41';

const T = { spin: 3.4, land: 0.9, vortex: 2.4, draw: 1.9, reveal: 0.6, congrats: 2.6, army: 3.4 };
const TAU = Math.PI * 2;
const easeOut = u => 1 - (1 - u) ** 3;

export function createScreen(canvas, hooks = {}) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H * 0.55, R = H * 0.30, SR = H * 0.082;     // the ring, and each prize on it
  let time = 0, idleDraw = 0, lamps = [false, false, false], at = 0;  // at: the lit slot when idle
  let show = null, pushing = false, towersComing = false;
  let star = 0, starShown = 0, starStep = 0;                          // the star bar: bars won, bars lit so far
  const queue = [];

  const slotXY = k => { const a = -Math.PI / 2 + TAU * k / RING.length; return [cx + Math.cos(a) * R, cy + Math.sin(a) * R]; };

  function next() {
    const job = queue.shift();
    if (!job) { show = null; return; }
    if (job.towers) { show = { ...job, phase: 'army', t: 0, out: false }; return; }
    const { result } = job;
    // the light runs two laps and on to the prize
    const steps = RING.length * 2 + ((result.slot - at) % RING.length + RING.length) % RING.length;
    const holeSteps = result.hole === undefined ? 0 : HOLE.length * 3 + result.hole;
    show = { ...job, phase: 'spin', t: 0, from: at, steps, holeSteps, shown: at, holeShown: 0, paid: false };
  }

  function phaseDone() {
    const s = show;
    const order = s.towers ? ['army'] : s.result.hole === undefined ? ['spin', 'land', 'congrats'] : ['spin', 'land', 'vortex', 'draw', 'reveal', 'congrats'];
    const i = order.indexOf(s.phase);
    if (i === order.length - 1) { next(); return; }
    s.phase = order[i + 1]; s.t = 0;
    if (s.phase === 'land') hooks.onLand?.();
    if (s.phase === 'vortex') hooks.onHole?.();
    if (s.phase === 'reveal') hooks.onLand?.();
    if (s.phase === 'congrats') { hooks.onPrize?.(s.result.prize, s.mult); s.paid = true; }
  }

  /* ---------------- painting ---------------- */

  function frame() {
    g.clearRect(0, 0, W, H);
    const m = 10, top = H * 0.40;
    // the arch
    g.save();
    g.beginPath();
    g.moveTo(m, H - m); g.lineTo(m, top);
    g.ellipse(cx, top, cx - m, top - m, 0, Math.PI, TAU);
    g.lineTo(W - m, H - m); g.closePath();
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b1d5c'); bg.addColorStop(0.6, '#1a2f8f'); bg.addColorStop(1, '#4a1f86');
    g.fillStyle = bg; g.fill();
    g.clip();
    // light rays from the middle
    g.globalAlpha = 0.10;
    for (let k = 0; k < 12; k++) {
      const a = time * 0.15 + TAU * k / 12;
      g.beginPath(); g.moveTo(cx, cy);
      g.arc(cx, cy, W, a, a + 0.12); g.closePath();
      g.fillStyle = '#9fd8ff'; g.fill();
    }
    g.globalAlpha = 1;
    g.restore();
    // the frame
    g.save();
    g.beginPath();
    g.moveTo(m, H - m); g.lineTo(m, top);
    g.ellipse(cx, top, cx - m, top - m, 0, Math.PI, TAU);
    g.lineTo(W - m, H - m); g.closePath();
    g.lineWidth = 14; g.strokeStyle = '#f2c94c'; g.shadowColor = '#ffd86b'; g.shadowBlur = 18; g.stroke();
    g.lineWidth = 4; g.strokeStyle = '#3ff0ff'; g.shadowBlur = 0; g.stroke();
    g.restore();
  }

  function portal(r, hot = 0) {
    const grd = g.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    grd.addColorStop(0, hot ? '#fff3c4' : '#e6fbff');
    grd.addColorStop(0.35, hot ? '#ff8a1f' : '#38c8ff');
    grd.addColorStop(0.75, hot ? '#b3160b' : '#1546c9');
    grd.addColorStop(1, 'rgba(10,20,80,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    // the swirl
    g.save(); g.translate(cx, cy);
    for (let k = 0; k < 4; k++) {
      g.rotate(TAU / 4);
      g.beginPath();
      for (let s = 0; s <= 30; s++) {
        const u = s / 30, a = u * 3.2 + time * (hot ? 7 : 2.2), rr = r * (0.15 + u * 0.8);
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        s ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.strokeStyle = hot ? 'rgba(255,220,120,0.75)' : 'rgba(200,245,255,0.55)';
      g.lineWidth = hot ? 6 : 4; g.stroke();
    }
    g.restore();
  }

  function holeIcon(x, y, r) {
    g.fillStyle = '#05030a'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    g.save(); g.translate(x, y);
    for (let k = 0; k < 3; k++) {
      g.rotate(TAU / 3);
      g.beginPath(); g.arc(0, 0, r * (0.55 + k * 0.12), time * 3, time * 3 + 2.2);
      g.strokeStyle = ['#ff6a2a', '#ffb02e', '#ff2e4d'][k]; g.lineWidth = 3; g.stroke();
    }
    g.restore();
  }

  function slot(k, light = 0, dim = false) {
    const [x, y] = slotXY(k), p = RING[k], r = SR * (1 + light * 0.15);
    g.save();
    if (light) { g.shadowColor = '#fff6c0'; g.shadowBlur = 40 * light; }
    g.fillStyle = dim ? '#0a1030' : '#101a46';
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    g.lineWidth = 7; g.strokeStyle = light ? '#fff6c0' : p.color; g.stroke();
    g.restore();
    if (p.kind === 'hole') { holeIcon(x, y, r * 0.72); return; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (p.kind === 'star') {
      starPath(g, x, y - r * 0.12, r * 0.66);
      g.fillStyle = dim ? '#6b6232' : p.color; g.fill();
      g.fillStyle = '#3a2400';
    } else g.fillStyle = dim ? 'rgba(255,255,255,0.4)' : '#ffffff';
    g.font = `900 ${Math.round(r * (p.label.length > 2 ? 0.48 : p.kind === 'star' ? 0.5 : 0.72))}px system-ui, sans-serif`;
    g.fillText(p.label, x, y - r * (p.kind === 'star' ? 0.06 : 0.16));
    // what it is, small, under the number - inside the circle, so ten fit round the ring
    g.fillStyle = dim ? 'rgba(255,255,255,0.35)' : p.color;
    g.font = `800 ${Math.round(SR * 0.27)}px system-ui, sans-serif`;
    g.fillText(p.sub, x, y + r * 0.56);
  }

  /** The star bar, down the right side: ten bars, lit from the bottom. */
  function starBar(flash = 0) {
    const w = W * 0.07, x = W * 0.84, top = H * 0.30, bottom = H * 0.86, gap = 4;
    const h = (bottom - top - gap * (STAR_FULL - 1)) / STAR_FULL;
    for (let k = 0; k < STAR_FULL; k++) {
      const y = bottom - (k + 1) * h - k * gap, on = k < starShown;
      g.save();
      if (on) { g.shadowColor = '#ffe680'; g.shadowBlur = flash ? 26 : 12; }
      const grd = g.createLinearGradient(x, y, x + w, y);
      if (on) { grd.addColorStop(0, '#ffb01f'); grd.addColorStop(0.5, flash && Math.sin(time * 20 - k) > 0 ? '#ffffff' : '#fff27a'); grd.addColorStop(1, '#ffb01f'); }
      else { grd.addColorStop(0, '#141c4a'); grd.addColorStop(1, '#1d2766'); }
      g.fillStyle = grd;
      g.beginPath(); g.roundRect(x, y, w, h, 6); g.fill();
      g.restore();
      g.lineWidth = 2; g.strokeStyle = on ? '#fff6c0' : '#3a4a9a';
      g.beginPath(); g.roundRect(x, y, w, h, 6); g.stroke();
    }
    // a star over it, and the count under it
    const sx = x + w / 2, sy = top - H * 0.075;
    g.save();
    g.shadowColor = '#ffe680'; g.shadowBlur = starShown >= STAR_FULL || flash ? 30 : 10;
    starPath(g, sx, sy, H * 0.055 * (1 + (flash ? 0.12 * Math.sin(time * 10) : 0)));
    g.fillStyle = starShown ? '#ffe866' : '#6b6232'; g.fill();
    g.restore();
    g.lineWidth = 2; g.strokeStyle = '#a8530a'; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${Math.round(H * 0.034)}px system-ui, sans-serif`;
    g.fillStyle = '#ffe866';
    g.fillText(`${starShown}/${STAR_FULL}`, sx, bottom + H * 0.04);
  }

  function lampIcons(y) {
    for (let k = 0; k < 3; k++) {
      const x = cx + (k - 1) * SR * 0.95, on = lamps[k];
      g.save();
      if (on) { g.shadowColor = '#bfe6ff'; g.shadowBlur = 22; }
      g.fillStyle = on ? '#e9f7ff' : '#1d2a66';
      g.beginPath(); g.arc(x, y, SR * 0.32, 0, TAU); g.fill();
      g.restore();
      bolt(x, y, SR * 0.26, on ? '#2a6dff' : '#4a5aa0');
    }
  }

  function bolt(x, y, s, color) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x + s * 0.15, y - s); g.lineTo(x - s * 0.55, y + s * 0.15); g.lineTo(x - s * 0.02, y + s * 0.12);
    g.lineTo(x - s * 0.2, y + s); g.lineTo(x + s * 0.55, y - s * 0.18); g.lineTo(x + s * 0.02, y - s * 0.15);
    g.closePath(); g.fill();
  }

  function centreText(lines) {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [text, size, color, dy] of lines) {
      g.font = `900 ${size}px system-ui, sans-serif`;
      g.lineWidth = Math.max(3, size / 9); g.strokeStyle = 'rgba(0,0,30,0.85)';
      g.strokeText(text, cx, cy + dy);
      g.fillStyle = color; g.fillText(text, cx, cy + dy);
    }
  }

  function title(text, color = '#ffe27a') {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${Math.round(H * 0.075)}px system-ui, sans-serif`;
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,30,0.9)';
    g.strokeText(text, cx, H * 0.11); g.fillStyle = color; g.fillText(text, cx, H * 0.11);
  }

  function paint() {
    frame();
    const s = show;
    starBar(s?.towers ? 1 : 0);
    if (s?.towers) {
      title('STAR TOWER!', '#ffe866');
      portal(R * (0.7 + 0.08 * Math.sin(time * 6)), 1);
      // a big star, spinning in
      const u = Math.min(1, s.t / 0.6);
      g.save(); g.translate(cx, cy); g.rotate((1 - u) * 4); g.scale(u, u);
      g.shadowColor = '#fff3a0'; g.shadowBlur = 40;
      starPath(g, 0, 0, R * 0.62); g.fillStyle = '#ffe866'; g.fill();
      g.shadowBlur = 0; g.lineWidth = 6; g.strokeStyle = '#a8530a'; g.stroke();
      g.restore();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `900 ${Math.round(H * 0.07)}px system-ui, sans-serif`;
      g.fillStyle = '#3a2400'; g.fillText('ARMY', cx, cy + H * 0.01);
      centreText([['PUSH THEM OVER THE EDGE!', Math.round(H * 0.05), '#ffffff', R + SR * 0.4]]);
      return;
    }
    if (!s && towersComing) {
      title('STAR TOWER', '#ffe866');
      portal(R * (0.9 + 0.1 * Math.sin(time * 5)), 1);
      centreText([['HERE THEY COME!', Math.round(H * 0.1), '#ffffff', -H * 0.03], ['LOOK AT THE MIDDLE', Math.round(H * 0.05), '#ffe866', H * 0.09]]);
      return;
    }
    if (!s && pushing) {
      title('SUPER PUSH', '#3dff7a');
      portal(R * (0.9 + 0.1 * Math.sin(time * 5)), 0);
      centreText([['PUSHING!', Math.round(H * 0.12), '#ffffff', -H * 0.03], ['LOOK AT THE MIDDLE', Math.round(H * 0.05), '#3dff7a', H * 0.09]]);
      return;
    }
    if (!s) {
      title('WHEEL SPIN');
      portal(R * 0.62);
      for (let k = 0; k < RING.length; k++) slot(k, k === at ? 0.35 + 0.25 * Math.sin(time * 3) : 0);
      centreText([['LIGHT UP ALL 3', Math.round(H * 0.05), '#ffffff', -SR * 0.55]]);
      lampIcons(cy + SR * 0.35);
      return;
    }
    if (s.phase === 'spin' || s.phase === 'land') {
      title(s.mult > 1 ? 'WHEEL SPIN ×2' : 'WHEEL SPIN');
      portal(R * 0.62);
      const flash = s.phase === 'land' ? (Math.sin(s.t * 28) > 0 ? 1 : 0.4) : 1;
      for (let k = 0; k < RING.length; k++) {
        const back = (s.shown - k + RING.length) % RING.length;      // the trail behind the light
        const light = k === s.shown ? flash : s.phase === 'spin' && back > 0 && back < 3 ? 0.5 / back : 0;
        slot(k, light, s.phase === 'land' && k !== s.shown);
      }
      centreText([[s.phase === 'land' ? '!' : 'SPIN', Math.round(H * 0.1), '#ffffff', 0]]);
      return;
    }
    if (s.phase === 'vortex') {
      const u = s.t / T.vortex;
      title('BLACK HOLE!', '#ff9a3d');
      for (let k = 0; k < RING.length; k++) slot(k, 0, true);
      g.save(); g.globalAlpha = Math.min(1, u * 1.6);
      portal(R * (0.6 + u * 1.4), 1);
      g.restore();
      // sparks drawn in
      for (let k = 0; k < 40; k++) {
        const a = k * 2.4 + time * 4, d = ((k * 37 + time * 300) % (W * 0.6)) + 20;
        g.fillStyle = k % 2 ? '#ffd27a' : '#ff5a2a';
        g.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.7, 4, 4);
      }
      return;
    }
    // draw, reveal, congrats
    title(s.result.hole === undefined ? 'CONGRATS!' : s.phase === 'congrats' ? 'CONGRATS!' : 'BLACK HOLE', '#ffe27a');
    portal(R * (s.result.hole === undefined ? 0.62 : 1.1), s.result.hole === undefined ? 0 : 1);
    let p = s.result.prize;
    if (s.phase === 'draw') p = HOLE[s.holeShown % HOLE.length];
    const pulse = s.phase === 'draw' ? 1 : 1 + 0.06 * Math.sin(time * 9);
    // the prize, big in the middle
    g.save(); g.translate(cx, cy); g.scale(pulse, pulse); g.translate(-cx, -cy);
    g.fillStyle = 'rgba(8,12,40,0.82)';
    g.beginPath(); g.roundRect(cx - W * 0.27, cy - H * 0.2, W * 0.54, H * 0.4, 28); g.fill();
    g.lineWidth = 6; g.strokeStyle = p.color; g.stroke();
    const big = p.kind === 'push' ? 'SUPER PUSH' : p.label, n = (p.times || 1) * s.mult;
    centreText([[big, Math.round(H * (p.kind === 'push' ? 0.11 : 0.17)), '#ffffff', -H * 0.04],
                [p.kind === 'push' ? (n > 1 ? `×${n}` : 'ALL THE WAY BACK') : p.kind === 'double' ? 'NEXT SPIN' : (s.mult > 1 && s.phase === 'congrats' && !p.full ? `${p.kind === 'star' ? 'STAR POWER' : p.sub} ×2` : p.kind === 'star' ? 'STAR POWER' : p.sub), Math.round(H * 0.055), p.color, H * 0.11]]);
    g.restore();
    if (s.phase === 'congrats') {
      // a ribbon of confetti
      for (let k = 0; k < 60; k++) {
        const x = (k * 97 + s.t * 220 * (1 + k % 3)) % W, y = ((k * 53) % H + s.t * 160 * (1 + k % 2)) % H;
        g.fillStyle = ['#ffd23d', '#ff3b52', '#3dff7a', '#5fd0ff', '#c44bff'][k % 5];
        g.fillRect(x, y, 8, 14);
      }
    }
  }

  return {
    get busy() { return !!show || queue.length > 0; },
    /** Bars of star power won so far (the bar lights up to it, a bar at a time). */
    setStar(n) { star = Math.max(0, Math.min(STAR_FULL, n)); idleDraw = 1; },
    /** The star bar is full: queue the star tower show. */
    towers() { queue.push({ towers: true }); if (!show) next(); },
    /** Queue a show for this spin result; mult is a ×2 won on the last spin. */
    play(result, mult = 1) { queue.push({ result, mult }); if (!show) next(); },
    /** The pushers are doing a Super Push: the screen says so, between shows. */
    setPushing(on) { if (on !== pushing) { pushing = on; idleDraw = 1; } },
    /** The pushers are bringing out the star towers: the screen says so, between shows. */
    setTowersComing(on) { if (on !== towersComing) { towersComing = on; idleDraw = 1; } },
    /** The three lamps under the wheels, for the idle screen. */
    setLamps(on) { if (on.some((v, i) => v !== lamps[i])) { lamps = on.slice(); idleDraw = 1; } },
    /** Advance by dt seconds; true if the canvas was repainted. */
    update(dt) {
      time += dt;
      // the star bar catches up a bar at a time
      if (starShown !== star && (starStep += dt) > (star > starShown ? 0.14 : 0.04)) {
        const up = star > starShown;
        starStep = 0; starShown += up ? 1 : -1; idleDraw = 1;
        if (up) hooks.onStar?.(starShown);
      }
      const s = show;
      if (!s) {
        idleDraw += dt;
        if (idleDraw < 1 / 15) return false;          // idle: a gentle 15 frames a second
        idleDraw = 0; paint(); return true;
      }
      s.t += dt;
      if (s.phase === 'spin') {
        const k = Math.floor(easeOut(Math.min(1, s.t / T.spin)) * s.steps);
        const now = (s.from + k) % RING.length;
        if (now !== s.shown) { s.shown = now; hooks.onTick?.(); }
        if (s.t >= T.spin) { s.shown = s.result.slot; at = s.result.slot; }
      }
      if (s.phase === 'army' && !s.out && s.t > 0.6) { s.out = true; hooks.onTowers?.(); }
      if (s.phase === 'draw') {
        const k = Math.floor(easeOut(Math.min(1, s.t / T.draw)) * s.holeSteps);
        if (k !== s.holeShown) { s.holeShown = k; hooks.onTick?.(); }
      }
      if (s.t >= T[s.phase]) phaseDone();
      paint();
      return true;
    },
  };
}
