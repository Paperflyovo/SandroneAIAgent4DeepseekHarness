# Sandrone Harness 工作规范

## 开始前

- 在仓库根目录执行命令，先运行 `pnpm run preflight`。
- 先查看 `git status --short`，保留已有用户改动。
- 读取源码和编译产物后再修改，不根据搜索失败猜测路径。
- PowerShell 使用仓库绝对路径时加单引号；读取大文件必须分段。

## 修改与验证

- 源码修改使用 `apply_patch`。
- UI 修改后运行 `pnpm run build:ui`，再运行 `pnpm run verify:ui-sync`。
- 至少运行目标契约测试和 `git diff --check`。
- 区分源码、`lib` bundle、DSH_HOME 部署副本和 Electron 运行进程；UI 问题先排查旧 bundle，不重复猜 CSS。

## Electron 验收

- 验收前确认 UI bundle 已重建、插件已部署、Harness 已重启、Electron 已加载新文件。
- Ctrl+R 是开发态快速重载；正式验收使用完整 Electron 重启。
- 不停止不属于本项目的 Node、浏览器或 Electron 进程。

## Git

- 只暂存本轮目标文件；不得把临时截图、浏览器 profile、`tmp/` 或用户无关文件提交。
- 提交前检查 `git diff --cached --stat` 和 `git status --short`。
- 只有用户明确要求时才 commit 或 push。
