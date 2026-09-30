import * as THREE from './vendor/three.module.js';
import * as RAPIER from './vendor/rapier.es.js';
import { CFG, COLOUR } from './config.js?v=2';
import { cabinetBoxes, pusherSlabs, createMachine } from './physics.js?v=2';
import { createAudio } from './audio.js?v=2';

/* ------------------------------------------------------------------ *
 *  Coin pusher - v1
 *
 *  The machine itself lives in physics.js. This file is the renderer,
 *  the input handling, the sound cues and the benchmark panel.
 * ------------------------------------------------------------------ */

let renderer, scene, camera, machine;
let coinMesh, chuteMesh, pusherGroup;

let prevX, prevQ, curX, curQ;   // interpolation buffers, indexed by pool slot

let bank = 200;
let physHz = 30;
let aiming = false, chuteX = 0;

let motionSum = 0, motionN = 0;         // how much the pile is shifting
let payQueue = 0, lossQueue = 0;        // sound cues, batched per frame
let lastPhase = 0;

const ui = {};
const dummy = new THREE.Object3D();
const audio = createAudio();

/* ------------------------------------------------------------------ *
 *  Boot
 * ------------------------------------------------------------------ */

init().catch(err => {
  document.getElementById('boot').innerHTML =
    '<p style="color:#ef6b6b;padding:0 24px;text-align:center">' + err.message + '</p>';
  console.error(err);
});

async function init() {
  await RAPIER.init();

  cacheUi();
  buildRenderer();
  buildScene();
  buildEnvironment();
  buildCabinetMeshes();
  buildCoinMesh();

  rebuildMachine();

  bindInput();
  addEventListener('resize', onResize);
  onResize();

  requestAnimationFrame(frame);
  setTimeout(() => document.getElementById('boot').classList.add('gone'), 220);
}

function cacheUi() {
  for (const id of ['vBank','vWon','vLost','vFps','vCoins','sCoins','sHz','sIter',
                    'sShape','rFps','rStep','rAwake','rCalls','bench','btnBench',
                    'benchClose','btnReseed','btnMute','hint']) {
    ui[id] = document.getElementById(id);
  }
}

/* ------------------------------------------------------------------ *
 *  Renderer and scene
 * ------------------------------------------------------------------ */

function buildRenderer() {
  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('scene'),
    antialias: false,
    powerPreference: 'high-performance',
  });
  // iPhones report a device pixel ratio of 3. Rendering at 3x costs a lot of
  // fill rate for very little visible gain on a screen this small.
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setClearColor(0x070a12);
}

function buildScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x070a12, 110, 230);

  camera = new THREE.PerspectiveCamera(50, 1, 1, 400);

  scene.add(new THREE.HemisphereLight(0xaecbff, 0x10141f, 0.55));

  const key = new THREE.DirectionalLight(0xfff2d6, 1.0);
  key.position.set(14, 46, 26);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x6fa8ff, 0.45);
  rim.position.set(-22, 18, -28);
  scene.add(rim);

  // a warm glow spilling out of the marquee onto the playfield
  const marqueeLight = new THREE.PointLight(0xffc978, 0.9, 90, 2);
  marqueeLight.position.set(0, 20, -18);
  scene.add(marqueeLight);
}

/**
 * Metal is nearly all reflection, so without something to reflect the coins
 * read as flat mustard paint. This renders a tiny box room with a few bright
 * panels into an environment map - the cheapest way to get gold that looks
 * like gold, with no image files to download.
 */
function buildEnvironment() {
  const env = new THREE.Scene();

  const lit = (colour, x, y, z, w, h, d) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ color: colour }));
    m.position.set(x, y, z);
    env.add(m);
    return m;
  };

  const room = new THREE.Mesh(
    new THREE.BoxGeometry(120, 90, 120),
    new THREE.MeshBasicMaterial({ color: 0x161d2e, side: THREE.BackSide }));
  env.add(room);

  lit(0xfff0d2, 0,  40,  -8, 60, 2, 44);   // warm ceiling strip
  lit(0x9ec4ff, 0,   6,  54, 70, 40, 2);   // cool fill from the front
  lit(0xffffff, -48, 16, -6, 2, 26, 30);   // left highlight
  lit(0xffd9a0, 48, 12,  -6, 2, 20, 30);   // right highlight, warmer

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(env, 0.05).texture;
  pmrem.dispose();
  env.traverse(o => { if (o.geometry) o.geometry.dispose(); });
}

