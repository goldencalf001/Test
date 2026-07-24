import * as THREE from "three";
import "./style.css";

// ===== 3D 井（Blockout 风格）配置 =====
const SIZE_X = 6;
const SIZE_Z = 6;
const HEIGHT = 12;

const COLORS = {
  I: "#30dfff",
  O: "#ffe24a",
  L: "#ff973d",
  T: "#b16cff",
  S: "#7dff42",
  B: "#ff4b6e",
  P: "#4188ff",
  N: "#baff36",
};

// 三维多联立方体（tetracube）：[x, y, z]
const SHAPES = {
  I: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]],
  O: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]],
  L: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 0, 1]],
  T: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [1, 0, 1]],
  S: [[1, 0, 0], [2, 0, 0], [0, 0, 1], [1, 0, 1]],
  B: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0]],
  P: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [1, 1, 1]],
  N: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 1]],
};

const elements = {
  canvas: document.querySelector("#gameCanvas"),
  score: document.querySelector("#score"),
  best: document.querySelector("#bestScore"),
  level: document.querySelector("#level"),
  lines: document.querySelector("#lines"),
  next: document.querySelector("#nextPreview"),
  pause: document.querySelector("#pauseButton"),
  sound: document.querySelector("#soundButton"),
  overlay: document.querySelector("#gameOverlay"),
  pauseOverlay: document.querySelector("#pauseOverlay"),
  restart: document.querySelector("#restartButton"),
  finalScore: document.querySelector("#finalScore"),
  status: document.querySelector("#statusText"),
};

let board;
let current;
let nextType;
let bag = [];
let score = 0;
let layers = 0;
let level = 1;
let best = Number(localStorage.getItem("neon-stack-best") || 0);
let paused = false;
let gameOver = false;
let soundEnabled = true;
let softDrop = false;
let lastDrop = 0;
let lastFrame = performance.now();
let shake = 0;

// ===== 主场景 =====
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2("#080a10", 0.02);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
const cameraDirection = new THREE.Vector3(0.55, 0.62, 1).normalize();
const cameraTarget = new THREE.Vector3(0, -0.4, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor("#000000", 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
elements.canvas.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight("#aec7ff", "#141006", 1.5));
const keyLight = new THREE.DirectionalLight("#ffffff", 2.8);
keyLight.position.set(-8, 14, 10);
scene.add(keyLight);
const limeLight = new THREE.PointLight("#baff36", 26, 30);
limeLight.position.set(7, -4, 9);
scene.add(limeLight);
const blueLight = new THREE.PointLight("#267dff", 22, 32);
blueLight.position.set(-8, 9, -6);
scene.add(blueLight);

const boardRoot = new THREE.Group();
scene.add(boardRoot);

// 井底底座
const basePlate = new THREE.Mesh(
  new THREE.BoxGeometry(SIZE_X + 0.9, 0.4, SIZE_Z + 0.9),
  new THREE.MeshStandardMaterial({ color: "#11141d", metalness: 0.55, roughness: 0.4 })
);
basePlate.position.y = -HEIGHT / 2 - 0.22;
boardRoot.add(basePlate);

// 井壁网格线（底面 + 四壁 + 层环），提供深度参照
function buildWellGrid() {
  const points = [];
  const x0 = -SIZE_X / 2;
  const x1 = SIZE_X / 2;
  const z0 = -SIZE_Z / 2;
  const z1 = SIZE_Z / 2;
  const y0 = -HEIGHT / 2;
  const y1 = HEIGHT / 2;
  for (let x = 0; x <= SIZE_X; x++) {
    const wx = x0 + x;
    points.push(new THREE.Vector3(wx, y0, z0), new THREE.Vector3(wx, y0, z1));
    points.push(new THREE.Vector3(wx, y0, z0), new THREE.Vector3(wx, y1, z0));
    points.push(new THREE.Vector3(wx, y0, z1), new THREE.Vector3(wx, y1, z1));
  }
  for (let z = 0; z <= SIZE_Z; z++) {
    const wz = z0 + z;
    points.push(new THREE.Vector3(x0, y0, wz), new THREE.Vector3(x1, y0, wz));
    points.push(new THREE.Vector3(x0, y0, wz), new THREE.Vector3(x0, y1, wz));
    points.push(new THREE.Vector3(x1, y0, wz), new THREE.Vector3(x1, y1, wz));
  }
  for (let y = 0; y <= HEIGHT; y++) {
    const wy = y0 + y;
    points.push(new THREE.Vector3(x0, wy, z0), new THREE.Vector3(x1, wy, z0));
    points.push(new THREE.Vector3(x0, wy, z1), new THREE.Vector3(x1, wy, z1));
    points.push(new THREE.Vector3(x0, wy, z0), new THREE.Vector3(x0, wy, z1));
    points.push(new THREE.Vector3(x1, wy, z0), new THREE.Vector3(x1, wy, z1));
  }
  return new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: "#566074", transparent: true, opacity: 0.16 })
  );
}
boardRoot.add(buildWellGrid());

