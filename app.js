import * as THREE from './vendor/three.module.js';
import * as RAPIER from './vendor/rapier.es.js';
import { CFG, COLOUR } from './config.js?v=6';
import {
  cabinetBoxes, pusherSlabs, dropperBoxes, dropperPegs, createMachine,
} from './physics.js?v=6';
import { createAudio } from './audio.js?v=6';

/* ------------------------------------------------------------------ *
 *  Coin pusher
 *
 *  The machine itself lives in physics.js. This file is the renderer,
 *  the input handling, the sound cues and the performance panel.
 * ------------------------------------------------------------------ */

let renderer, scene, camera, machine, pile = null;
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

  // A pile that was settled offline. Without it the machine has to collapse
  // into shape on the player's time, shedding coins for two minutes while it
  // does - which reads as the machine leaking for no reason.
  try {
    const res = await fetch('pile.json?v=6');
    if (res.ok) pile = await res.json();
  } catch { /* fall back to the grid seed below */ }

  cacheUi();
  buildRenderer();
  buildScene();
  buildEnvironment();
  buildCabinetMeshes();
  buildCoinMesh();

  if (pile) {
    ui.sCoins.max = pile.count;
    ui.sCoins.value = pile.count;
    ui.vCoins.textContent = pile.count;
  }

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
  renderer.setClearColor(0x0a1a24);
  // Everything below is pushed hard enough to clip without this; ACES rolls
  // the highlights off instead of blowing the coins out to white.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
}

/** A soft vertical wash behind the cabinet, so it does not float in a void. */
function backdrop() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d').createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0,    '#1d4f66');     // an arcade has other machines glowing
  g.addColorStop(0.5,  '#102f41');     // around it, not a black void
  g.addColorStop(1,    '#071820');
  const ctx = c.getContext('2d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildScene() {
  scene = new THREE.Scene();
  scene.background = backdrop();
  scene.fog = new THREE.Fog(0x071118, 150, 300);

  camera = new THREE.PerspectiveCamera(50, 1, 1, 500);

  // The first version lit this like a cave and everything came out brown.
  // An arcade is a bright room full of coloured light sources, and the coins
  // have to be the brightest thing on screen.
  scene.add(new THREE.HemisphereLight(0xcdefff, 0x2a5d70, 1.9));

  const key = new THREE.DirectionalLight(0xfffaf0, 2.1);
  key.position.set(18, 54, 34);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xd9f2ff, 0.9);
  fill.position.set(-20, 30, 40);
  scene.add(fill);

  const magenta = new THREE.DirectionalLight(COLOUR.neon, 1.0);
  magenta.position.set(-36, 18, -8);
  scene.add(magenta);

  const cyan = new THREE.DirectionalLight(COLOUR.neon2, 0.8);
  cyan.position.set(36, 15, 8);
  scene.add(cyan);

  // The tube under the hood that every real pusher has, pointed at the field.
  const tube = new THREE.PointLight(0xfff4db, 4.2, 110, 2);
  tube.position.set(0, CFG.chuteTopY - 2, 4);
  scene.add(tube);

  // and a second one low at the front, so the near edge is not in shadow
  const front = new THREE.PointLight(0xffe9c0, 2.4, 70, 2);
  front.position.set(0, 10, CFG.lipZ + 6);
  scene.add(front);

  const board = new THREE.PointLight(COLOUR.neon2, 1.6, 60, 2);
  board.position.set(0, CFG.antlerY, CFG.chuteZ + 8);
  scene.add(board);
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
  };

  env.add(new THREE.Mesh(
    new THREE.BoxGeometry(140, 110, 140),
    new THREE.MeshBasicMaterial({ color: 0x2b3b50, side: THREE.BackSide })));

  lit(0xffffff, 0,  50,  -8, 76, 5, 54);    // broad bright ceiling
  lit(0xcfe6ff, 0,   8,  62, 86, 50, 2);    // cool fill from the front
  lit(0xffffff, -56, 20, -6, 2, 36, 40);    // hard left highlight
  lit(0xffdca8, 56, 14,  -6, 2, 30, 40);    // warm right highlight
  lit(0xff6fae, -30, -6, -34, 26, 10, 2);   // magenta bounce off the cabinet
  lit(0x5ff0f4,  30, -6, -34, 26, 10, 2);   // cyan bounce

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(env, 0.05).texture;
  pmrem.dispose();
  env.traverse(o => { if (o.geometry) o.geometry.dispose(); });
}

