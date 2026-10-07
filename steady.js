/* ------------------------------------------------------------------ *
 *  Resting coins are drawn still.
 *
 *  A few coins in a pile never quite settle in the physics: pressed between
 *  their neighbours, they jiggle in place by a millimetre or less, several
 *  times a second - the solver going round in a small loop. Real coins would
 *  sit still, so the drawing holds them still. Each coin has a rest point
 *  that follows it slowly, and is drawn up to HOLD cm (and HOLD_DEG degrees)
 *  closer to its rest point than the physics has it. A jiggle smaller than
 *  that never shows; a coin that is really going somewhere is drawn where
 *  it is, at most HOLD behind. The physics itself is untouched.
 * ------------------------------------------------------------------ */
export function createSteady(n, { hold = 0.1, holdDeg = 4, follow = 0.15, jump = 2 } = {}) {
  const ax = new Float32Array(n * 3), aq = new Float32Array(n * 4);
  const holdRad = holdDeg * Math.PI / 180;
  return {
    /** One physics step for the coin in slot s. xf holds its pose from the
     *  physics at offset i ([x, y, z, qx, qy, qz, qw]); the pose to draw goes
     *  into out at offset o. fresh: the coin has just appeared. ride: how far
     *  the pusher it rides moved in z this step, so its rest point moves with
     *  it and a coin carried by a pusher never trails it. */
    apply(s, xf, i, out, o, fresh, ride = 0) {
      const a3 = s * 3, a4 = s * 4;
      const x = xf[i], y = xf[i + 1], z = xf[i + 2];
      let qx = xf[i + 3], qy = xf[i + 4], qz = xf[i + 5], qw = xf[i + 6];
      // where it rests: follows the coin slowly, and jumps with it when the
      // coin is put somewhere new (dropped in, lifted out of a floor)
      ax[a3 + 2] += ride;
      let dx = x - ax[a3], dy = y - ax[a3 + 1], dz = z - ax[a3 + 2];
      if (fresh || dx * dx + dy * dy + dz * dz > jump * jump) {
        ax[a3] = x; ax[a3 + 1] = y; ax[a3 + 2] = z;
        aq[a4] = qx; aq[a4 + 1] = qy; aq[a4 + 2] = qz; aq[a4 + 3] = qw;
        out.set(xf.subarray ? xf.subarray(i, i + 7) : xf.slice(i, i + 7), o);
        return;
      }
      ax[a3] += dx * follow; ax[a3 + 1] += dy * follow; ax[a3 + 2] += dz * follow;
      dx = x - ax[a3]; dy = y - ax[a3 + 1]; dz = z - ax[a3 + 2];
      // drawn up to HOLD nearer its rest point than it is
      const d = Math.hypot(dx, dy, dz), keep = d > hold ? (d - hold) / d : 0;
      out[o] = ax[a3] + dx * keep; out[o + 1] = ax[a3 + 1] + dy * keep; out[o + 2] = ax[a3 + 2] + dz * keep;
      // the same for which way it faces
      let rx = aq[a4], ry = aq[a4 + 1], rz = aq[a4 + 2], rw = aq[a4 + 3];
      if (rx * qx + ry * qy + rz * qz + rw * qw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw; }
      rx += (qx - rx) * follow; ry += (qy - ry) * follow; rz += (qz - rz) * follow; rw += (qw - rw) * follow;
      let inv = 1 / (Math.hypot(rx, ry, rz, rw) || 1);
      rx *= inv; ry *= inv; rz *= inv; rw *= inv;
      aq[a4] = rx; aq[a4 + 1] = ry; aq[a4 + 2] = rz; aq[a4 + 3] = rw;
      const dot = Math.min(1, Math.abs(rx * qx + ry * qy + rz * qz + rw * qw)), ang = 2 * Math.acos(dot);
      const turn = ang > holdRad ? (ang - holdRad) / ang : 0;
      let ox = rx + (qx - rx) * turn, oy = ry + (qy - ry) * turn, oz = rz + (qz - rz) * turn, ow = rw + (qw - rw) * turn;
      inv = 1 / (Math.hypot(ox, oy, oz, ow) || 1);
      out[o + 3] = ox * inv; out[o + 4] = oy * inv; out[o + 5] = oz * inv; out[o + 6] = ow * inv;
    },
  };
}