// 井口高亮描边
const rimPoints = [
  new THREE.Vector3(-SIZE_X / 2, HEIGHT / 2, -SIZE_Z / 2),
  new THREE.Vector3(SIZE_X / 2, HEIGHT / 2, -SIZE_Z / 2),
  new THREE.Vector3(SIZE_X / 2, HEIGHT / 2, SIZE_Z / 2),
  new THREE.Vector3(-SIZE_X / 2, HEIGHT / 2, SIZE_Z / 2),
  new THREE.Vector3(-SIZE_X / 2, HEIGHT / 2, -SIZE_Z / 2),
];
boardRoot.add(new THREE.Line(
  new THREE.BufferGeometry().setFromPoints(rimPoints),
  new THREE.LineBasicMaterial({ color: "#baff36", transparent: true, opacity: 0.55 })
));

// 星空背景
const starsGeometry = new THREE.BufferGeometry();
const stars = new Float32Array(260 * 3);
for (let i = 0; i < stars.length; i += 3) {
  stars[i] = (Math.random() - 0.5) * 46;
  stars[i + 1] = (Math.random() - 0.5) * 40;
  stars[i + 2] = -6 - Math.random() * 22;
}
starsGeometry.setAttribute("position", new THREE.BufferAttribute(stars, 3));
const starField = new THREE.Points(starsGeometry, new THREE.PointsMaterial({ color: "#9eb0c9", size: 0.05, transparent: true, opacity: 0.5 }));
scene.add(starField);

const lockedGroup = new THREE.Group();
const ghostGroup = new THREE.Group();
const activeGroup = new THREE.Group();
const footprintGroup = new THREE.Group();
boardRoot.add(lockedGroup, ghostGroup, activeGroup, footprintGroup);

const boxGeometry = new THREE.BoxGeometry(0.92, 0.92, 0.92, 2, 2, 2);
const edgesGeometry = new THREE.EdgesGeometry(boxGeometry, 25);
const ghostGeometry = new THREE.BoxGeometry(0.9, 0.9, 0.9);
const footprintGeometry = new THREE.PlaneGeometry(0.94, 0.94);
const materialCache = {};

function pieceMaterial(type) {
  if (!materialCache[type]) {
    materialCache[type] = new THREE.MeshPhysicalMaterial({
      color: COLORS[type],
      emissive: new THREE.Color(COLORS[type]),
      emissiveIntensity: 0.2,
      metalness: 0.18,
      roughness: 0.3,
      clearcoat: 0.7,
      clearcoatRoughness: 0.22,
    });
  }
  return materialCache[type];
}

function makeBlock(type, ghost = false) {
  if (ghost) {
    return new THREE.Mesh(
      ghostGeometry,
      new THREE.MeshBasicMaterial({ color: COLORS[type], transparent: true, opacity: 0.28, wireframe: true })
    );
  }
  const block = new THREE.Mesh(boxGeometry, pieceMaterial(type));
  block.add(new THREE.LineSegments(
    edgesGeometry,
    new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.28 })
  ));
  return block;
}

function worldPosition(x, y, z) {
  return [x - SIZE_X / 2 + 0.5, y - HEIGHT / 2 + 0.5, z - SIZE_Z / 2 + 0.5];
}

