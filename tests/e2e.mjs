// 3D 俄罗斯方块规则冒烟测试（Playwright + Chromium headless）
// 运行前提：dev 服务器已在 BASE_URL（默认 http://127.0.0.1:5173）运行
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:5173";
const results = [];

function check(name, condition, detail = "") {
  results.push({ name, pass: !!condition, detail });
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on("console", message => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", error => consoleErrors.push(String(error)));

await page.goto(BASE_URL, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__game && window.__game.getState().current);

const state = () => page.evaluate(() => window.__game.getState());

// 1. 初始状态：井尺寸、空棋盘、有当前块与下一块
{
  const s = await state();
  check("井尺寸为 6×12×6", s.size.x === 6 && s.size.y === 12 && s.size.z === 6);
  const filled = s.board.flat(2).filter(Boolean).length;
  check("开局棋盘为空", filled === 0, `已占用 ${filled}`);
  check("当前块含 4 个立方体", s.current.cells.length === 4);
  check("生成下一块预告", typeof s.nextType === "string" && s.nextType.length === 1);
  check("初始分数为 0", s.score === 0);
}

// 2. 重力：等待后 y 下降
{
  const before = await state();
  await page.waitForTimeout(1300);
  const after = await state();
  check("方块受重力自动下落", after.current.y < before.current.y,
    `y: ${before.current.y} → ${after.current.y}`);
}

// 3. 边界：持续左移不越界
{
  await page.evaluate(() => { for (let i = 0; i < 12; i++) window.__game.move(-1, 0, 0); });
  const s = await state();
  const minX = Math.min(...s.current.cells.map(c => c[0])) + s.current.x;
  check("左移被井壁阻挡（x ≥ 0）", minX === 0, `minX=${minX}`);
  await page.evaluate(() => { for (let i = 0; i < 12; i++) window.__game.move(0, 0, -1); });
  const s2 = await state();
  const minZ = Math.min(...s2.current.cells.map(c => c[2])) + s2.current.z;
  check("前移被井壁阻挡（z ≥ 0）", minZ === 0, `minZ=${minZ}`);
}

// 4. 三轴旋转：立方体数量不变且位置合法，旋转不跳位
{
  await page.evaluate(() => window.__game.reset());
  // 等一块落到较开阔位置
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) window.__game.move(0, -1, 0, true);
  });
  for (const axis of ["yawLeft", "pitchForward", "rollRight"]) {
    const before = await state();
    const beforeCentroid = before.current.cells.reduce(
      (acc, [x, y, z]) => [acc[0] + x + before.current.x, acc[1] + y + before.current.y, acc[2] + z + before.current.z],
      [0, 0, 0]
    ).map(v => v / 4);
    await page.evaluate(name => window.__game.rotate(name), axis);
    const s = await state();
    const afterCentroid = s.current.cells.reduce(
      (acc, [x, y, z]) => [acc[0] + x + s.current.x, acc[1] + y + s.current.y, acc[2] + z + s.current.z],
      [0, 0, 0]
    ).map(v => v / 4);
    const jump = Math.hypot(
      afterCentroid[0] - beforeCentroid[0],
      afterCentroid[1] - beforeCentroid[1],
      afterCentroid[2] - beforeCentroid[2]
    );
    const inBounds = s.current.cells.every(([x, y, z]) => {
      const bx = x + s.current.x, by = y + s.current.y, bz = z + s.current.z;
      return bx >= 0 && bx < 6 && by >= 0 && by < 12 && bz >= 0 && bz < 6;
    });
    check(`旋转 ${axis} 后仍为 4 格且在井内`, s.current.cells.length === 4 && inBounds);
    check(`旋转 ${axis} 不跳位（质心位移 < 0.75）`, jump < 0.75, `jump=${jump.toFixed(2)}`);
  }
}

// 5. 硬降：方块锁定到底部、得分增加、生成新块
{
  const before = await state();
  await page.evaluate(() => window.__game.hardDrop());
  const after = await state();
  const filled = after.board.flat(2).filter(Boolean).length;
  check("硬降后 4 格锁入棋盘", filled === 4, `已占用 ${filled}`);
  check("硬降按距离加分（2 分/格）", after.score > before.score,
    `${before.score} → ${after.score}`);
  check("硬降后生成新方块", !!after.current);
  const bottomTouch = after.board[0].flat().filter(Boolean).length;
  check("锁定块落在井底", bottomTouch > 0, `底层 ${bottomTouch} 格`);
}

// 6. 袋式随机：前 8 个方块类型互不重复
{
  await page.evaluate(() => window.__game.reset());
  const seen = await page.evaluate(async () => {
    const types = [];
    const offsets = [[-3, -3], [0, -3], [3, -3], [-3, 3], [0, 3], [3, 3], [-3, 0], [3, 0]];
    for (let i = 0; i < 8; i++) {
      const s = window.__game.getState();
      types.push(s.current.type);
      const [dx, dz] = offsets[i];
      for (let k = 0; k < Math.abs(dx); k++) window.__game.move(Math.sign(dx), 0, 0);
      for (let k = 0; k < Math.abs(dz); k++) window.__game.move(0, 0, Math.sign(dz));
      window.__game.hardDrop();
      if (window.__game.getState().gameOver) break;
    }
    return types;
  });
  check("袋式随机：前 8 块类型互不重复", new Set(seen).size === 8, seen.join(","));
}

// 7. 整层消除：填满底层后锁定触发消层与计分
{
  await page.evaluate(() => window.__game.reset());
  const before = await state();
  await page.evaluate(() => {
    for (let z = 0; z < 6; z++) for (let x = 0; x < 6; x++) window.__game.setBoardCell(x, 0, z, "I");
  });
  await page.evaluate(() => window.__game.hardDrop());
  const after = await state();
  check("填满整层后被消除", after.layers === 1, `layers=${after.layers}`);
  check("消层计分（≥600）", after.score - before.score >= 600, `+${after.score - before.score}`);
  const bottomCount = after.board[0].flat().filter(Boolean).length;
  check("消层后上方方块下移", bottomCount > 0 && bottomCount <= 4, `底层 ${bottomCount} 格`);
}

// 8. 暂停：重力停止
{
  await page.evaluate(() => window.__game.reset());
  await page.evaluate(() => window.__game.togglePause());
  const before = await state();
  await page.waitForTimeout(1500);
  const after = await state();
  check("暂停后方块停止下落", after.current.y === before.current.y && after.paused);
  await page.evaluate(() => window.__game.togglePause());
}

// 9. 顶部堵塞触发游戏结束
{
  await page.evaluate(() => window.__game.reset());
  await page.evaluate(() => {
    for (let y = 9; y < 12; y++)
      for (let z = 1; z < 5; z++)
        for (let x = 1; x < 5; x++) window.__game.setBoardCell(x, y, z, "T");
  });
  await page.evaluate(() => window.__game.hardDrop());
  const s = await state();
  check("出生点被堵塞时判定游戏结束", s.gameOver === true);
  const overlayHidden = await page.$eval("#gameOverlay", el => el.classList.contains("hidden"));
  check("游戏结束界面显示", overlayHidden === false);
}

// 10. 重新开始按钮
{
  await page.click("#restartButton");
  const s = await state();
  check("重新开始后棋盘清空", s.board.flat(2).filter(Boolean).length === 0 && !s.gameOver && s.score === 0);
}

check("页面无 JS 报错", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await page.screenshot({ path: "/tmp/neon-stack-3d.png" });
await browser.close();

const failed = results.filter(result => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
process.exit(failed.length ? 1 : 0);
