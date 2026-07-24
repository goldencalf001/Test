import * as THREE from "three";
import "./style.css";

const WIDTH = 10;
const HEIGHT = 20;
const COLORS = {
  I: "#30dfff",
  O: "#ffe24a",
  T: "#b16cff",
  S: "#7dff42",
  Z: "#ff4b6e",
  J: "#4188ff",
  L: "#ff973d",
};
const SHAPES = {
  I: [[0, 0], [1, 0], [2, 0], [3, 0]],
  O: [[0, 0], [1, 0], [0, 1], [1, 1]],
  T: [[0, 0], [1, 0], [2, 0], [1, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
  J: [[0, 0], [0, 1], [1, 0], [2, 0]],
  L: [[0, 0], [1, 0], [2, 0], [2, 1]],
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
  countdown: document.querySelector("#countdown"),
};

let board;
let current;
let nextType;
let bag = [];
let score = 0;
let lines = 0;
let level = 1;
let best = Number(localStorage.getItem("neon-stack-best") || 0);
let paused = false;
let gameOver = false;
let soundEnabled = true;
let lastDrop = 0;
let lastFrame = performance.now();
let shake = 0;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x080a10, 0.035);
const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
camera.position.set(0, 0.3, 31);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
elements.canvas.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xaec7ff, 0x141006, 1.7));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
keyLight.position.set(-7, 10, 12);
scene.add(keyLight);
const limeLight = new THREE.PointLight(0xbaff36, 18, 23);
limeLight.position.set(5, -7, 8);
scene.add(limeLight);
const blueLight = new THREE.PointLight(0x267dff, 15, 25);
blueLight.position.set(-7, 7, 5);
scene.add(blueLight);

const boardRoot = new THREE.Group();
boardRoot.rotation.set(-0.025, -0.075, 0);
scene.add(boardRoot);

const backing = new THREE.Mesh(
  new THREE.PlaneGeometry(WIDTH + 0.5, HEIGHT + 0.5),
  new THREE.MeshStandardMaterial({ color: 0x090d14, roughness: 0.66, metalness: 0.3, transparent: true, opacity: 0.92 })
);
backing.position.z = -0.65;
boardRoot.add(backing);

const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x333842, metalness: 0.8, roughness: 0.24 });
[
  [0, HEIGHT / 2 + 0.35, WIDTH + 1.15, 0.18],
  [0, -HEIGHT / 2 - 0.35, WIDTH + 1.15, 0.18],
  [-WIDTH / 2 - 0.35, 0, 0.18, HEIGHT + 0.88],
  [WIDTH / 2 + 0.35, 0, 0.18, HEIGHT + 0.88],
].forEach(([x, y, w, h]) => {
  const rail = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.42), frameMaterial);
  rail.position.set(x, y, -0.08);
  boardRoot.add(rail);
});

const gridMaterial = new THREE.LineBasicMaterial({ color: 0x48505e, transparent: true, opacity: 0.14 });
const gridPoints = [];
for (let x = 0; x <= WIDTH; x++) {
  gridPoints.push(new THREE.Vector3(x - WIDTH / 2, -HEIGHT / 2, -0.55), new THREE.Vector3(x - WIDTH / 2, HEIGHT / 2, -0.55));
}
for (let y = 0; y <= HEIGHT; y++) {
  gridPoints.push(new THREE.Vector3(-WIDTH / 2, y - HEIGHT / 2, -0.55), new THREE.Vector3(WIDTH / 2, y - HEIGHT / 2, -0.55));
}
const grid = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gridPoints), gridMaterial);
boardRoot.add(grid);

const starsGeometry = new THREE.BufferGeometry();
const stars = new Float32Array(240 * 3);
for (let i = 0; i < stars.length; i += 3) {
  stars[i] = (Math.random() - 0.5) * 36;
  stars[i + 1] = (Math.random() - 0.5) * 35;
  stars[i + 2] = -4 - Math.random() * 16;
}
starsGeometry.setAttribute("position", new THREE.BufferAttribute(stars, 3));
const starField = new THREE.Points(starsGeometry, new THREE.PointsMaterial({ color: 0x9eb0c9, size: 0.035, transparent: true, opacity: 0.5 }));
scene.add(starField);

const lockedGroup = new THREE.Group();
const ghostGroup = new THREE.Group();
const activeGroup = new THREE.Group();
boardRoot.add(lockedGroup, ghostGroup, activeGroup);

const boxGeometry = new THREE.BoxGeometry(0.88, 0.88, 0.88, 2, 2, 2);
const ghostGeometry = new THREE.BoxGeometry(0.86, 0.86, 0.18);
const materialCache = {};