const MATS = {};
function material(kind) {
  if (MATS[kind]) return MATS[kind];
  const spec = {
    deck:   { color: COLOUR.deck,   metalness: 0.35, roughness: 0.62 },
    wall:   { color: COLOUR.wall,   metalness: 0.25, roughness: 0.75 },
    trim:   { color: COLOUR.trim,   metalness: 0.30, roughness: 0.70 },
    tray:   { color: COLOUR.tray,   metalness: 0.55, roughness: 0.45 },
    pusher: { color: COLOUR.pusher, metalness: 0.70, roughness: 0.34 },
  }[kind] ?? { color: COLOUR.wall, metalness: 0.2, roughness: 0.8 };
  MATS[kind] = new THREE.MeshStandardMaterial(spec);
  return MATS[kind];
}

function box(b, kind) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(b.h[0] * 2, b.h[1] * 2, b.h[2] * 2), material(kind));
  mesh.position.set(b.c[0], b.c[1], b.c[2]);
  return mesh;
}

/** The same boxes physics.js turned into colliders, now as things to look at. */
function buildCabinetMeshes() {
  for (const b of cabinetBoxes()) scene.add(box(b, b.kind));

  pusherGroup = new THREE.Group();
  for (const s of pusherSlabs()) pusherGroup.add(box(s, 'pusher'));
  scene.add(pusherGroup);

  buildCabinetShell();

  chuteMesh = new THREE.Mesh(
    new THREE.ConeGeometry(0.9, 2.0, 12),
    new THREE.MeshStandardMaterial({
      color: COLOUR.coin, metalness: 0.9, roughness: 0.25,
      emissive: 0x6a4d10, emissiveIntensity: 0.6,
    }));
  chuteMesh.rotation.x = Math.PI;                 // point it downward
  chuteMesh.position.set(0, CFG.dropY + 2.6, CFG.dropZ);
  scene.add(chuteMesh);
}

/** The furniture around the playfield: pillars, marquee, floor. */
function buildCabinetShell() {
  const C = CFG;
  const body = new THREE.MeshStandardMaterial({
    color: 0x10151f, metalness: 0.4, roughness: 0.55 });

  for (const s of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(3, 34, 58), body);
    pillar.position.set(s * (C.wallHalfW + 2.5), 1, -2);
    scene.add(pillar);
  }

  const hood = new THREE.Mesh(new THREE.BoxGeometry(40, 3, 26), body);
  hood.position.set(0, 17.5, -14);
  scene.add(hood);

  const marquee = new THREE.Mesh(
    new THREE.BoxGeometry(36, 7, 1.4),
    new THREE.MeshStandardMaterial({
      color: 0x241634, metalness: 0.2, roughness: 0.5,
      emissive: 0xff9c3c, emissiveIntensity: 0.85,
    }));
  marquee.position.set(0, 14.5, -25.4);
  scene.add(marquee);

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(200, 2, 200),
    new THREE.MeshStandardMaterial({ color: 0x080b12, metalness: 0.1, roughness: 0.9 }));
  floor.position.set(0, -17, 0);
  scene.add(floor);
}

function onResize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;

  // Pull the camera back far enough that the whole cabinet fits, whichever
  // way the phone is held. Portrait is bound by the width, landscape by the
  // depth, so take whichever needs more room.
  const vFov = camera.fov * Math.PI / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const dist = Math.max(20 / Math.tan(hFov / 2), 23 / Math.tan(vFov / 2)) * 1.02;

  const tilt = 0.62;                       // rise over run
  const len  = Math.hypot(1, tilt);
  const tx = 0, ty = 2, tz = 0;            // what we look at
  camera.position.set(tx, ty + dist * tilt / len, tz + dist / len);
  camera.lookAt(tx, ty, tz);
  camera.updateProjectionMatrix();
}

/* ------------------------------------------------------------------ *
 *  Coins
 * ------------------------------------------------------------------ */