const MATS = {};
function material(kind) {
  if (MATS[kind]) return MATS[kind];
  const spec = {
    // Stainless, but not mirror-finish. A near-mirror is lit almost entirely
    // by what it reflects, and the environment here is a small synthetic room,
    // so metalness at 0.92 rendered the whole cabinet black.
    deck:   { color: COLOUR.deck,   metalness: 0.55, roughness: 0.28, envMapIntensity: 1.6 },
    wall:   { color: COLOUR.wall,   metalness: 0.45, roughness: 0.35, envMapIntensity: 1.5 },
    trim:   { color: COLOUR.trim,   metalness: 0.35, roughness: 0.5 },
    tray:   { color: COLOUR.tray,   metalness: 0.4,  roughness: 0.45 },
    pusher: { color: COLOUR.pusher, metalness: 0.7,  roughness: 0.2,  envMapIntensity: 1.7 },
    chute:  { color: COLOUR.chute,  metalness: 0.45, roughness: 0.55 },
    antler: { color: COLOUR.antler, metalness: 0.65, roughness: 0.28,
              emissive: COLOUR.antler, emissiveIntensity: 0.35 },
    peg:    { color: COLOUR.peg,    metalness: 0.90, roughness: 0.18 },
  }[kind];

  if (kind === 'glass') {
    MATS[kind] = new THREE.MeshStandardMaterial({
      color: 0xbcd6ff, metalness: 0, roughness: 0.06,
      transparent: true, opacity: 0.13, depthWrite: false,
    });
  } else {
    MATS[kind] = new THREE.MeshStandardMaterial(
      spec ?? { color: COLOUR.wall, metalness: 0.2, roughness: 0.8 });
  }
  return MATS[kind];
}

function box(b, kind) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(b.h[0] * 2, b.h[1] * 2, b.h[2] * 2), material(kind));
  mesh.position.set(b.c[0], b.c[1], b.c[2]);
  if (b.rz) mesh.rotation.z = b.rz;
  return mesh;
}

/** The same boxes physics.js turned into colliders, now as things to look at. */
function buildCabinetMeshes() {
  for (const b of cabinetBoxes()) scene.add(box(b, b.kind));

  for (const b of dropperBoxes()) {
    const m = box(b, b.kind);
    if (b.kind === 'glass') m.renderOrder = 2;      // draw after the coins
    scene.add(m);
  }

  // The pins. One instanced mesh, laid along z so they stick out of the board.
  const pegs = dropperPegs();
  const pegGeo = new THREE.CylinderGeometry(CFG.pegR, CFG.pegR, CFG.chuteGap * 1.5, 10);
  pegGeo.rotateX(Math.PI / 2);
  const pegMesh = new THREE.InstancedMesh(pegGeo, material('peg'), pegs.length);
  pegs.forEach((g, i) => {
    dummy.position.set(g.c[0], g.c[1], g.c[2]);
    dummy.quaternion.set(0, 0, 0, 1);
    dummy.updateMatrix();
    pegMesh.setMatrixAt(i, dummy.matrix);
  });
  pegMesh.instanceMatrix.needsUpdate = true;
  scene.add(pegMesh);

  pusherGroup = new THREE.Group();
  for (const s of pusherSlabs()) pusherGroup.add(box(s, 'pusher'));
  scene.add(pusherGroup);

  buildCabinetShell();
  buildFeatureBoard();

  chuteMesh = new THREE.Mesh(
    new THREE.ConeGeometry(0.9, 2.0, 12),
    new THREE.MeshStandardMaterial({
      color: COLOUR.coin, metalness: 0.9, roughness: 0.25,
      emissive: 0x6a4d10, emissiveIntensity: 0.7,
    }));
  chuteMesh.rotation.x = Math.PI;                 // point it downward
  chuteMesh.position.set(0, CFG.chuteTopY - 0.6, CFG.chuteZ + 1.6);
  scene.add(chuteMesh);
}

/**
 * The furniture around the playfield. Kept deliberately slim: the first
 * version had pillars and a hood so big they took more of the frame than the
 * machine did. Everything here is recorded in SHELL so the camera fit knows
 * about it - the old pillars ran past the fitted box and got sliced off.
 */
const SHELL = [];

function shellBox(c, h, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(h[0] * 2, h[1] * 2, h[2] * 2), mat);
  m.position.set(c[0], c[1], c[2]);
  scene.add(m);
  SHELL.push({ c, h });
  return m;
}

/**
 * The marquee. Chrome lettering on a dark plate. The name is a placeholder.
 */
const GAME_NAME = 'VORTEX';

function signTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 160;
  const x = c.getContext('2d');

  x.fillStyle = '#0b1430';
  x.fillRect(0, 0, 1024, 160);

  const edge = x.createLinearGradient(0, 0, 0, 160);
  edge.addColorStop(0, '#2ad4ff');
  edge.addColorStop(1, '#7b3fe4');
  x.strokeStyle = edge;
  x.lineWidth = 6;
  x.strokeRect(3, 3, 1018, 154);

  x.font = '700 92px "Archivo", "Helvetica Neue", Arial, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';

  const chrome = x.createLinearGradient(0, 30, 0, 130);
  chrome.addColorStop(0,    '#ffffff');
  chrome.addColorStop(0.45, '#9fb6d4');
  chrome.addColorStop(0.5,  '#44608a');
  chrome.addColorStop(0.55, '#d7e6f7');
  chrome.addColorStop(1,    '#8fa6c4');

  x.lineWidth = 8;
  x.strokeStyle = '#1ea6d8';
  x.strokeText(GAME_NAME, 512, 84);
  x.fillStyle = chrome;
  x.fillText(GAME_NAME, 512, 82);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function buildCabinetShell() {
  const C = CFG;
  const body = new THREE.MeshStandardMaterial({
    color: COLOUR.body, metalness: 0.4, roughness: 0.45 });

  // Unlit on purpose. A lit material keeps receiving the scene's lights on top
  // of whatever it emits, so against bright key and fill every strip clipped to
  // flat white and lost its colour. MeshBasicMaterial ignores lighting
  // entirely, which is exactly what an LED should do.
  // Dimmer than the light colours they stand for. ACES desaturates bright
  // values toward white, so a near-maximum cyan tone-maps to pale grey; these
  // are pitched low enough to come out of the tone mapper still coloured.
  const glow = colour => new THREE.MeshBasicMaterial({ color: colour });
  const LED  = { magenta: 0xc01f63, cyan: 0x0d8c99, tube: 0xe8cf9a };

  // Backlit side art. Real cabinets glow from the inside; a flat dark panel
  // is what made this look like furniture rather than a machine.
  const panel = new THREE.MeshStandardMaterial({
    color: COLOUR.panel, metalness: 0.0, roughness: 0.5,
    emissive: COLOUR.panel, emissiveIntensity: 1.5 });

  for (const side of [-1, 1]) {
    const x = side * (C.wallHalfW + 2.0);
    shellBox([x, 7, -2], [1.1, 15, 27], body);
    // a light rail along the top edge of each side wall - cabinet trim, and
    // it reads from the player's angle. The earlier strip sat down the side
    // where the panel hid all but a sliver of it.
    shellBox([side * (C.wallHalfW + 1.0), 8.2, -2], [0.45, 0.4, 26],
             glow(side < 0 ? LED.magenta : LED.cyan));
    shellBox([x - side * 0.6, 3.0, -2], [0.3, 8.5, 26.5], panel);
  }

  // base plinth
  shellBox([0, -8.5, -1], [C.wallHalfW + 3.2, 2.2, 28], body);

  // A lit sign, not a coloured slab. Drawn into a canvas so the lettering is
  // part of the texture and the whole thing glows as one piece.
  // Clear of the arch. At the old height the two overlapped and the lettering
  // came out tangled in the arch tube.
  const signY = 33;
  shellBox([0, signY, C.chuteZ - 2.6], [C.wallHalfW + 2.6, 3.0, 0.6], body);

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry((C.wallHalfW + 1.8) * 2, 4.6),
    new THREE.MeshBasicMaterial({ map: signTexture(), transparent: true }));
  sign.position.set(0, signY, C.chuteZ - 1.95);
  scene.add(sign);
  SHELL.push({ c: [0, signY, C.chuteZ - 1.95], h: [C.wallHalfW + 1.8, 2.3, 0.1] });

  // a slim tube under the hood, read as the source of the field light
  shellBox([0, C.chuteTopY - 1.4, 2], [C.wallHalfW - 2, 0.16, 0.5], glow(LED.tube));

  // LED runs along both edges of the playfield
  for (const side of [-1, 1]) {
    shellBox([side * (C.floorHalfW + 0.7), 0.3, (C.lipZ + C.gutterFromZ) / 2],
             [0.17, 0.17, (C.lipZ - C.gutterFromZ) / 2],
             glow(side < 0 ? LED.magenta : LED.cyan));
  }
  // and across the lip, where the coins drop out
  shellBox([0, 0.3, C.lipZ + 0.45], [C.floorHalfW, 0.17, 0.17], glow(LED.cyan));

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(260, 2, 260),
    new THREE.MeshStandardMaterial({ color: 0x0d2733, metalness: 0.2, roughness: 0.8 }));
  floor.position.set(0, -11.6, 0);
  scene.add(floor);
}

