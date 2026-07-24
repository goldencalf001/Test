# NEON STACK

一个使用 Three.js 构建的真三维俄罗斯方块（Blockout 风格）网页游戏：方块坠入 6×6×12 的立体深井，可绕三个轴旋转，填满整层即可消除。

## 本地运行

```bash
npm install
npm run dev
```

## 操作

- `←` / `→` / `↑` / `↓`：在水平面上移动方块
- `Q` / `E`：绕竖直轴旋转（水平旋转）
- `W` / `S`：绕左右轴翻转（前后翻转）
- `A` / `D`：绕前后轴翻转（侧向翻转）
- `Shift`：按住加速下落
- `Space`：瞬间落下
- `P` / `Esc`：暂停或继续

## 特性

- 6×6×12 立体井，整层填满消除（Blockout 规则）
- 8 种三维方块（tetracube），袋式随机
- 幽灵落点与底面投影辅助瞄准
- 下一块 3D 旋转预览、等级加速、本地最高分
- 响应式布局、触屏按钮、合成音效

## 测试

```bash
npm run build          # 构建
node tests/e2e.mjs     # Playwright 浏览器规则测试（需先 npx playwright install chromium）
```