function clearGroup(group) {
  while (group.children.length) group.remove(group.children[0]);
}

function syncLockedBlocks() {
  clearGroup(lockedGroup);
  for (let y = 0; y < HEIGHT; y++) {
    for (let z = 0; z < SIZE_Z; z++) {
      for (let x = 0; x < SIZE_X; x++) {
        const type = board[y][z][x];
        if (!type) continue;
        const block = makeBlock(type);
        block.position.set(...worldPosition(x, y, z));
        lockedGroup.add(block);
      }
    }
  }
}

function syncActivePiece() {
  clearGroup(activeGroup);
  clearGroup(ghostGroup);
  clearGroup(footprintGroup);
  if (!current || gameOver) return;

  let ghostY = current.y;
  while (isValid(current.cells, current.x, ghostY - 1, current.z)) ghostY--;

  const columns = new Set();
  current.cells.forEach(([x, y, z]) => {
    const ghost = makeBlock(current.type, true);
    ghost.position.set(...worldPosition(x + current.x, y + ghostY, z + current.z));
    ghostGroup.add(ghost);

    const block = makeBlock(current.type);
    block.position.set(...worldPosition(x + current.x, y + current.y, z + current.z));
    activeGroup.add(block);

    columns.add(`${x + current.x},${z + current.z}`);
  });

  // 底面投影，辅助瞄准
  columns.forEach(key => {
    const [x, z] = key.split(",").map(Number);
    const marker = new THREE.Mesh(
      footprintGeometry,
      new THREE.MeshBasicMaterial({ color: COLORS[current.type], transparent: true, opacity: 0.2, side: THREE.DoubleSide })
    );
    marker.rotation.x = -Math.PI / 2;
    const [wx, , wz] = worldPosition(x, 0, z);
    marker.position.set(wx, -HEIGHT / 2 + 0.015, wz);
    footprintGroup.add(marker);
  });
}

// ===== 规则逻辑 =====
function shuffledBag() {
  const types = Object.keys(SHAPES);
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [types[i], types[j]] = [types[j], types[i]];
  }
  return types;
}

function takeType() {
  if (!bag.length) bag = shuffledBag();
  return bag.pop();
}

function boundsOf(cells) {
  return {
    x: Math.max(...cells.map(c => c[0])) + 1,
    y: Math.max(...cells.map(c => c[1])) + 1,
    z: Math.max(...cells.map(c => c[2])) + 1,
  };
}

function normalizeCells(cells) {
  const minX = Math.min(...cells.map(c => c[0]));
  const minY = Math.min(...cells.map(c => c[1]));
  const minZ = Math.min(...cells.map(c => c[2]));
  return cells.map(([x, y, z]) => [x - minX, y - minY, z - minZ]);
}

function createPiece(type) {
  const cells = SHAPES[type].map(cell => [...cell]);
  const size = boundsOf(cells);
  return {
    type,
    cells,
    x: Math.floor((SIZE_X - size.x) / 2),
    y: HEIGHT - size.y,
    z: Math.floor((SIZE_Z - size.z) / 2),
  };
}

function spawnPiece() {
  current = createPiece(nextType || takeType());
  nextType = takeType();
  renderNext();
  if (!isValid(current.cells, current.x, current.y, current.z)) {
    endGame();
    return;
  }
  syncActivePiece();
}

function isValid(cells, px, py, pz) {
  return cells.every(([x, y, z]) => {
    const bx = x + px;
    const by = y + py;
    const bz = z + pz;
    return bx >= 0 && bx < SIZE_X && by >= 0 && by < HEIGHT && bz >= 0 && bz < SIZE_Z && !board[by][bz][bx];
  });
}

function move(dx, dy, dz, fromPlayer = true) {
  if (paused || gameOver || !current) return false;
  if (isValid(current.cells, current.x + dx, current.y + dy, current.z + dz)) {
    current.x += dx;
    current.y += dy;
    current.z += dz;
    if (dy < 0 && softDrop && !fromPlayer) score += 1;
    syncActivePiece();
    updateStats();
    if (fromPlayer) playTone(260, 0.025, 0.018);
    return true;
  }
  if (dy < 0 && !fromPlayer) lockPiece();
  return false;
}