/* ------------------------------------------------------------------ *
 *  Framing
 *
 *  The machine is nearly 40 units tall now that the drop board runs up
 *  the back, so a hand-picked camera distance no longer works in both
 *  orientations. Fit the actual corners instead.
 * ------------------------------------------------------------------ */

function contentCorners() {
  let lo = [ 1e9,  1e9,  1e9], hi = [-1e9, -1e9, -1e9];
  const add = (c, h) => {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], c[i] - h[i]);
      hi[i] = Math.max(hi[i], c[i] + h[i]);
    }
  };
  for (const b of cabinetBoxes()) add(b.c, b.h);
  for (const b of dropperBoxes()) add(b.c, b.h);
  for (const g of dropperPegs()) add(g.c, [g.r, g.r, g.r]);
  // Height and depth take the furniture into account; width deliberately does
  // not, so the side panels bleed off the edges instead of shrinking the
  // machine to a model on a table.
  for (const b of SHELL) {
    for (const i of [1, 2]) {
      lo[i] = Math.min(lo[i], b.c[i] - b.h[i]);
      hi[i] = Math.max(hi[i], b.c[i] + b.h[i]);
    }
  }
  lo[0] -= 1; hi[0] += 1;

  const corners = [];
  for (let i = 0; i < 8; i++) {
    corners.push(new THREE.Vector3(
      (i & 1) ? hi[0] : lo[0],
      (i & 2) ? hi[1] : lo[1],
      (i & 4) ? hi[2] : lo[2]));
  }
  return { corners, centre: new THREE.Vector3(
    (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2) };
}

let BOUNDS = null;

/**
 * The feature board: the illuminated arch above the playfield, the jackpot
 * badges around it, and the portal at its centre - most of the cabinet's
 * silhouette, far more of it than the coins.
 */
function boardArt() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const x = c.getContext('2d');

  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0,   '#1b2f8c');
  g.addColorStop(0.5, '#2440a8');
  g.addColorStop(1,   '#4a2497');
  x.fillStyle = g;
  x.fillRect(0, 0, 512, 512);

  // a receding floor grid
  x.strokeStyle = 'rgba(150, 235, 255, 0.75)';
  x.lineWidth = 4;
  for (let i = -8; i <= 8; i++) {
    x.beginPath();
    x.moveTo(256 + i * 16, 512);
    x.lineTo(256 + i * 90, 300);
    x.stroke();
  }
  for (let i = 0; i < 7; i++) {
    const y = 512 - Math.pow(i / 7, 1.8) * 212;
    x.beginPath();
    x.moveTo(0, y); x.lineTo(512, y); x.stroke();
  }

  x.fillStyle = 'rgba(190, 230, 255, 0.16)';
  x.beginPath(); x.arc(256, 250, 175, 0, Math.PI * 2); x.fill();

  // a horizon band, so the board reads as a place rather than a panel
  const h = x.createLinearGradient(0, 270, 0, 330);
  h.addColorStop(0, 'rgba(120,220,255,0)');
  h.addColorStop(0.5, 'rgba(160,240,255,0.55)');
  h.addColorStop(1, 'rgba(120,220,255,0)');
  x.fillStyle = h;
  x.fillRect(0, 270, 512, 60);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildFeatureBoard() {
  const C = CFG;
  const cz = C.chuteZ;
  const archY = 16, archR = 14.2;      // wider than the board, so it frames it

  const lit = (colour, strength) => new THREE.MeshStandardMaterial({
    color: colour, metalness: 0.3, roughness: 0.35,
    emissive: colour, emissiveIntensity: strength });

  // the printed board the pins stand on
  const art = new THREE.Mesh(
    new THREE.PlaneGeometry(C.chuteHalfW * 2 + 2, C.chuteTopY - C.chuteExitY),
    new THREE.MeshStandardMaterial({
      map: boardArt(), metalness: 0.1, roughness: 0.6,
      emissive: 0xffffff, emissiveMap: boardArt(), emissiveIntensity: 0.95 }));
  art.position.set(0, (C.chuteTopY + C.chuteExitY) / 2, cz - 0.5);
  scene.add(art);

  // the arch
  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(archR, 0.85, 8, 60, Math.PI),
    lit(COLOUR.violet, 0.85));
  arch.position.set(0, archY, cz - 0.55);
  scene.add(arch);
  SHELL.push({ c: [0, archY + archR / 2, cz - 1.1], h: [archR + 1, archR / 2 + 1, 1] });

  const archInner = new THREE.Mesh(
    new THREE.TorusGeometry(archR - 1.3, 0.3, 6, 60, Math.PI),
    new THREE.MeshBasicMaterial({ color: 0x1ea6d8 }));
  archInner.position.set(0, archY, cz - 0.45);
  scene.add(archInner);

  // jackpot badges around the arch
  const hex = new THREE.CylinderGeometry(1.5, 1.5, 0.45, 6);
  hex.rotateX(Math.PI / 2);
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (0.08 + 0.84 * (i / 6));
    const b = new THREE.Mesh(hex, lit(COLOUR.badge, 0.8));
    b.position.set(Math.cos(a) * archR, archY + Math.sin(a) * archR, cz - 0.2);
    b.rotation.z = a - Math.PI / 2;
    scene.add(b);
  }

  // the portal at the centre of the board
  const portal = new THREE.Mesh(
    new THREE.TorusGeometry(3.4, 0.5, 10, 40),
    lit(COLOUR.neon2, 1.0));
  portal.position.set(0, 17.5, cz - 0.3);
  scene.add(portal);

  const eye = new THREE.Mesh(
    new THREE.CircleGeometry(3.0, 36),
    new THREE.MeshBasicMaterial({ color: 0x080c1c }));
  eye.position.set(0, 17.5, cz - 0.34);
  scene.add(eye);

  const swirl = new THREE.Mesh(
    new THREE.RingGeometry(1.5, 2.9, 36),
    new THREE.MeshBasicMaterial({ color: 0x2f1b6b }));
  swirl.position.set(0, 17.5, cz - 0.33);
  scene.add(swirl);

  // the three lamps that have to light up together
  const lampColour = [0xd63b3b, 0xdcc23a, 0x47c25a];
  for (let i = 0; i < 3; i++) {
    const lamp = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.5, 0.5, 24),
      lit(lampColour[i], 0.9));
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set((i - 1) * 4.2, C.chuteExitY - 1.4, cz + 3);
    scene.add(lamp);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1.75, 0.22, 8, 24),
      new THREE.MeshStandardMaterial({ color: COLOUR.pusher, metalness: 0.9, roughness: 0.2 }));
    rim.position.copy(lamp.position);
    scene.add(rim);
  }
  SHELL.push({ c: [0, C.chuteExitY - 1.4, cz + 3], h: [7, 2, 1] });
}