function buildCoinMesh() {
  const geo = new THREE.CylinderGeometry(CFG.coinR, CFG.coinR, CFG.coinT, 16);
  const mat = new THREE.MeshStandardMaterial({
    color: COLOUR.coin, metalness: 1.0, roughness: 0.28, envMapIntensity: 1.15,
  });
  coinMesh = new THREE.InstancedMesh(geo, mat, CFG.maxCoins);
  coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  coinMesh.frustumCulled = false;
  coinMesh.count = 0;
  scene.add(coinMesh);

  prevX = new Float32Array(CFG.maxCoins * 3);
  curX  = new Float32Array(CFG.maxCoins * 3);
  prevQ = new Float32Array(CFG.maxCoins * 4);
  curQ  = new Float32Array(CFG.maxCoins * 4);
}

/** Copy one coin's transform into the interpolation buffers. */
function write(coin, p, q, alsoPrev) {
  const i3 = coin.slot * 3, i4 = coin.slot * 4;

  if (!alsoPrev) {
    // curX still holds last step's position, so this is free movement data -
    // it drives how loud the pile rustles.
    motionSum += Math.abs(p.x - curX[i3]) +
                 Math.abs(p.y - curX[i3 + 1]) +
                 Math.abs(p.z - curX[i3 + 2]);
    motionN++;
  }

  curX[i3] = p.x; curX[i3 + 1] = p.y; curX[i3 + 2] = p.z;
  curQ[i4] = q.x; curQ[i4 + 1] = q.y; curQ[i4 + 2] = q.z; curQ[i4 + 3] = q.w;
  if (alsoPrev) {
    prevX[i3] = p.x; prevX[i3 + 1] = p.y; prevX[i3 + 2] = p.z;
    prevQ[i4] = q.x; prevQ[i4 + 1] = q.y; prevQ[i4 + 2] = q.z; prevQ[i4 + 3] = q.w;
  }
}

/** A coin that has just appeared: seed both buffers so it does not streak. */
function stamp(coin) {
  write(coin, coin.body.translation(), coin.body.rotation(), true);
}

/* ------------------------------------------------------------------ *
 *  Input - press to aim, slide to move, lift to drop
 * ------------------------------------------------------------------ */

