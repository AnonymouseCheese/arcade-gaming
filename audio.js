/* ------------------------------------------------------------------ *
 *  Sound, synthesised. No audio files, nothing to load.
 *
 *  A coin pusher is half sound: the motor grinding away, the endless
 *  shuffle of the pile, and the clatter when a payout finally comes.
 *  All of it is made here out of oscillators and filtered noise.
 *
 *  Everything is wrapped defensively - if Web Audio misbehaves on some
 *  browser, the game must carry on silently rather than die.
 * ------------------------------------------------------------------ */

export function createAudio() {
  let ctx = null, master = null, comp = null, noise = null;
  let motorGain = null, rustleGain = null;
  let voices = 0;
  let enabled = true;
  let motionTarget = 0;

  const safe = fn => { try { return fn(); } catch { return undefined; } };

  /** Built on the first touch - iOS will not allow audio before that. */
  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') safe(() => ctx.resume()); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    safe(() => {
      ctx = new AC();

      comp = ctx.createDynamicsCompressor();       // a cascade can stack up a
      comp.threshold.value = -18;                  // lot of voices at once
      comp.ratio.value = 12;
      comp.attack.value = 0.003;
      comp.release.value = 0.18;

      master = ctx.createGain();
      master.gain.value = enabled ? 0.9 : 0;
      comp.connect(master).connect(ctx.destination);

      // two seconds of white noise, reused for every strike and the rustle
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

      buildMotor();
      buildRustle();
    });
  }

  /** The drive motor: a low buzz that never stops while the machine runs. */
  function buildMotor() {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 47;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 190;
    lp.Q.value = 3;

    motorGain = ctx.createGain();
    motorGain.gain.value = 0.05;

    osc.connect(lp).connect(motorGain).connect(comp);
    osc.start();
  }

  /** The pile shuffling. Its level follows how much the coins are moving. */
  function buildRustle() {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.7;

    rustleGain = ctx.createGain();
    rustleGain.gain.value = 0;

    src.connect(bp).connect(rustleGain).connect(comp);
    src.start();
  }

  /**
   * One metallic strike. Coins ring on inharmonic partials rather than a
   * musical series, which is what stops this sounding like a xylophone.
   */
  function strike({ f = 2400, gain = 0.5, dur = 0.16, noiseGain = 0.8 }) {
    if (!ctx || voices > 14) return;
    voices++;
    safe(() => {
      const t = ctx.currentTime;
      const out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(gain, t + 0.003);
      out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      out.connect(comp);

      [1, 2.76, 5.40].forEach((r, i) => {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'triangle' : 'sine';
        o.frequency.value = f * r * (0.97 + Math.random() * 0.06);
        const g = ctx.createGain();
        g.gain.value = 0.75 / (i * 1.7 + 1);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + dur);
      });

      // the transient - the actual click of metal meeting metal
      const n = ctx.createBufferSource();
      n.buffer = noise;
      n.playbackRate.value = 0.8 + Math.random() * 0.5;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * 1.5;
      bp.Q.value = 1.1;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(gain * noiseGain, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      n.connect(bp).connect(ng).connect(out);
      n.start(t);
      n.stop(t + 0.06);
    });
    setTimeout(() => { voices--; }, dur * 1000 + 40);
  }

  /** Something heavy and dull - a coin gone down the gutter, or the pusher. */
  function thud({ f = 150, gain = 0.5, dur = 0.14 }) {
    if (!ctx || voices > 14) return;
    voices++;
    safe(() => {
      const t = ctx.currentTime;
      const n = ctx.createBufferSource();
      n.buffer = noise;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(f * 4, t);
      lp.frequency.exponentialRampToValueAtTime(f, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(lp).connect(g).connect(comp);
      n.start(t);
      n.stop(t + dur + 0.02);
    });
    setTimeout(() => { voices--; }, dur * 1000 + 40);
  }

  /** An electronic beep - the wheel spin's screen. */
  function beep(f, dur = 0.06, gain = 0.18, type = 'square', at = 0) {
    if (!ctx || voices > 14) return;
    voices++;
    safe(() => {
      const t = ctx.currentTime + at;
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(comp);
      o.start(t);
      o.stop(t + dur + 0.02);
    });
    setTimeout(() => { voices--; }, (at + dur) * 1000 + 40);
  }

  return {
    unlock,

    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = on;
      if (master) safe(() => {
        master.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.02);
      });
    },

    /** 0 = the pile is still, 1 = the whole field is shifting. */
    setMotion(v) { motionTarget = Math.max(0, Math.min(1, v)); },

    /** Call once a frame. Eases the continuous layers toward their targets. */
    tick() {
      if (!ctx || !rustleGain) return;
      safe(() => {
        const t = ctx.currentTime;
        rustleGain.gain.setTargetAtTime(motionTarget * 0.085, t, 0.09);
        motorGain.gain.setTargetAtTime(0.04 + motionTarget * 0.02, t, 0.15);
      });
    },

    /** The pusher reaching the end of its travel. */
    clunk() { thud({ f: 110, gain: 0.35, dur: 0.17 }); },

    /** A coin released down the chute. */
    drop() { strike({ f: 3100, gain: 0.30, dur: 0.10, noiseGain: 0.5 }); },

    /**
     * Coins over the front lip. A cascade is many of these at once, so they
     * are spread over a few milliseconds and detuned - that spread is what
     * makes a payout sound like a payout rather than one loud click.
     */
    payout(n = 1) {
      const many = Math.min(n, 6);
      for (let i = 0; i < many; i++) {
        setTimeout(() => strike({
          f: 1900 + Math.random() * 1300,
          gain: 0.5,
          dur: 0.18 + Math.random() * 0.12,
        }), i * (18 + Math.random() * 26));
      }
    },

    /** A coin gone down the side. Duller, and it should feel like a loss. */
    loss() { thud({ f: 190, gain: 0.22, dur: 0.11 }); },

    /** The wheel spin: a step of the light round the ring. */
    spinTick() { beep(1320, 0.035, 0.10); },
    /** It stops on a prize. */
    spinLand() { beep(880, 0.12, 0.16, 'triangle'); beep(1320, 0.18, 0.16, 'triangle', 0.09); },
    /** The black hole opening: a long falling roar. */
    whoosh(dur = 2.2) {
      if (!ctx) return;
      safe(() => {
        const t = ctx.currentTime;
        const n = ctx.createBufferSource();
        n.buffer = noise; n.loop = true;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.Q.value = 6;
        lp.frequency.setValueAtTime(2400, t);
        lp.frequency.exponentialRampToValueAtTime(120, t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.35, t + 0.3);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        n.connect(lp).connect(g).connect(comp);
        n.start(t); n.stop(t + dur + 0.05);
      });
    },
    /** A prize won: a quick rising arpeggio. */
    fanfare() { [523, 659, 784, 1047, 1319].forEach((f, i) => beep(f, 0.16, 0.14, 'triangle', i * 0.08)); },
  };
}
