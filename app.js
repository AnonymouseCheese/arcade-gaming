import * as THREE from './vendor/three.module.js';
import * as RAPIER from './vendor/rapier.es.js';
import { CFG, COLOUR } from './config.js';
import { cabinetBoxes, pusherSlabs, createMachine } from './physics.js';

/* ------------------------------------------------------------------ *
 *  Coin pusher - v1
 *
 *  The machine itself lives in physics.js. This file is the renderer,
 *  the input handling and the benchmark panel.
 * ------------------------------------------------------------------ */

let renderer, scene, camera, machine;
let coinMesh, chuteMesh, pusherGroup;

let prevX, prevQ, curX, curQ;   // interpolation buffers, indexed by pool slot

let bank = 200;
let physHz = 30;
let aiming = false, chuteX = 0;

const ui = {};
const dummy = new THREE.Object3D();

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
                    'sShape','rFps','rStep','rAwake','rCalls','bench','btnBench','benchClose',
                    'btnReseed','hint']) {
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
  renderer.setClearColor(0x0a0d16);
}

function buildScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0d16, 95, 200);

  camera = new THREE.PerspectiveCamera(50, 1, 1, 400);

  scene.add(new THREE.HemisphereLight(0xaecbff, 0x1a1f33, 0.85));

  const key = new THREE.DirectionalLight(0xfff2d6, 1.15);
  key.position.set(14, 40, 26);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x6fa8ff, 0.5);
  rim.position.set(-20, 16, -26);
  scene.add(rim);
}

function box(b, colour, shine) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(b.h[0] * 2, b.h[1] * 2, b.h[2] * 2),
    new THREE.MeshPhongMaterial({ color: colour, shininess: shine }));
  mesh.position.set(b.c[0], b.c[1], b.c[2]);
  return mesh;
}

/** The same boxes physics.js turned into colliders, now as things to look at. */
function buildCabinetMeshes() {
  for (const b of cabinetBoxes()) {
    scene.add(box(b, COLOUR[b.kind] ?? COLOUR.wall, 22));
  }

  pusherGroup = new THREE.Group();
  for (const s of pusherSlabs()) pusherGroup.add(box(s, COLOUR.pusher, 40));
  scene.add(pusherGroup);

  chuteMesh = new THREE.Mesh(
    new THREE.ConeGeometry(0.9, 2.0, 12),
    new THREE.MeshPhongMaterial({ color: COLOUR.coin, shininess: 60 }));
  chuteMesh.rotation.x = Math.PI;                 // point it downward
  chuteMesh.position.set(0, CFG.dropY + 2.6, CFG.dropZ);
  scene.add(chuteMesh);
}

function onResize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;

  // Pull the camera back far enough that the whole cabinet fits, whichever
  // way the phone is held. Portrait needs a lot more distance than landscape.
  const vFov = camera.fov * Math.PI / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distW = 18.5 / Math.tan(hFov / 2);
  const distV = 17.0 / Math.tan(vFov / 2);
  const dist  = Math.max(distW, distV) * 1.02;

  const tilt = 0.60;                       // rise over run
  const len  = Math.hypot(1, tilt);
  const tx = 0, ty = 3, tz = -4;           // what we look at
  camera.position.set(tx, ty + dist * tilt / len, tz + dist / len);
  camera.lookAt(tx, ty, tz);
  camera.updateProjectionMatrix();
}

/* ------------------------------------------------------------------ *
 *  Coins
 * ------------------------------------------------------------------ */

function buildCoinMesh() {
  const geo = new THREE.CylinderGeometry(CFG.coinR, CFG.coinR, CFG.coinT, 16);
  const mat = new THREE.MeshPhongMaterial({
    color: COLOUR.coin, shininess: 90, specular: 0x8d7a3a,
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
}

function drop() {
  if (bank <= 0) return;
  if (machine.drop(chuteX, stamp)) {
    bank--;
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
const onCollected = (coin, paid) => { if (paid) bank++; };

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

  if (now - lastReport > 250) { report(); lastReport = now; }
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