const ROTATIONS = {
  yawLeft: ([x, y, z]) => [z, y, -x],
  yawRight: ([x, y, z]) => [-z, y, x],
  pitchForward: ([x, y, z]) => [x, z, -y],
  pitchBack: ([x, y, z]) => [x, -z, y],
  rollLeft: ([x, y, z]) => [-y, x, z],
  rollRight: ([x, y, z]) => [y, -x, z],
};

const KICKS = [
  [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
  [2, 0], [-2, 0], [0, 2], [0, -2],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
];

function rotate(name) {
  if (paused || gameOver || !current) return;
  const rotFn = ROTATIONS[name];
  const n = current.cells.length;
  const cx = current.cells.reduce((sum, cell) => sum + cell[0], 0) / n;
  const cy = current.cells.reduce((sum, cell) => sum + cell[1], 0) / n;
  const cz = current.cells.reduce((sum, cell) => sum + cell[2], 0) / n;

  // 绕质心做 90° 旋转，保持方块在原地翻转而不是绕角落甩出去
  const rotated = current.cells.map(([x, y, z]) => {
    const [rx, ry, rz] = rotFn([x - cx, y - cy, z - cz]);
    return [Math.round(rx + cx), Math.round(ry + cy), Math.round(rz + cz)];
  });

  for (const [kx, kz] of KICKS) {
    for (const ky of [0, -1, -2, 1]) {
      if (isValid(rotated, current.x + kx, current.y + ky, current.z + kz)) {
        current.cells = rotated;
        current.x += kx;
        current.y += ky;
        current.z += kz;
        syncActivePiece();
        playTone(520, 0.04, 0.025);
        return;
      }
    }
  }
}

function hardDrop() {
  if (paused || gameOver || !current) return;
  let distance = 0;
  while (isValid(current.cells, current.x, current.y - 1, current.z)) {
    current.y--;
    distance++;
  }
  score += distance * 2;
  syncActivePiece();
  playTone(110, 0.07, 0.05);
  lockPiece();
}

function lockPiece() {
  current.cells.forEach(([x, y, z]) => {
    board[y + current.y][z + current.z][x + current.x] = current.type;
  });
  clearLayers();
  spawnPiece();
  syncLockedBlocks();
  updateStats();
}

function clearLayers() {
  const fullRows = [];
  for (let y = 0; y < HEIGHT; y++) {
    if (board[y].every(row => row.every(Boolean))) fullRows.push(y);
  }
  if (!fullRows.length) return;

  board = board.filter((_, index) => !fullRows.includes(index));
  while (board.length < HEIGHT) {
    board.push(Array.from({ length: SIZE_Z }, () => Array(SIZE_X).fill(null)));
  }
  const count = fullRows.length;
  layers += count;
  level = Math.floor(layers / 4) + 1;
  score += [0, 600, 1600, 3400, 6000][Math.min(count, 4)] * level;
  shake = 0.24 + count * 0.08;
  playClearSound(count);
}

// ===== 下一块 3D 预览 =====
const previewScene = new THREE.Scene();
const previewCamera = new THREE.PerspectiveCamera(34, 4 / 3, 0.1, 30);
previewCamera.position.set(2.6, 2.4, 4.4);
previewCamera.lookAt(0, 0, 0);
previewScene.add(new THREE.HemisphereLight("#cfe0ff", "#20180a", 2.2));
const previewLight = new THREE.DirectionalLight("#ffffff", 2.6);
previewLight.position.set(3, 6, 4);
previewScene.add(previewLight);
const previewGroup = new THREE.Group();
previewScene.add(previewGroup);

const previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
previewRenderer.setSize(132, 96);
previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
elements.next.replaceChildren(previewRenderer.domElement);

function renderNext() {
  clearGroup(previewGroup);
  const cells = normalizeCells(SHAPES[nextType]);
  const size = boundsOf(cells);
  cells.forEach(([x, y, z]) => {
    const block = makeBlock(nextType);
    block.position.set(x - size.x / 2 + 0.5, y - size.y / 2 + 0.5, z - size.z / 2 + 0.5);
    previewGroup.add(block);
  });
}

// ===== HUD =====
function formatScore(value) {
  return Math.max(0, value).toString().padStart(6, "0");
}

function updateStats() {
  if (score > best) {
    best = score;
    localStorage.setItem("neon-stack-best", String(best));
  }
  elements.score.textContent = formatScore(score);
  elements.best.textContent = formatScore(best);
  elements.level.textContent = String(level).padStart(2, "0");
  elements.lines.textContent = String(layers).padStart(2, "0");
}

function endGame() {
  gameOver = true;
  current = null;
  clearGroup(activeGroup);
  clearGroup(ghostGroup);
  clearGroup(footprintGroup);
  elements.finalScore.textContent = formatScore(score);
  elements.overlay.classList.remove("hidden");
  elements.status.textContent = "游戏结束";
  playTone(75, 0.45, 0.1);
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  elements.pauseOverlay.classList.toggle("hidden", !paused);
  elements.pause.innerHTML = paused ? '<span class="pause-icon">▶</span> 继续' : '<span class="pause-icon">Ⅱ</span> 暂停';
  elements.status.textContent = paused ? "游戏已暂停" : "游戏进行中";
  lastFrame = performance.now();
}

function resetGame() {
  board = Array.from({ length: HEIGHT }, () =>
    Array.from({ length: SIZE_Z }, () => Array(SIZE_X).fill(null))
  );
  bag = [];
  current = null;
  nextType = takeType();
  score = 0;
  layers = 0;
  level = 1;
  paused = false;
  gameOver = false;
  softDrop = false;
  lastDrop = 0;
  elements.overlay.classList.add("hidden");
  elements.pauseOverlay.classList.add("hidden");
  elements.pause.innerHTML = '<span class="pause-icon">Ⅱ</span> 暂停';
  elements.status.textContent = "游戏进行中";
  syncLockedBlocks();
  updateStats();
  spawnPiece();
}

// ===== 音效 =====
let audioContext;
function playTone(frequency, duration, volume = 0.025, delay = 0) {
  if (!soundEnabled) return;
  try {
    audioContext ||= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, audioContext.currentTime + delay);
    gain.gain.linearRampToValueAtTime(volume, audioContext.currentTime + delay + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + delay + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(audioContext.currentTime + delay);
    oscillator.stop(audioContext.currentTime + delay + duration);
  } catch {
    soundEnabled = false;
  }
}

function playClearSound(count) {
  for (let i = 0; i < count + 2; i++) playTone(330 + i * 120, 0.12, 0.035, i * 0.055);
}

// ===== 输入 =====
// 将“屏幕方向”映射到井坐标，避免鼠标微旋后左右键与视觉不一致
function screenMove(screenDx, screenDz) {
  const yaw = boardRoot.rotation.y;
  const sectors = [
    { dx: screenDx, dz: screenDz },
    { dx: screenDz, dz: -screenDx },
    { dx: -screenDx, dz: -screenDz },
    { dx: -screenDz, dz: screenDx },
  ];
  const index = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
  const mapped = sectors[index];
  move(mapped.dx, 0, mapped.dz);
}

const mobileRotations = ["yawLeft", "yawRight", "pitchForward", "rollRight"];
let mobileRotationIndex = 0;

function handleAction(action) {
  if (action === "left") screenMove(-1, 0);
  if (action === "right") screenMove(1, 0);
  if (action === "forward") screenMove(0, 1);
  if (action === "back") screenMove(0, -1);
  if (action === "rotate") {
    rotate(mobileRotations[mobileRotationIndex % mobileRotations.length]);
    mobileRotationIndex += 1;
  }
  if (action === "drop") hardDrop();
}

document.addEventListener("keydown", event => {
  const blocked = ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space"];
  if (blocked.includes(event.code)) event.preventDefault();
  if (event.repeat && ["Space", "KeyP", "Escape"].includes(event.code)) return;

  if (event.code === "ArrowLeft") handleAction("left");
  if (event.code === "ArrowRight") handleAction("right");
  if (event.code === "ArrowUp") handleAction("back");
  if (event.code === "ArrowDown") handleAction("forward");
  if (event.code === "KeyQ") rotate("yawLeft");
  if (event.code === "KeyE") rotate("yawRight");
  if (event.code === "KeyW") rotate("pitchForward");
  if (event.code === "KeyS") rotate("pitchBack");
  if (event.code === "KeyA") rotate("rollLeft");
  if (event.code === "KeyD") rotate("rollRight");
  if (event.code === "Space") handleAction("drop");
  if (event.code === "ShiftLeft" || event.code === "ShiftRight") softDrop = true;
  if (event.code === "KeyP" || event.code === "Escape") togglePause();
});

document.addEventListener("keyup", event => {
  if (event.code === "ShiftLeft" || event.code === "ShiftRight") softDrop = false;
});

// 失焦时清除软降，避免 Shift 粘滞导致一直加速
window.addEventListener("blur", () => { softDrop = false; });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) softDrop = false;
});