function pieceMaterial(type) {
  if (!materialCache[type]) {
    materialCache[type] = new THREE.MeshPhysicalMaterial({
      color: COLORS[type],
      emissive: new THREE.Color(COLORS[type]),
      emissiveIntensity: 0.22,
      metalness: 0.18,
      roughness: 0.28,
      clearcoat: 0.75,
      clearcoatRoughness: 0.2,
    });
  }
  return materialCache[type];
}

function makeBlock(type, ghost = false) {
  if (ghost) {
    return new THREE.Mesh(
      ghostGeometry,
      new THREE.MeshBasicMaterial({ color: COLORS[type], transparent: true, opacity: 0.15, wireframe: true })
    );
  }
  const block = new THREE.Mesh(boxGeometry, pieceMaterial(type));
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(boxGeometry, 25),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.27 })
  );
  block.add(edges);
  return block;
}

function worldPosition(x, y, z = 0) {
  return [x - WIDTH / 2 + 0.5, y - HEIGHT / 2 + 0.5, z];
}

function clearGroup(group) {
  while (group.children.length) group.remove(group.children[0]);
}

function syncLockedBlocks() {
  clearGroup(lockedGroup);
  board.forEach((row, y) => row.forEach((type, x) => {
    if (!type) return;
    const block = makeBlock(type);
    block.position.set(...worldPosition(x, y));
    lockedGroup.add(block);
  }));
}

function absoluteCells(piece, overrideY = piece.y) {
  return piece.cells.map(([x, y]) => [x + piece.x, y + overrideY]);
}

function syncActivePiece() {
  clearGroup(activeGroup);
  clearGroup(ghostGroup);
  if (!current || gameOver) return;

  let ghostY = current.y;
  while (isValid(current, current.x, ghostY - 1, current.cells)) ghostY--;

  current.cells.forEach(([x, y]) => {
    const ghost = makeBlock(current.type, true);
    ghost.position.set(...worldPosition(x + current.x, y + ghostY, -0.25));
    ghostGroup.add(ghost);

    const block = makeBlock(current.type);
    block.position.set(...worldPosition(x + current.x, y + current.y, 0.08));
    activeGroup.add(block);
  });
}

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

function createPiece(type) {
  const cells = SHAPES[type].map(cell => [...cell]);
  const pieceWidth = Math.max(...cells.map(([x]) => x)) + 1;
  const pieceHeight = Math.max(...cells.map(([, y]) => y)) + 1;
  return { type, cells, x: Math.floor((WIDTH - pieceWidth) / 2), y: HEIGHT - pieceHeight };
}

function spawnPiece() {
  current = createPiece(nextType || takeType());
  nextType = takeType();
  renderNext();
  if (!isValid(current, current.x, current.y, current.cells)) endGame();
  syncActivePiece();
}

function isValid(piece, targetX, targetY, cells) {
  return cells.every(([x, y]) => {
    const bx = x + targetX;
    const by = y + targetY;
    return bx >= 0 && bx < WIDTH && by >= 0 && by < HEIGHT && !board[by][bx];
  });
}

function normalizeCells(cells) {
  const minX = Math.min(...cells.map(([x]) => x));
  const minY = Math.min(...cells.map(([, y]) => y));
  return cells.map(([x, y]) => [x - minX, y - minY]);
}

function move(dx, dy, fromPlayer = true) {
  if (paused || gameOver || !current) return false;
  if (isValid(current, current.x + dx, current.y + dy, current.cells)) {
    current.x += dx;
    current.y += dy;
    if (fromPlayer && dy < 0) score += 1;
    syncActivePiece();
    updateStats();
    if (fromPlayer) playTone(260, 0.025, 0.018);
    return true;
  }
  if (dy < 0 && !fromPlayer) lockPiece();
  return false;
}

function rotate() {
  if (paused || gameOver || !current || current.type === "O") return;
  const rotated = normalizeCells(current.cells.map(([x, y]) => [y, -x]));
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (isValid(current, current.x + kick, current.y, rotated)) {
      current.cells = rotated;
      current.x += kick;
      syncActivePiece();
      playTone(520, 0.04, 0.025);
      return;
    }
  }
}

function hardDrop() {
  if (paused || gameOver || !current) return;
  let distance = 0;
  while (isValid(current, current.x, current.y - 1, current.cells)) {
    current.y--;
    distance++;
  }
  score += distance * 2;
  syncActivePiece();
  playTone(110, 0.07, 0.05);
  lockPiece();
}