function onResize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;

  if (!BOUNDS) BOUNDS = contentCorners();
  const target = BOUNDS.centre;

  const vFov = camera.fov * Math.PI / 180;
  const tanV = Math.tan(vFov / 2);
  const tanH = Math.tan(vFov / 2) * camera.aspect;

  // A lower eye line. Looking steeply down turned the two decks into a flight
  // of stairs; from here you look into the field the way you do at the real
  // cabinet, and the decks read as one machine.
  const tilt = 0.52;
  const fwd = new THREE.Vector3(0, -tilt, -1).normalize();   // camera to target
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();

  // For a point P, depth = dist + (P-target).fwd and screen offsets are fixed,
  // so each corner sets a minimum distance. Take the largest.
  let dist = 0;
  const rel = new THREE.Vector3();
  for (const p of BOUNDS.corners) {
    rel.subVectors(p, target);
    const f = rel.dot(fwd);
    dist = Math.max(dist,
      Math.abs(rel.dot(right)) / tanH - f,
      Math.abs(rel.dot(up)) / tanV - f);
  }
  dist *= 1.02;

  camera.position.copy(target).addScaledVector(fwd, -dist);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

/* ------------------------------------------------------------------ *
 *  Coins
 * ------------------------------------------------------------------ */

function buildCoinMesh() {
  const geo = new THREE.CylinderGeometry(CFG.coinR, CFG.coinR, CFG.coinT, 16);
  const mat = new THREE.MeshStandardMaterial({
    color: COLOUR.coin,       // silver medal
    metalness: 0.9,
    roughness: 0.28,
    envMapIntensity: 2.8,
    emissive: COLOUR.coin,
    emissiveIntensity: 0.05,  // keeps coins buried in the pile from going dead
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

function fill(n) {
  if (pile) machine.seedFrom(pile, n, stamp);
  else machine.seed(n, stamp);
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
  ui.sCoins.addEventListener('change', () => fill(+ui.sCoins.value));
  ui.btnReseed.addEventListener('click', () => fill(+ui.sCoins.value));

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
  fill(+ui.sCoins.value);
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