document.querySelectorAll(".mobile-controls button").forEach(button => {
  button.addEventListener("pointerdown", event => {
    event.preventDefault();
    handleAction(button.dataset.action);
  });
});
elements.pause.addEventListener("click", togglePause);
elements.restart.addEventListener("click", resetGame);
elements.sound.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  elements.sound.classList.toggle("muted", !soundEnabled);
  if (soundEnabled) playTone(440, 0.08);
});

let pointerX = 0;
let pointerY = 0;
window.addEventListener("pointermove", event => {
  pointerX = event.clientX / window.innerWidth - 0.5;
  pointerY = event.clientY / window.innerHeight - 0.5;
});

// ===== 布局与渲染循环 =====
function resize() {
  const { width, height } = elements.canvas.getBoundingClientRect();
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  const distance = 21.5 * Math.max(1, 1.05 / camera.aspect);
  camera.position.copy(cameraDirection).multiplyScalar(distance).add(cameraTarget);
  camera.lookAt(cameraTarget);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(elements.canvas);

function animate(now) {
  requestAnimationFrame(animate);
  const delta = Math.min(now - lastFrame, 100);
  lastFrame = now;

  if (!paused && !gameOver) {
    lastDrop += delta;
    const base = Math.max(130, 1050 * Math.pow(0.8, level - 1));
    const interval = softDrop ? Math.max(35, base / 14) : base;
    if (lastDrop >= interval) {
      move(0, -1, 0, false);
      lastDrop = 0;
    }
  }

  // 轻微视差，避免大幅旋转导致操作方向混乱
  const targetRotY = pointerX * 0.12;
  const targetRotX = pointerY * 0.05;
  boardRoot.rotation.y += (targetRotY - boardRoot.rotation.y) * 0.04;
  boardRoot.rotation.x += (targetRotX - boardRoot.rotation.x) * 0.04;
  starField.rotation.z += delta * 0.000005;

  if (shake > 0.001) {
    boardRoot.position.x = (Math.random() - 0.5) * shake;
    boardRoot.position.y = (Math.random() - 0.5) * shake;
    shake *= 0.86;
  } else {
    boardRoot.position.set(0, 0, 0);
  }

  previewGroup.rotation.y += delta * 0.0011;
  previewGroup.rotation.x = 0.28;
  previewRenderer.render(previewScene, previewCamera);
  renderer.render(scene, camera);
}

updateStats();
resetGame();
resize();
requestAnimationFrame(animate);

// 供自动化测试使用的调试接口
window.__game = {
  getState: () => ({
    board,
    current: current ? { type: current.type, x: current.x, y: current.y, z: current.z, cells: current.cells.map(c => [...c]) } : null,
    nextType,
    score,
    layers,
    level,
    paused,
    gameOver,
    size: { x: SIZE_X, y: HEIGHT, z: SIZE_Z },
  }),
  move,
  rotate,
  hardDrop,
  togglePause,
  reset: resetGame,
  setBoardCell: (x, y, z, type) => { board[y][z][x] = type; syncLockedBlocks(); },
};