function lockPiece() {
  absoluteCells(current).forEach(([x, y]) => { board[y][x] = current.type; });
  clearLines();
  spawnPiece();
  syncLockedBlocks();
  updateStats();
}

function clearLines() {
  const fullRows = [];
  board.forEach((row, index) => {
    if (row.every(Boolean)) fullRows.push(index);
  });
  if (!fullRows.length) return;

  board = board.filter((_, index) => !fullRows.includes(index));
  while (board.length < HEIGHT) board.push(Array(WIDTH).fill(null));
  const count = fullRows.length;
  lines += count;
  level = Math.floor(lines / 10) + 1;
  score += [0, 100, 300, 500, 800][count] * level;
  shake = 0.22 + count * 0.06;
  playClearSound(count);
}

function renderNext() {
  elements.next.replaceChildren();
  const grid = document.createElement("div");
  grid.className = "preview-grid";
  const cells = normalizeCells(SHAPES[nextType]);
  const width = Math.max(...cells.map(([x]) => x)) + 1;
  const offset = Math.floor((4 - width) / 2);
  for (let y = 2; y >= 0; y--) {
    for (let x = 0; x < 4; x++) {
      const cell = document.createElement("i");
      if (cells.some(([cx, cy]) => cx + offset === x && cy === y)) {
        cell.className = "preview-block";
        cell.style.setProperty("--piece", COLORS[nextType]);
      }
      grid.appendChild(cell);
    }
  }
  elements.next.appendChild(grid);
}

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
  elements.lines.textContent = String(lines).padStart(2, "0");
}

function endGame() {
  gameOver = true;
  current = null;
  clearGroup(activeGroup);
  clearGroup(ghostGroup);
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
  board = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(null));
  bag = [];
  current = null;
  nextType = takeType();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  lastDrop = 0;
  elements.overlay.classList.add("hidden");
  elements.pauseOverlay.classList.add("hidden");
  elements.pause.innerHTML = '<span class="pause-icon">Ⅱ</span> 暂停';
  elements.status.textContent = "游戏进行中";
  syncLockedBlocks();
  updateStats();
  spawnPiece();
}

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

function handleAction(action) {
  if (action === "left") move(-1, 0);
  if (action === "right") move(1, 0);
  if (action === "down") move(0, -1);
  if (action === "rotate") rotate();
  if (action === "drop") hardDrop();
}

document.addEventListener("keydown", event => {
  const controls = ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space"];
  if (controls.includes(event.code)) event.preventDefault();
  if (event.repeat && ["ArrowUp", "Space", "KeyP"].includes(event.code)) return;
  if (event.code === "ArrowLeft") handleAction("left");
  if (event.code === "ArrowRight") handleAction("right");
  if (event.code === "ArrowDown") handleAction("down");
  if (event.code === "ArrowUp") handleAction("rotate");
  if (event.code === "Space") handleAction("drop");
  if (event.code === "KeyP" || event.code === "Escape") togglePause();
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

function resize() {
  const { width, height } = elements.canvas.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  const requiredHeight = HEIGHT + 2.2;
  camera.position.z = requiredHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * Math.max(1, camera.aspect * 0.54);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(elements.canvas);

function animate(now) {
  requestAnimationFrame(animate);
  const delta = Math.min(now - lastFrame, 100);
  lastFrame = now;

  if (!paused && !gameOver) {
    lastDrop += delta;
    const interval = Math.max(90, 900 * Math.pow(0.83, level - 1));
    if (lastDrop >= interval) {
      move(0, -1, false);
      lastDrop = 0;
    }
  }

  const targetRotY = -0.075 + pointerX * 0.045;
  const targetRotX = -0.025 + pointerY * 0.025;
  boardRoot.rotation.y += (targetRotY - boardRoot.rotation.y) * 0.035;
  boardRoot.rotation.x += (targetRotX - boardRoot.rotation.x) * 0.035;
  starField.rotation.z += delta * 0.000006;
  activeGroup.children.forEach((block, index) => {
    block.position.z = 0.08 + Math.sin(now * 0.003 + index) * 0.025;
  });
  if (shake > 0.001) {
    boardRoot.position.x = (Math.random() - 0.5) * shake;
    boardRoot.position.y = (Math.random() - 0.5) * shake;
    shake *= 0.86;
  } else {
    boardRoot.position.set(0, 0, 0);
  }
  renderer.render(scene, camera);
}

updateStats();
resetGame();
resize();
requestAnimationFrame(animate);
