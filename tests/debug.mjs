// Interactive browser debug session for NEON STACK 3D Tetris
import { chromium } from "playwright";
import fs from "node:fs";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:5173";
const OUT = "/opt/cursor/artifacts/screenshots";
fs.mkdirSync(OUT, { recursive: true });

const logs = { errors: [], warnings: [], infos: [] };
const findings = [];

function note(ok, title, detail = "") {
  findings.push({ ok, title, detail });
  console.log(`${ok ? "OK  " : "BUG "} ${title}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

page.on("console", msg => {
  const text = msg.text();
  if (msg.type() === "error") logs.errors.push(text);
  else if (msg.type() === "warning") logs.warnings.push(text);
  else logs.infos.push(text);
});
page.on("pageerror", err => logs.errors.push(String(err)));

await page.goto(BASE_URL, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__game?.getState()?.current, { timeout: 10000 });

// --- Screenshot: initial load ---
await page.screenshot({ path: `${OUT}/debug-01-initial.png`, fullPage: true });

// Canvas / WebGL sanity
const renderInfo = await page.evaluate(() => {
  const canvas = document.querySelector("#gameCanvas canvas");
  const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl");
  const rect = canvas?.getBoundingClientRect();
  const state = window.__game.getState();
  return {
    hasCanvas: !!canvas,
    canvasSize: canvas ? { w: canvas.width, h: canvas.height } : null,
    cssSize: rect ? { w: Math.round(rect.width), h: Math.round(rect.height) } : null,
    webgl: !!gl,
    webglError: gl?.getError?.() ?? null,
    piece: state.current,
    next: state.nextType,
    scoreText: document.querySelector("#score")?.textContent,
    levelText: document.querySelector("#level")?.textContent,
    layersText: document.querySelector("#lines")?.textContent,
    nextHasCanvas: !!document.querySelector("#nextPreview canvas"),
  };
});

note(renderInfo.hasCanvas, "主画布存在", JSON.stringify(renderInfo.canvasSize));
note(renderInfo.webgl, "WebGL 可用");
note(renderInfo.canvasSize?.w > 100 && renderInfo.canvasSize?.h > 100, "画布像素尺寸正常",
  `${renderInfo.canvasSize?.w}x${renderInfo.canvasSize?.h}`);
note(renderInfo.nextHasCanvas, "下一块预览画布存在");
note(!!renderInfo.piece, "当前方块已生成", renderInfo.piece?.type);
note(renderInfo.scoreText === "000000", "分数 HUD 初始正确", renderInfo.scoreText);

// Sample a few pixels from the main canvas to detect blank/black-only render
const pixelSample = await page.evaluate(() => {
  const canvas = document.querySelector("#gameCanvas canvas");
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  // force a frame
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      const w = canvas.width;
      const h = canvas.height;
      const samples = [];
      const points = [
        [0.5, 0.5], [0.45, 0.65], [0.5, 0.8], [0.35, 0.55], [0.65, 0.55],
      ];
      for (const [fx, fy] of points) {
        const x = Math.floor(w * fx);
        const y = Math.floor(h * fy);
        const buf = new Uint8Array(4);
        // WebGL readPixels origin is bottom-left
        gl.readPixels(x, h - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        samples.push({ x, y, rgba: [...buf] });
      }
      resolve({ w, h, samples, error: gl.getError() });
    });
  });
});

const nonBlack = pixelSample.samples.filter(s => s.rgba[0] + s.rgba[1] + s.rgba[2] > 20);
note(nonBlack.length > 0, "主画布有非黑色像素（场景已绘制）",
  `亮点 ${nonBlack.length}/${pixelSample.samples.length}`);

// Keyboard interactions: move around then screenshot
await page.keyboard.press("ArrowLeft");
await page.keyboard.press("ArrowLeft");
await page.keyboard.press("ArrowUp");
await page.keyboard.press("KeyQ");
await page.keyboard.press("KeyW");
await page.waitForTimeout(200);
const afterMove = await page.evaluate(() => window.__game.getState().current);
note(!!afterMove, "键盘操作后仍有当前块", JSON.stringify({ type: afterMove?.type, x: afterMove?.x, y: afterMove?.y, z: afterMove?.z }));
await page.screenshot({ path: `${OUT}/debug-02-after-move.png` });

// Soft drop then hard drop
await page.keyboard.down("Shift");
await page.waitForTimeout(400);
await page.keyboard.up("Shift");
await page.keyboard.press("Space");
await page.waitForTimeout(150);
const afterDrop = await page.evaluate(() => window.__game.getState());
note(afterDrop.score > 0, "硬降后得分增加", `score=${afterDrop.score}`);
note(afterDrop.board.flat(2).filter(Boolean).length === 4, "硬降后锁定 4 格",
  `filled=${afterDrop.board.flat(2).filter(Boolean).length}`);
await page.screenshot({ path: `${OUT}/debug-03-after-harddrop.png` });

// Pause / resume
await page.click("#pauseButton");
await page.waitForTimeout(100);
const paused = await page.evaluate(() => ({
  paused: window.__game.getState().paused,
  overlayHidden: document.querySelector("#pauseOverlay").classList.contains("hidden"),
}));
note(paused.paused && !paused.overlayHidden, "暂停按钮与遮罩联动");
await page.screenshot({ path: `${OUT}/debug-04-paused.png` });
await page.click("#pauseButton");

// Fill a layer and verify clear feedback
await page.evaluate(() => {
  window.__game.reset();
  for (let z = 0; z < 6; z++) for (let x = 0; x < 6; x++) window.__game.setBoardCell(x, 0, z, "I");
});
await page.waitForTimeout(50);
await page.screenshot({ path: `${OUT}/debug-05-full-layer.png` });
await page.evaluate(() => window.__game.hardDrop());
await page.waitForTimeout(80);
const cleared = await page.evaluate(() => window.__game.getState());
note(cleared.layers === 1, "消层计数更新", `layers=${cleared.layers}`);
note(cleared.score >= 600, "消层得分", `score=${cleared.score}`);
await page.screenshot({ path: `${OUT}/debug-06-after-clear.png` });

// Game over flow
await page.evaluate(() => {
  window.__game.reset();
  for (let y = 9; y < 12; y++)
    for (let z = 1; z < 5; z++)
      for (let x = 1; x < 5; x++) window.__game.setBoardCell(x, y, z, "T");
  window.__game.hardDrop();
});
await page.waitForTimeout(80);
const over = await page.evaluate(() => ({
  gameOver: window.__game.getState().gameOver,
  overlayHidden: document.querySelector("#gameOverlay").classList.contains("hidden"),
  status: document.querySelector("#statusText").textContent,
}));
note(over.gameOver && !over.overlayHidden, "游戏结束遮罩显示", over.status);
await page.screenshot({ path: `${OUT}/debug-07-gameover.png` });
await page.click("#restartButton");
await page.waitForTimeout(80);
const restarted = await page.evaluate(() => window.__game.getState());
note(!restarted.gameOver && restarted.score === 0, "重新开始可用");

// Mobile layout
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
const mobile = await page.evaluate(() => {
  const controls = document.querySelector(".mobile-controls");
  const style = getComputedStyle(controls);
  return {
    display: style.display,
    buttons: controls.querySelectorAll("button").length,
    canvas: document.querySelector("#gameCanvas canvas")?.getBoundingClientRect(),
  };
});
note(mobile.display !== "none", "移动端显示触控栏", `display=${mobile.display}`);
note(mobile.buttons === 6, "移动端 6 个按钮", `count=${mobile.buttons}`);
await page.screenshot({ path: `${OUT}/debug-08-mobile.png`, fullPage: true });

// Tap a mobile control
await page.click('.mobile-controls button[data-action="left"]');
await page.click('.mobile-controls button[data-action="rotate"]');
await page.waitForTimeout(100);
note(true, "移动端触控点击无异常");

// Inspect source for common logic smells via live state after many rotations near wall
await page.setViewportSize({ width: 1400, height: 900 });
await page.evaluate(() => window.__game.reset());
const wallKick = await page.evaluate(() => {
  // shove to left wall then try rotate many times
  for (let i = 0; i < 20; i++) window.__game.move(-1, 0, 0);
  const before = window.__game.getState().current;
  window.__game.rotate("yawLeft");
  window.__game.rotate("pitchForward");
  window.__game.rotate("rollRight");
  const after = window.__game.getState().current;
  const valid = after.cells.every(([x, y, z]) => {
    const bx = x + after.x, by = y + after.y, bz = z + after.z;
    return bx >= 0 && bx < 6 && by >= 0 && by < 12 && bz >= 0 && bz < 6;
  });
  return { beforeType: before.type, afterCells: after.cells.length, valid };
});
note(wallKick.valid && wallKick.afterCells === 4, "贴墙旋转不穿墙", JSON.stringify(wallKick));

await page.screenshot({ path: `${OUT}/debug-09-final.png` });

note(logs.errors.length === 0, "无控制台/页面错误", logs.errors.slice(0, 5).join(" | ") || "none");
if (logs.warnings.length) {
  console.log("WARNINGS:", logs.warnings.slice(0, 10));
}

await browser.close();

const bugs = findings.filter(f => !f.ok);
console.log(`\n结果: ${findings.length - bugs.length}/${findings.length} 通过`);
if (bugs.length) {
  console.log("发现问题:");
  for (const b of bugs) console.log(` - ${b.title}${b.detail ? `: ${b.detail}` : ""}`);
}
process.exit(bugs.length ? 1 : 0);