function bindInput() {
  const canvas = renderer.domElement;

  const aimTo = e => {
    const frac = (e.clientX / innerWidth) * 2 - 1;      // -1 .. 1
    chuteX = Math.max(-CFG.aimLimit, Math.min(CFG.aimLimit, frac * CFG.aimLimit * 1.25));
    chuteMesh.position.x = chuteX;
  };

  canvas.addEventListener('pointerdown', e => {
    audio.unlock();                   // iOS gives us audio only from a gesture
    aiming = true; aimTo(e); canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => { if (aiming) aimTo(e); });
  canvas.addEventListener('pointerup', e => {
    if (aiming) { aimTo(e); drop(); }
    aiming = false;
  });
  canvas.addEventListener('pointercancel', () => { aiming = false; });

  ui.btnBench.addEventListener('click', () => { ui.bench.hidden = !ui.bench.hidden; });
  ui.benchClose.addEventListener('click', () => { ui.bench.hidden = true; });

  ui.btnMute.addEventListener('click', () => {
    audio.unlock();
    audio.setEnabled(!audio.enabled);
    ui.btnMute.textContent = audio.enabled ? 'Sound' : 'Muted';
    ui.btnMute.classList.toggle('off', !audio.enabled);
  });

  ui.sCoins.addEventListener('input', () => { ui.vCoins.textContent = ui.sCoins.value; });
  ui.sCoins.addEventListener('change', () => machine.seed(+ui.sCoins.value, stamp));
  ui.btnReseed.addEventListener('click', () => machine.seed(+ui.sCoins.value, stamp));

  ui.sHz.addEventListener('change', () => {
    physHz = +ui.sHz.value;
    machine.setRate(physHz);
  });
  ui.sIter.addEventListener('change', () => machine.setSolver(+ui.sIter.value));

  // A collider shape is fixed when the collider is made, so switching it
  // means building the machine again from scratch.
  ui.sShape.addEventListener('change', rebuildMachine);
}

function rebuildMachine() {
  if (machine) machine.world.free();
  machine = createMachine(RAPIER, {
    hz: physHz,
    iterations: +ui.sIter.value,
    shape: ui.sShape.value,
  });
  machine.seed(+ui.sCoins.value, stamp);
  lastPhase = 0;
}

function drop() {
  if (bank <= 0) return;
  if (machine.drop(chuteX, stamp)) {
    bank--;
    audio.drop();
    ui.hint.classList.add('gone');
  }
}

/* ------------------------------------------------------------------ *
 *  The loop
 *
 *  Physics runs on a fixed step. Rendering runs as fast as the screen
 *  allows and interpolates between the last two physics states, so a
 *  30 Hz simulation still draws smoothly at 60 fps.
 * ------------------------------------------------------------------ */

let lastT = 0, acc = 0, stepMs = 0;
let fpsAcc = 0, fpsN = 0, fps = 0, lastReport = 0;

const onMoved     = (coin, p, q) => write(coin, p, q, false);
const onCollected = (coin, paid) => { if (paid) { bank++; payQueue++; } else lossQueue++; };

function frame(now) {
  requestAnimationFrame(frame);

  const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0;
  lastT = now;
  if (dt > 0) { fpsAcc += 1 / dt; fpsN++; }

  acc += dt;
  let steps = 0;
  const t0 = performance.now();
  while (acc >= machine.world.timestep && steps < 4) {
    // Carry the current state back before advancing, so the renderer always
    // has two states to interpolate between.
    prevX.set(curX);
    prevQ.set(curQ);
    machine.step(onMoved, onCollected);
    acc -= machine.world.timestep;
    steps++;
  }
  if (steps) stepMs = stepMs * 0.85 + ((performance.now() - t0) / steps) * 0.15;

  syncInstances(acc / machine.world.timestep);
  pusherGroup.position.z = machine.pusher.translation().z;
  renderer.render(scene, camera);

  cueSound();
  if (now - lastReport > 250) { report(); lastReport = now; }
}

/** Turn this frame's events into sound. */
function cueSound() {
  if (payQueue)  { audio.payout(payQueue); payQueue = 0; }
  if (lossQueue) { audio.loss(); lossQueue = 0; }

  // The pusher thumps at each end of its travel.
  const phase = (machine.elapsed / CFG.period) % 1;
  if (phase < lastPhase || (lastPhase < 0.5 && phase >= 0.5)) audio.clunk();
  lastPhase = phase;

  audio.setMotion(motionN ? Math.min(1, (motionSum / motionN) / 0.10) : 0);
  motionSum = 0; motionN = 0;
  audio.tick();
}

function syncInstances(alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  const active = machine.active;
  for (let i = 0; i < active.length; i++) {
    const s = active[i].slot, i3 = s * 3, i4 = s * 4;

    dummy.position.set(
      prevX[i3]     + (curX[i3]     - prevX[i3])     * a,
      prevX[i3 + 1] + (curX[i3 + 1] - prevX[i3 + 1]) * a,
      prevX[i3 + 2] + (curX[i3 + 2] - prevX[i3 + 2]) * a);

    // Normalised lerp rather than a true slerp. Between two consecutive
    // physics steps the rotations are close enough that nobody can tell,
    // and it is a great deal cheaper across hundreds of coins.
    let qx = prevQ[i4],     qy = prevQ[i4 + 1],
        qz = prevQ[i4 + 2], qw = prevQ[i4 + 3];
    const cx = curQ[i4], cy = curQ[i4 + 1], cz = curQ[i4 + 2], cw = curQ[i4 + 3];
    if (qx * cx + qy * cy + qz * cz + qw * cw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw; }
    qx += (cx - qx) * a; qy += (cy - qy) * a; qz += (cz - qz) * a; qw += (cw - qw) * a;
    const inv = 1 / (Math.hypot(qx, qy, qz, qw) || 1);
    dummy.quaternion.set(qx * inv, qy * inv, qz * inv, qw * inv);

    dummy.updateMatrix();
    coinMesh.setMatrixAt(i, dummy.matrix);
  }
  coinMesh.count = active.length;
  coinMesh.instanceMatrix.needsUpdate = true;
}

function report() {
  fps = fpsN ? fpsAcc / fpsN : 0;
  fpsAcc = 0; fpsN = 0;

  ui.vBank.textContent = bank;
  ui.vWon.textContent  = machine.won;
  ui.vLost.textContent = machine.lost;
  ui.vFps.textContent  = fps.toFixed(0);

  if (!ui.bench.hidden) {
    ui.rFps.textContent   = fps.toFixed(0) + ' fps';
    ui.rStep.textContent  = stepMs.toFixed(1) + ' ms';
    ui.rAwake.textContent = machine.awake + ' / ' + machine.active.length;
    ui.rCalls.textContent = renderer.info.render.calls;
  }
}
