# Sandrone Harness 与官方 DeepSeek Harness 桌面端对比评审

评审日期：2026-09-29
对比基准：本机安装的官方桌面版 `E:\DeepSeekHarness`（应用 `@deepseek-ai/dsh-desktop@0.2.0-rc.2`，Electron 44.0.0）
评审对象：本仓库 `sandrone-harness`（`26.9.12`，锁定 `@deepseek-ai/dsh@0.1.5-rc.1`，工作树含未提交的 0.1.1→0.1.5 升级）

标注约定：**「实测」**表示本次评审在本机实际运行代码复现；**「对照」**表示直接读取官方实现得出；**「判断」**表示分析结论，存在估计成分。

---

## 0. 结论摘要

Sandrone 的承载层工程质量高于它的版本处境。真正的问题不是「代码写得差」，而是三件事：

1. **有 2 个会伤到用户的确定性缺陷**（均本次实测复现：隐藏条目清空文件夹列表、空间笔记存在安装目录导致换路径升级即丢失），优先级高于任何架构讨论。另有 3 处纵深防御型加固（§2.1、§3 的 QA 后门与文件 mode），值得修但不紧急。
2. **版本落后一代，而且落后的那一代刚好提供了官方插件管理器**——当前 51 个上游包在本地完全不存在，其中包含 `dsh-plugin-manager`、`dsh-client-ui-plugin-manager` 等一整套官方插件/技能管理能力。Sandrone 为此手写了 `extensions-config.cjs`（261 行）来做同一件事。
3. **有一条注定打不赢的战线**：为「让未声明图像能力的模型也能收图」维护了 4 个上游补丁，而上游在 `0.2.0-rc.2` 不但保留了全部原逻辑，还在 `dsh-acp`、`dsh-mcp-client`、DeepSeek Messages 适配器**新增了 3 处同类门禁**。补丁数只会随上游增长。

同时必须先说清楚：**官方桌面端不可能被追平，也不需要被追平**。官方 1,015 MB 安装量里含 89 MB Node + 18 MB pnpm + 165 MB Python，有企业代码签名、nightly 更新通道、账号体系、欢迎引导窗、托盘、强制更新。这些是团队资源，不是个人项目该竞争的维度。Sandrone 真正独有、且官方没有的是：**暖纸张与墨色的视觉体系、空间区（本地 Markdown 工作台）、Buddy 陪伴角色**。建议把全部精力压在这三样上，其余尽量交还上游。

---

## 1. 官方 vs Sandrone 对比

| 维度 | 官方 `0.2.0-rc.2` | Sandrone `26.9.12` | 差距 |
|---|---|---|---|
| 上游版本 | `0.2.0-rc.2`（287 个 `@deepseek-ai/dsh*` 依赖） | `0.1.5-rc.1`（本地 246 个包） | **严重**：51 个包本地不存在 |
| 代码签名 | 已签名且有效 `CN=Hangzhou DeepSeek Artificial Intelligence Co., Ltd.` | 未签名（`CSC_IDENTITY_AUTO_DISCOVERY=false`） | 严重（受成本约束） |
| 更新机制 | `electron-updater` + generic feed + `nightly` 频道 + `publisherName` 签名校验 | 手写 `update-service.cjs`（482 行）：GitHub Releases + SHA-256 | 严重 |
| asar | `asar: true`，12,967 个文件，**每个文件带 SHA-256 完整性条目** | `asar: false`，`resources/app` 为裸目录，16,497 文件 / 825 MB | 严重 |
| 捆绑运行时 | Node 24 + pnpm 11.7 + **CPython 3.12.14** + 12 个 Python 包 | 仅复用 Electron 自带 Node，无 Python | 严重（Python 能力缺失） |
| Office 技能 | 自带 `office-docx/pptx/xlsx` + `dsh-skill-office` + LibreOffice kit | 无 | 严重（能力缺失） |
| 数据目录 | `DSH_HOME=~/.dsh`，与官方 CLI 互通 | `%APPDATA%\Sandrone AI Agent\DeepSeekHarness` | 中等 |
| 退出安全 | 退出前经 IPC 询问 host「是否有进行中的任务 / 已排程提醒」，有则先问用户 | 直接停 supervisor，进行中的回合被中断且无提示 | 中等偏高 |
| 首次引导 | `welcome.html` + 内置 Montserrat 品牌字体 + 账号登录页 | 仅 `loading.html` 加载页 | 中等 |
| 窗口壳 | `titleBarStyle:'hidden'` + `titleBarOverlay`（保留原生按钮与 Snap Layouts）；欢迎窗用 `backgroundMaterial:'acrylic'` | `frame:false` + 自绘按钮；无窗口材质 | 中等 |
| 托盘 | 有（`tray.ico`，关窗后可恢复） | 无（关窗即退出） | 中等 |
| 最小窗口 | `520×600` | `900×620` | 低 |
| 承载进程 | Electron 壳 + 私有 `dsh-desktop-host`（Node 模式 host 进程，含 office/账户/退出检查/更新锁） | Electron 壳 + `harness-runner.mjs` 直接跑官方 `dsh web` CLI | 架构代差（见 §4） |
| 制品溯源 | `package.json` 内嵌 `dshBuildCommit` / `dshBuildDirty` | 产物内无任何 commit / 上游版本信息 | 中等 |
| 补丁负担 | — | 10 个补丁 / 8 个包 / 156 行改动 | 见 §5 |

---

## 2. 必修缺陷（P0）

### 2.1 空间资源导入缺少第二道校验（纵深防御，**已更正**）

> **更正说明（同日）**：本节初稿把这一条写成「可读取任意本机文件」的严重漏洞，那是错的，我在此更正。
> 初次的验证脚本直接调用了模块函数，**跳过了 preload**。而渲染进程根本递不进一个自选路径：`preload.cjs:60` 用的是
> `webUtils.getPathForFile(file)`，Electron 官方类型文档写得很明确——*「In the case where the File object passed in was
> constructed in JS and is not backed by a file on disk an empty string is returned.」* 也就是说，只有用户**真的**通过
> 选择/拖拽/粘贴交出来的文件才会得到非空路径，JS 构造的 `File` 只会拿到空串，随后被 `path.isAbsolute('')` 挡掉。
> 所以这条**不是可利用的漏洞**，而是「安全目前完全依赖 preload 的那一次调用」的纵深防御缺口。

问题本身仍然成立。`apps/desktop/lib/space-store.cjs:324` 的 `copyResource` 只校验「是字符串且是绝对路径」：

```js
function copyResource(root, id, sourcePath) {
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) throw new Error('Resource source must be absolute')
  const source = fs.realpathSync(sourcePath)   // ← 没有任何授权根校验
  ...
  atomicWrite(target, fs.readFileSync(source))
```

实测（本机运行真实模块，绕过 preload 直接调函数）：

```
A) 把系统临时目录下的文件路径传进去
   B1 copy of outside file  = {"path":"sandrone-secret-7848.txt","size":21}
   B2 read-back contents    = "TOP-SECRET-CREDENTIAL"
C) 对照组：readResource 传入 ../../ 被正确拒绝
   C1 traversal read rejected = "Resource path escapes its root"
```

**为什么仍然值得修**：`main.cjs:212` 的 `dshHome()` 下就是 `DeepSeekHarness/.credentials.yaml`（明文 API Key）。
今天唯一挡住它的是 preload 里那一行 `getPathForFile`——它是一次**隐式**保证，没有测试守着。任何一次重构
（改 preload 签名、新增一个调用方、写个脚本直接 require 这个模块）都会在无人察觉的情况下把它变回真漏洞。

**已采用的修复**：`copyResource` 现在接受 `protectedRoots`，拒绝源路径落在应用自身数据内（`userData` 与 `~/.dsh`），
并在 `realpathSync` **之后**比对，所以指向这些目录的符号链接同样被拦下。拖拽普通文件不受影响。
测试见 `tests/space-store.test.mjs`（含符号链接用例与「普通文件仍可导入」的反向断言）。

**尚可更进一步**（未做，属架构项）：把附件/资源一律改走官方 Harness 的 attachment 服务，这个自研 IPC 通道就可以整体删掉。

### 2.2 单个隐藏条目会清空整个文件夹列表（**实测**）

`apps/desktop/lib/space-store.cjs:110`，`listDirectories` 把「跳过隐藏项」写成了 `break`：

```js
if (output.length >= limit || entry.name.startsWith('.')) break   // ← 应为 continue
```

对比同文件 `:96` 的 `listFiles` 用的是正确的 `continue`。实测：

```
A1 folders with no dot-entry     = ["alpha","zeta"]
A2 folders after adding md/.git/ = []          ← 整个列表被清空
```

只要 `md/` 下出现 `.git/`（Agent 在该目录跑过 `git init` 就会）或任意隐藏文件，空间面板的文件夹树就整个消失，而文档列表不受影响——表现为「文档还在、文件夹没了」，极难排查。

**修复**：`break` 改 `continue`。

### 2.3 空间笔记存在安装目录，换路径升级即丢失

`apps/desktop/main.cjs:215-221`：`app.isPackaged` 时 `space/` 落在 `path.dirname(app.getPath('exe'))`，即**程序安装目录**。而 `apps/desktop/electron-builder.windows.yml:16` 开着 `allowToChangeInstallationDirectory: true`。

用户升级时选了新路径 → 新目录 `space/` 为空 → 笔记与导入的图片全部「消失」（实际还在旧目录，但应用不再指向它），且代码里**没有任何迁移逻辑**。`deleteAppDataOnUninstall: false` 保护的是 userData，恰好保护不到 `space/`。README 只用一句「安装版若安装目录没有写权限，应改用可写的安装位置」把风险转给用户。

**修复**：默认改到 `app.getPath('userData')/space` 或 `文档/Sandrone/space`，并加一次性迁移（旧位置存在且有内容时 `cpSync` 过来）。

### 2.4 `asar: false`（**对照 + 实测**）

`apps/desktop/electron-builder.yml:3`。实测产物 `release/win-unpacked/resources/app/` = **16,497 文件 / 825 MB 裸目录**，其中 `node_modules` 16,450 文件 / 437 MB。官方同规模内容压在单个 121 MB 的 `app.asar` 里，且每个文件带 SHA-256 完整性条目。

最要紧的不是启动 I/O 或安装体积，而是**防篡改归零**：`resources/app/apps/desktop/main.cjs` 正是 `package.json` 的 `main`，任何本地进程改一行即可让下次启动以完整权限执行任意代码——`ipc-policy.cjs`、`workspace-browser.cjs`、`navigation-policy.cjs` 这些写得很扎实的纵深防御，全部以此为前提。

**官方是怎么解决 asar 与原生模块冲突的**（`dsh-desktop-host/lib/index.js:40-60`）：它没有关掉 asar，而是注册了一个模块解析钩子，把 `@deepseek-ai/libreoffice-kit-*` 从 `app.asar` 内重定向到 `app.asar.unpacked`，并强制校验解析结果不逃出运行时目录。**这正是 Sandrone 关掉 asar 想绕开的问题，官方给出的是正解。**

**修复**：`asar: true` + `asarUnpack`（`node-pty` 预编译、`sharp`、`koffi`），必要时照抄上面的解析钩子思路。注意 `apps/desktop/lib/deploy-runtime-package.cjs:37` 用 `fs.symlinkSync` 指向 `resources/app/packages/sandrone-image-tools`，asar 化后该路径不存在，**必须同步改**。

### 2.5 退出时不检查进行中的任务（**对照**）

官方 host 暴露一个 `quit-inspection` IPC，返回 `{ activeTasks, scheduledTasks }`——`activeTasks` 覆盖「正在生成的 agent、正在跑的工具、排队中的 inbox 消息、运行中的后台 job」，`scheduledTasks` 覆盖已排程提醒；官方 `lib/main.js` 的注释写明「the shell then asks before quitting」。

Sandrone 的 `apps/desktop/lib/quit-coordinator.cjs` 只有 30 行，`shutdown` → `finish`，不看任何任务状态；`main.cjs:933` 的 `shutdown` 只做 `supervisor.stop()`。**用户在 Agent 正在回答时关窗，回合被直接掐断且没有任何警告。**

**修复**：退出前查询进行中任务（走官方 `connection` 的会话/任务面），有活动则弹确认框；顺带解决「关窗即退出」的问题（官方有托盘，关窗只是隐藏）。

### 2.6 README 说「不需要 Python」，但确实没有 Python 和 Office 能力

`README.md:28` 与 `sandrone-harness/README.md:38` 都写「启动应用无需另装 Node.js、pnpm、Python」。对照官方 `resources/runtime/primary-runtime/runtime.json`：`python: 3.12.14` + `numpy/pandas/python-docx/python-pptx/openpyxl/Pillow/lxml/XlsxWriter`，外加 `runtime/office-skills/{office-docx,office-pptx,office-xlsx}`。

Sandrone 侧对 Python / Office 关键字全仓 grep **零命中**，`skills/` 只有 3 个纯文本技能。后果：用户被文档告知不必装 Python，一旦让 Agent 生成 Word/Excel/PPT，在干净机器上直接 `python is not recognized`，而且会被误当成「模型能力不行」。

**修复（短期，10 分钟）**：改文档，明确写「内置 Electron/Node 与 Harness；**不含 Python 与 Office 文档技能**」。
**修复（中期）**：官方 `runtime/bin/node`+`node.cmd` 与 `cli/bin/dsh.cmd` 的思路值得照抄——用 shim 把工具挂进子进程 PATH（见 §6）。

---

## 3. 应该修的问题（P1）

| 问题 | 位置 | 说明 |
|---|---|---|
| QA 后门在生产包同样生效 | `main.cjs:837` | `SANDRONE_QA_PICK_DIRECTORY` 命中即把目录**永久**登记为本地图片授权根，绕开 `dialog.showOpenDialog`。危害有限（需先能设置该进程的环境变量，而这样的本机访问者能做的事更多），但加 `!app.isPackaged` 门控是一行的事。 |
| `target="_blank"` 链接点了没反应 | `client.jsx:979` | 更新面板「打开 GitHub 发布页」用 `target="_blank"`；`setWindowOpenHandler`（`main.cjs:451`）一律 `deny` 并改发 `desktop:web-navigation`，但 `packages/sandrone-ui/src` 里**没有任何地方监听** `onWebNavigation`。 |
| 退出杀不掉 Windows 进程树 | `harness-supervisor.cjs:262-279` | `child.kill()` 只终止被 fork 的 Node 进程本身，杀不掉 `dsh web` 再派生的工具/PTY 子进程；超时强杀后也不校验是否真的退出。建议 Job Object 或 `taskkill /T /F` 兜底。 |
| 「完整重启 Electron」绕过退出协调 | `main.cjs:383-387` | `app.relaunch(); app.exit(0)` 不走 `quitCoordinator`，等于主动制造孤儿 `dsh`。改走 `app.quit()`。 |
| 渲染进程能弹出含特权项的应用菜单 | `main.cjs:636` → `:531` | 渲染进程调 `showApplicationMenu('view')` 就能弹出「刷新界面（重建 UI）」，开发态会 fork 完整 UI 构建。`reloadUi`（`:359`）没有 `app.isPackaged` 门控，而它旁边那条有。 |
| 启动失败用户什么都看不到 | `main.cjs:986-988` | `whenReady().catch` 只 `console.error`。若 `createWindow()` 或 `packageBin`/`deployPlugin` 抛错，**窗口从未创建**，用户双击图标后「没反应」，进程还在后台。应 `dialog.showErrorBox` + `app.quit()`。 |
| 缺 `unhandledRejection` / `child-process-gone` | 全目录零命中 | 多处 `void ...` 是发射后不管；`dsh` 子进程被系统或杀软杀死时没有任何结构化记录。 |
| 升级备份无上限、版本常量未绑定 | `upgrade-backup.cjs:6` | `TARGET_VERSION = '0.1.5-rc.1'` 与 `package.json` 的 `26.9.12` 无任何断言绑定；旧备份目录永不清理，`userData` 会持续膨胀。 |
| `SHA256SUMS.txt` 已过期，且 CI 从不生成 | `release/SHA256SUMS.txt` | 文件 mtime 2026-09-12，对应安装包 mtime 2026-09-27 —— 哈希与文件已不同步。README 却把它当作唯一校验手段。**过期的校验和比没有更危险。** |
| 打包进 262.6 MB 非目标平台二进制 | 产物实测 | 24 个 `@img/sharp-*` / `libvips` 平台包 + 13 个 `@vscode/ripgrep-*`，约 1/3 体积永不执行。`files` 加 `!node_modules/@img/sharp-{darwin,linux,...}-*/**` 这类负向排除即可。 |
| 55 个 Electron locale 全打包 | 产物实测 | 与官方一样是 55 个 `.pak`，而 Sandrone UI 是中文。`electronLanguages: [zh-CN, en-US]`。 |
| `DSH_HOME` 与官方 CLI 不互通 | `main.cjs:211-213` | 落在 `%APPDATA%\Sandrone AI Agent\DeepSeekHarness`，官方 CLI 与官方桌面读 `~/.dsh`。装过 `dsh` 的用户打开 Sandrone 会看到全新空空间并要重填 API Key；反之亦然。`upgrade-backup.cjs` 也只备份 Sandrone 自己的目录。**建议只隔离 `profiles/` 与 patch，把 `DSH_HOME` 交还官方约定**（或在首启检测到 `~/.dsh` 有数据时询问用户）。 |
| 密钥落盘 mode 不一致 | `extensions-config.cjs:202` | `writeExtensionsConfig` 写了 `mode: 0o600`，但 `writeExtensionsPatch` 没写——而后者会把 MCP 的 `env`（`GITHUB_TOKEN` 之类）以明文 YAML 落盘。补一行即可。 |
| 截图链路同步写最多 64 MB | `main.cjs:107-124` | 主进程是 UI 线程，同步写大文件会卡窗口。改 `await fsp.writeFile` 即可，`screenshotInFlight` 已保证串行。 |
| `space/` 未被 gitignore | 根 `.gitignore` | `git check-ignore -v sandrone-harness/space/test/space.json` 返回**未忽略**，而该目录下就是用户笔记与导入资源。这是当前唯一会误提交用户数据的地方。 |

**三条我核查后判定不成立或已降级**，不要花时间去追：

- ~~「重启预算耗尽后 `restart()` 永不 settle，加载页按钮永久空转」~~：我用真实 supervisor + 必然失败的 child 连跑三轮 `restart()`，**每次都正常 reject**（`DeepSeek Harness exited before readiness`），并且 `phase` 正确变为 `failed` 让加载页显示错误与重试按钮。
- ~~「macOS 重开窗口后 IPC 全灭」~~：`main.cjs:621` 的 `assertTrusted` 是闭包读取**调用时**的模块级 `mainWindow`，不是捕获旧值，所以新窗口的 IPC 正常。
- ~~「空间资源导入可读取任意本机文件」~~：降级为纵深防御缺口，理由见 §2.1 的更正说明——preload 的 `webUtils.getPathForFile` 使渲染进程无法自选路径。

结论：不存在的 bug 不要改。

### 本轮已实施的修改

| 文件 | 改动 |
|---|---|
| `apps/desktop/lib/space-store.cjs` | `listDirectories` 的 `break`→`continue`；`copyResource` 新增 `protectedRoots`（`realpathSync` 之后比对，含符号链接）；新增 `listSpaceIds` / `migrateSpaceRoot` |
| `apps/desktop/main.cjs` | `spaceRootPath()` 打包后改指 `userData/space`；新增 `previousSpaceRootPath()` / `protectedResourceRoots()` / `migrateSpaceData()`；启动时执行一次性迁移；两处 `copyResource` 传入受保护根；`pick-directory` 的 QA 覆盖加 `!app.isPackaged` 门控 |
| `apps/desktop/lib/extensions-config.cjs` | `writeExtensionsPatch` 补 `mode: 0o600` |
| `.gitignore` | 新增 `sandrone-harness/space/` |
| `packages/sandrone-ui/src/client.jsx` | 空间空态文案改为「本机用户数据目录」（已重建 `lib` bundle） |
| `README.md` / `sandrone-harness/README.md` | 空间数据位置与迁移说明同步更新 |
| `tests/space-store.test.mjs` | 新增 4 个测试：隐藏条目不截断文件夹列表、受保护根被拒（含符号链接与反向断言）、迁移只执行一次且不删源、空源为 no-op |

验证：`pnpm test` 121/121 通过（含新增 4 条）；`build:ui` + `verify:ui-sync`、`verify:architecture`、`verify:upstream`、`verify:skill`、`git diff --check` 全部通过。

---

## 4. 架构代差：让太多东西住进了 main 进程（P2）

官方与 Sandrone 在「谁负责什么」上分法不同（**对照**官方私有包 `@deepseek-ai/dsh-desktop-host`，仅 5.3 KB + 13.8 KB）：

- **官方**：Electron 壳只管窗口/托盘/更新/引导/账号/权限策略；真正的 Harness 运行时在**独立 Node 模式 host 进程**里，用 `@deepseek-ai/dsh-app-boot` + `profile-boot` + `dsh-host-webserver` 起 profile，通过一个**小而类型化**的 IPC 协议与壳通信（`ready` / `fatal` / `shutdown-complete` / `quit-inspection` / `update-tasks` / `platform-session`）。
- **Sandrone**：`main.cjs` 1,004 行 + `lib/` 16 个模块，其中 `space-store.cjs` 16.5 KB、`update-service.cjs` 20.7 KB、`extensions-config.cjs` 9.7 KB，并通过 `preload.cjs` 暴露约 **50 个 IPC 通道**（仅空间区就 20 多个）。也就是说，**Sandrone 的 Electron main 进程比官方那个 host 插件更大，却在做更多与桌面壳无关的产品功能**。

两个具体后果：

1. **空间区本该是 Host 插件而不是 Electron 功能。** 它现在自己实现路径校验（`space-store.cjs`）、自己走 IPC 传字节。若改成 Harness Host 插件、走 `ctx.fs` 与 workspace 抽象，会免费获得权限检查、沙箱与可观测性，并能删掉 16.5 KB 的路径代码与 20 多个 IPC 通道。
2. **`dsh/profile-boot` 从 `0.2.0-rc.2` 起是公开子路径导出**（已 `npm view` 核实：`"./profile-boot"` 存在；`0.1.5-rc.1` 的 `@deepseek-ai/dsh` **没有 `exports` 字段**，所以当时只能靠 CLI）。升级到 0.2.x 后可以**在进程内 boot profile**、用 `ctx.connection.authenticatedUrl()` 拿带 token 的 URL，从而摆脱「正则解析 stdout 就绪行 + 依赖 CLI flag 稳定性」这条脆弱链路。`harness-supervisor.cjs` 的 generation/重启预算设计本身是好的，可以保留外壳、换掉探测方式。

**另外**：官方把 `dsh` CLI 挂进了 Agent 的 PATH（`runtime/cli/bin/dsh.cmd` → `ELECTRON_RUN_AS_NODE` 跑 `dsh-desktop-host/lib/cli.js`），并为 Node 做了同款 shim（`runtime/bin/node` / `node.cmd`，设 `ELECTRON_RUN_AS_NODE=1` 后 exec 同一个可执行文件）。Sandrone 两者都没有，所以在 Sandrone 会话里 Agent 既没有 `node` 也没有 `dsh`。

值得说明的是：官方对用户 PATH 的处理（`runtime/cli/command-path.ps1`，150 行，带互斥锁、注册表归属记录、指纹校验、ESTALE 检测、环境广播）**不建议个人项目照抄**——那是对系统级副作用的过度工程。**更安全的等价做法**：只在传给 Harness 子进程的 `env.PATH` 前面插入一个 shim 目录（`main.cjs:320-326` 已经在构造这个 env），不碰注册表、不碰用户 PATH，完全可逆。

---

## 5. 维护负担：补丁与版本（P2）

### 5.1 现状

10 个补丁 / 8 个上游包 / 合计 **156 行**真实改动，按「存在理由」分类：

| 存在理由 | 数量 | 说明 |
|---|---|---|
| 修上游 bug / 门禁过严 | 5 | 图像准入 4 连（`api-session-controller`、`tool-fs`、`llm-pi-ai`、`llm-deepseek`）+ `localPathMediaUrl` 不认 Windows 路径 |
| 加能力 | 2 | 预设里插 image-tools；open-in-app 换槽位 |
| 纯偏好 | 3 | `sdk-minimal` 改一句给模型看的说明文字；`agent-presets/minimal` 文案；`open-in-app` 的 `align`/`autoFocus` |
| 迁移旧数据 | 1 | `session-format-v0-to-v1` 容忍 `origin` 字段 |
| **能用公开扩展点替代** | **0** | — |

`dsh-client-ui-chat` 一个补丁占 64 行（41%），是分支/`forkAt` 的草稿交接重写，全是私有内部状态，**没有公开扩展点**。

### 5.2 版本才是真问题

- 官方桌面 `0.2.0-rc.2` 有 **287** 个 `@deepseek-ai/dsh*` 直接依赖；Sandrone 本地 **246** 个包，**51 个完全不存在**，其中包括 `dsh-plugin-manager`、`dsh-client-ui-plugin-manager`、`dsh-client-ui-settings-plugins`、`dsh-host-plugin-inventory`——**官方插件管理面板已是公开包**。Sandrone 现在手写 `extensions-config.cjs` 来做同一件事。
- `@deepseek-ai/dsh-agent-presets` 这个名字 **在 0.2.0 已不存在**（只发到 `0.1.6-alpha.2`），被 `dsh-agent-preset` + `dsh-agent-preset-registry` 取代 → 补丁文件、`pnpm-workspace.yaml` 声明、`verify-upstream.mjs` 三处都要重写。
- 会话迁移链已到 **V4**（`v1-to-v2`、`v2-to-v3`、`v3-to-v4`），而补丁打在 V0→V1 上。
- **「等上游修好」不是可行策略**：直接 grep `0.2.0-rc.2` 的实际代码，`assertImageCapableRoute`、`DEFAULT_INPUT = ["text"]`、`.default(["text"])`、`disposition(["preset"])`、POSIX-only 的 `localPathMediaUrl` **全部原样保留**；图像门禁还**新增了 3 处**。唯一「已经好了一半」的是 open-in-app 的槽位（0.2.0 自己已经注册到 `header.actions`，补丁的主要动机消失）。
- `npm view` 提醒：这些包的 `dist-tags.latest` **不是** `0.2.0-rc.2`（`plugin-manager` 的 latest 停在 `0.1.6-alpha.2`），所以**必须显式指定版本号**，不能靠 `latest` 拉齐版本族。

### 5.3 建议的策略

**P0：立刻做**
1. **功能冻结**：在 `docs/architecture.md` 的 *Deliberate non-goals* 旁边加一节 *Feature freeze*——「版本族追平 0.2.x 之前，不接受任何需要新补丁的功能」。当前工作树那轮 0.1.1→0.1.5 升级改了 ~41 个文件、`pnpm-lock.yaml` ±9830 行，「大跳 + 顺手加功能」是最贵的模式。
2. **删掉纯文案补丁**：`patches/@deepseek-ai__dsh-sdk-minimal@0.1.5-rc.1.patch`（2 行，只改了一句给模型看的英文说明，不改变任何执行行为）及其在 `pnpm-workspace.yaml` 的声明、`verify-upstream.mjs` 的规则、测试里的引用。顺手删掉 `agent-presets` 补丁里 `presets/minimal` 的文案改动。**零功能损失。**
3. **给补丁加「存在理由」头注释并做成硬门**：每个补丁头部写 `# reason: upstream-bug | capability | preference | migration`、`# upstream-issue:`、`# last-verified:`；在 `verify-upstream.mjs` 里加一条「每个 `patchedDependencies` 必须有 reason，且 `preference` 类不得超过 N 个」。这不减少工作量，但让「该不该加第 11 个补丁」变成有门槛的决定——单人项目最缺的就是这个刹车。
4. **补丁预算上限设 4 个**：超过就必须三选一——上游提 issue/PR、放弃该功能、或改做自有 profile/预设/插件。按上面清单，删掉 `sdk-minimal`、`agent-presets` 文案、`open-in-app`（0.2.0 上）、待验证的 `model-selection` 后可压到 6 个以内。

**P1：把「跳版本」从大手术变成例行小步**

5. `pnpm-workspace.yaml` 的 `patchedDependencies` 把补丁绑死在 `@0.1.5-rc.1`，而 `.pnpmfile.cjs:3` 已把全族版本收敛到**一个常量**——这是很好的设计。**升版应当是「改一个常量 + 重新生成 N 个补丁」**，而不是改 41 个文件。加 `scripts/refresh-upstream-patches.mjs` 固化这个流程；节奏定在**每个上游 rc 边界一次、间隔 ≤ 2 周**，绝不跨越 2 个 rc。
6. **建「金丝雀」而不是「断言脚本」**：新增 `scripts/canary-upstream.mjs`，只做三件真事——(a) 用候选版本装一套隔离 `DSH_HOME`；(b) 跑 `tests/session-migration.test.mjs` + `tests/deepseek-image-routing.test.mjs` + `tests/image-admission.test.mjs` 的行为用例；(c) 冷启动一次 `dsh web`。同时把 `verify-upstream.mjs:9-53` 那 24 条「补丁里必须存在某字符串」的断言**降级为警告**——它等于把补丁内容抄了一遍，对「上游是否还兼容」零信息量。
7. **区分真门与自检门**：真正防上游破坏的只有 `session-migration.test.mjs`、`deepseek-image-routing.test.mjs` 和 `image-admission.test.mjs` 的行为部分。而 `tests/ui-bundle-contract.test.mjs`（298 行，逐字锁 CSS 像素值、颜色、精确调用次数）与 `tests/desktop-boundaries.test.mjs`（用源码文本正则 + `indexOf` 顺序断言）在每次上游升级时产生大量红点，**会掩盖真正的上游失败**。建议把这些降级到单独的 `pnpm run test:selfcheck`，不要混在 `pnpm test` 里。

**P2：向上游出手（一次性投入，长期收益最大）**

8. 把两件上游自己能修的事提 issue/PR：`dsh-llm-deepseek` 的 `inputModalities` `.default(["text"])` 把「省略」物化成「text」；`dsh-session-format-v0-to-v1` 的 `disposition(["preset"])` 拒绝额外的 `origin` 字段（Sandrone 已本地迁移过 36 份真实会话，说明这是真实用户数据）。**这是唯一有机会把 4 个图像门禁补丁里的 2 个变成 0 的路径。** 补丁文件里直接写上 issue 链接，让「等上游」变成可追踪事项。

**明确可以整块丢弃的**
- 全部纯文案改动（`sdk-minimal` 补丁、`agent-presets` 的 minimal 描述、`open-in-app` 的 `align/autoFocus/显示应用名`）。
- 「改压缩产物」这条思路：旧的 `dsh-web-frontend` 补丁改的是带内容哈希的 `dist/assets/index-ClqxG24t.js`，文件名一变就废。**永远不要再做。**
- `scripts/` 下 9 个 `probe-*.mjs` / `verify-model-picker*.mjs` / `verify-buddy-fix.mjs` 类历史排查脚本：从命名与体量看是一次性工具，建议移进 `scripts/archive/`（**未逐个读取内容，属基于文件名的判断**）。
- `sandrone-harness/sandrone-harness/runtime/dev-data/` 这份嵌套残留（内容只有 dev-data），直接删除。

---

## 6. 可以低成本「抄」官方的地方

按「改动量 ÷ 用户感知」排序：

1. **用 profile 关掉官方品牌插件，而不是用 CSS 藏它**（直接解决 todolist 第 8 条「启动时 SVG 仍未更改」）。
   官方 bundle（`@deepseek-ai/dsh-web-app/cordis.patch.yml`）里品牌由插件提供，注释原文是 *"Official occupants for the generic sidebar and conversation brand slots"*：
   ```yaml
   - id: ui-brand-official
     name: '@deepseek-ai/dsh-client-ui-brand-official'
   ```
   在 `profiles/sandrone-desktop.patch.yml` / `sandrone-web.patch.yml` 里加 `- id: ui-brand-official` + `disabled: true`，再 insert 自己的品牌占位——**官方 logo 从头就不渲染，没有可藏的东西，也就没有闪烁**。目前 `client.css:141-238` 用 `[class*="brand"]` + `::before`/`::after` 硬藏，是一条注定随上游 DOM 漂移的路线。
2. **`titleBarStyle: 'hidden'` + `titleBarOverlay` 取代 `frame: false`**（`main.cjs:580`）：官方 `lib/main.js` 就是这么做的，保留原生最小化/最大化/关闭按钮，从而**找回 Windows 11 的 Snap Layouts（悬停最大化按钮的分屏浮出）**——`frame:false` + 自绘按钮是拿不到这个的。Sandrone 想保留自绘外观的话，`titleBarOverlay` 允许 `color`/`symbolColor`/`height` 定制。
3. **窗口材质**：官方 Windows 用 `titleBarOverlay` + 欢迎窗 `backgroundMaterial: 'acrylic'`，macOS 用 `vibrancy: 'menu'`，并配一份 `window-material.css` 用 `--dsw-desktop-window-tint` 处理明暗前景色。这是「产品感」差距里最便宜的一项。
4. **`minWidth: 900` → `520`**（`main.cjs:577`）：官方是 `520×600`。900 意味着分屏/窄窗下应用不可用。
5. **`backgroundColor` 跟随主题**（`main.cjs:583` 硬编码 `#f5f2ec`）：暗色用户启动时会看到一次亮色闪白。官方用 `#00000000` 交给材质。
6. **托盘**：官方有 `tray.ico` 与「关闭窗口后可从托盘恢复」。加上托盘后，「关窗」不再等于「杀掉正在运行的 Agent」，与 §2.5 的退出检查配套。
7. **`backgroundThrottling: false`**（`main.cjs:589`）值得重新权衡：它让窗口最小化/被遮挡时渲染进程仍全速运行，代价是 CPU 与电池。若为流式输出需要，可只在会话进行中临时放开。另外 `setVisualZoomLevelLimits(1, 1)`（`main.cjs:596`）彻底禁用了缩放——**这是可访问性退步**（需要放大字号的用户没办法）。更该做的是修掉会被触发的移动端 media query，而不是关掉缩放。
8. **制品的构建溯源**：官方把 `dshBuildCommit: "04f392c9..."` 与 `dshBuildDirty: false` 写进 `package.json`。Sandrone 产物里没有任何 commit / 上游版本 / 构建时间，任何 bug 报告都无法回答「这个包对应哪个 commit」。`preflight.mjs:12-22` 拿到 `git status` 只打印 `dirty (preserved)`，不构成门禁。加一个 `build-info.json` 进 `files` 即可。
9. **更新链路**：`package.json` 里没有 `electron-updater`，`--publish never` 也不生成 `app-update.yml`，于是既没有官方级签名校验通道，自研通道也很薄（只比对 GitHub API 的 `asset.digest`，而该字段**只在发布者显式设置时才存在**；为 `null` 时仅剩两字节 `MZ` 检查）。`release/` 下已有 `.blockmap` 却在做整包下载（每次重下 236 MB）。**建议**：先按「无证书」的现实把自研通道做扎实——`digest` 缺失视为硬失败、把 SHA-256 随包硬编码而不是从远端 API 读、保留手动更新入口与 Release 链接；签名证书（OV 即可）是后续一次性投入，有了它就能换 `electron-updater` 并消掉 SmartScreen 警告。

---

## 7. 视觉层：做对了核心，但用力过度的部分很脆

**做对的地方**：`client.jsx:20-48` 用公开 API `ctx.theme.overrideTokens('@sandrone/harness-ui', TOKEN_LAYER)` 定义了 29 个语义 token（`--dsw-alias-bg-base`、`--dsw-alias-label-primary`、`--dsw-specific-sidebar-fill` 等），明暗两套齐全。这正是官方文档里的正确做法。

**但真正落地的样式不是 token 驱动的**（实测统计 `packages/sandrone-ui/src/client.css`，4,088 行）：

| 指标 | 数值 |
|---|---|
| 含 `!important` 的行 | **1,048（25.6%）** |
| `var(--dsw-*)` 用量 | 仅 17 处 |
| `[class*=...]` 子串匹配官方类名 | 155 处 |
| `data-sandrone-*` 选择器 | 461 处 |
| **硬编码的构建期哈希类名** | **1 处：`.JVDQca_remove`（`client.css:1181`、`:1187`）** |

四处最值得处理的：

- **`.JVDQca_remove`** 已确认存在于当前安装的 `@deepseek-ai/dsh-client-ui-attachment/lib/client.js`，所以今天生效；但它是上游构建期生成的哈希，**上游一重建就变**，届时附件删除按钮的样式会静默失效，而没有任何测试会发现。改成 `data-sandrone-*` 标记或 `aria-label` 定位。
- **1,048 处 `!important`** 说明视觉层在「压过」官方 CSS，而不是「主题化」它。这不是风格洁癖问题：官方每提高一次选择器特异性，都要再加 `!important`，长期必然失控。
- **约 40 个 `data-sandrone-settings-*` 标记**说明设置页被大幅重构。设置页是上游改动最频繁的 DOM，而 sandrone 只用到了 7 个公开 slot（`settings.section` 等）。**这里是上游升级时最先炸、也最难修的地方。**
- 现状与 `docs/architecture.md` 里「主题由 token 驱动」的描述不一致，文档会误导后续维护者。建议要么把描述写实，要么把设置页改成通过 `settings.section` 贡献而不是 DOM 标记。

---

## 8. 建议的行动顺序

### 8.0 下次升级的实测起点（已用 `pnpm run canary` 跑出来）

`node scripts/canary-upstream.mjs --version 0.2.0-rc.2` 对全部 10 个补丁逐个下载候选版本、
抽取后做 `git apply --check`，结果是 **4 个直接可用 / 5 个冲突 / 1 个包已不存在**：

| 结果 | 补丁 | reason | 该怎么办 |
|---|---|---|---|
| 直接可用 | `dsh-api-session-controller` | upstream-bug | 改文件名与版本键即可 |
| 直接可用 | `dsh-llm-pi-ai` | policy-disagreement | 同上 |
| 直接可用 | `dsh-sdk-minimal` | preference | 建议直接删掉，不要带过去 |
| 直接可用 | `dsh-session-format-v0-to-v1` | historical-data | 同上 |
| 冲突 | `dsh-client-ui-chat` | upstream-bug | `lib/client.js:2961`；另有 64 行分支逻辑无扩展点 |
| 冲突 | `dsh-client-ui-model-selection` | preference | **删掉比移植便宜** |
| 冲突 | `dsh-client-ui-open-in-app` | preference | **删掉比移植便宜**（上游 0.2.0 已注册到 `header.actions`） |
| 冲突 | `dsh-llm-deepseek` | upstream-bug | 有报告在等；先查下游是否已修 |
| 冲突 | `dsh-tool-fs` | upstream-bug | 同上 |
| **包已不存在** | `dsh-agent-presets` | capability | 0.2.0 已拆成 `dsh-agent-preset` + `-registry`，**必须重做或放弃** |

**这张表把「41 个文件的大手术」压成了三件事**：删 3 个（`sdk-minimal`、`model-selection`、`open-in-app`）、
重做 1 个（`agent-presets` 换包名）、重移植 6 个里的 1 个（`client-ui-chat`）。剩下 4 个只需改文件名与版本键。

#### 逐条查证后的修正（canary 报告只是起点，不是结论）

canary 只告诉你「能不能打上」，**不告诉你「值不值得打」**。对两个冲突项读了 0.2.0-rc.2 的真实代码之后：

**(1) `client-ui-chat` 的实际成本比 canary 显示的低。** 读 0.2.0-rc.2 的
`dsh-client-ui-chat/lib/client.js`：上游把 `localPathMediaUrl` 重写为 `decodeURIComponent` + `fileMediaUrl`，
并新增

```js
function isAbsoluteWorkspacePath(path) { return path.startsWith("/") || isWindowsStylePath(path); }
```

也就是**上游自己修好了 Windows 盘符路径**——正是本补丁 (1) 在 0.1.5 上手工补的那件事。
结论：该补丁的 bug 部分在 0.2.0 上**直接丢弃，不要重移植**；补丁退化为纯 `forkAt` 分支改写（偏好类），
按偏好补丁的处理原则可以整块删掉、接受上游的分支行为。原表里「重移植 1 个」应降级为「可整块删除」。

**(2) `agent-presets` 不能改成 profile 级挂载。** 本清单初版曾建议「把 image-tools 挂到 profile 级」，
**这是错的，已更正**。已核实的证据：`presets/minimal/agent.cordis.yml` 只有 69 行、没有任何 `include`，
只挂 persona + PTY 栈 + persistent bash/pwsh 两个工具，其自述为 *"The model receives only the persistent
shell (bash on POSIX, pwsh on win32)"*。这说明**预设的名册就是该 agent 的完整工具目录**——profile 级注册
不会出现在走预设的 agent 里，所谓「更干净的挂载层」根本无效。
0.2.0 上提供预设的包已由 `dsh-agent-presets` 变为 `dsh-agent-preset` + `dsh-agent-preset-registry`，
必须重新定位注入点；或者让 Sandrone 另起预设 id（用户需手动选，且 shipped root 优先、无法覆盖同名预设）。

**修正后的升级工作量**：删 4 个（`sdk-minimal`、`model-selection`、`open-in-app`、`client-ui-chat`）、
重做 1 个（`agent-presets` 注入点）、重移植 2 个（`llm-deepseek`、`tool-fs` 的图像门禁）、
改文件名与版本键 3 个（`api-session-controller`、`llm-pi-ai`、`session-format-v0-to-v1`）。

**(3) 那两个「冲突」只是行号位移，不是逻辑变更。** 读 0.2.0-rc.2 的真实代码核对：

| 补丁 | 0.1.5 位置 | 0.2.0-rc.2 位置 | 语义 |
|---|---|---|---|
| `tool-fs` | `assertImageCapableRoute` @`:953`，调用 @`:1069` | @`:898`，调用 @`:1006` | 完全一致 |
| `llm-deepseek` | Messages 门禁 @`:1617` | @`:1415` | 完全一致 |

`.default(["text"])`、`?? ["text"]`、第二处 `:494` 也都原样保留。所以这两个是**机械重生成**，不是设计工作。

**(4) `agent-presets` 在 0.2.0 上的形态完全变了，而且变得更好。** 已核实：

- 旧的 `@deepseek-ai/dsh-agent-presets` **在 0.2.0 已不再发布**（npm 停在 `0.1.6-alpha.2`），官方运行时里也没有它。
- 预设不再以 `presets/<name>/agent.cordis.yml` 形式存在，而是
  `@deepseek-ai/dsh-web-app/presets/{standard,cordis,ptc,minimal}.patch.yml`。
- 每个预设是**一条声明式配置**，名册是可配字段：

  ```yaml
  - insert:
      - id: preset-standard
        name: '@deepseek-ai/dsh-agent-preset'
        config:
          id: standard
          order: 1
          plugins:            # ← 工具名册就是这个数组
            - id: persona
              name: '@deepseek-ai/dsh-persona'
            - id: tool-pwsh
              name: '@deepseek-ai/dsh-tool-pwsh'
  ```

  而 `@deepseek-ai/dsh-agent-preset` 的 schema 就是
  `Config = z.object({ id, name?, description?, order?, plugins: z.array(z.any()).required() })`。

- **该文件自己的头部注释给出了官方的扩展路径**：*"Edits saved from the Web editor override this row's
  `config.plugins` by id from the profile patch."* 也就是说 0.2.0 **预期由 profile patch 按 id 覆盖预设**。

**这条结论对 Sandrone 的意义——已查证完毕，结论是「必须继续改预设文件」**：

读了 0.2.0-rc.2 的 patch 层实现 `@deepseek-ai/dsh-app-boot/lib/index.js` 的 `applyEntryPatches`（`:61-110`），
语义是**逐键浅替换**，不是深合并：

```js
for (const [key, value] of Object.entries(overrides)) {
  if (key === "id") continue;
  target[key] = value;          // config 整体被替换，数组不会被合并
}
```

而 `insert` 分支（`:74-89`）要求目标是 group：`if (!target.group) { warn("patch insert: entry %C is not a group"); continue }`。
预设条目 `preset-standard` 带的是 `config: { id, order, plugins }`（对象，不是数组），也没有 `group: true`，
所以两条路都不通：

- **按 id 覆盖** `config` → 整个 `plugins` 名册被替换，必须把上游那份 146 行抄进 Sandrone 的 profile，
  比打补丁更糟（会随上游漂移，而且是静默漂移）。
- **insert 一行** → 目标不是 group，patch 层直接警告跳过，什么都不会发生。

**因此 `agent-presets` 补丁在 0.2.0 上只能重做、不能删除**：注入点从
`@deepseek-ai/dsh-agent-presets/presets/<name>/agent.cordis.yml` 改为
`@deepseek-ai/dsh-web-app/presets/<name>.patch.yml`，往每个 `config.plugins` 数组里插
`sandrone-image-tools` 一行。改动形状与现在完全一致，只是包名与路径变了。

（顺带一个发现：patch 层对 `name` 做一致性校验——`name` 与目标的 `name` 不符时警告并跳过整条 patch，
见 `:100-103`。这对 Sandrone 反而是好事：上游改包名时不会静默错位，会明确报「name mismatch」。）




### 8.1 已由本轮完成的机制

- `patches/manifest.json`：每个补丁的存在理由 + **`removeWhen`（什么条件下可以删）**。
- `pnpm run verify:patches`：git 之外的第二道门——补丁清单与 `pnpm-workspace.yaml`、`patches/` 目录三者必须完全一致；
  每个补丁必须有理由；`lastVerified` 必须等于当前锁定版本（**升版时会强制你逐个重新确认，或删掉**）；
  偏好类补丁数不得超过 `preferenceBudget`（当前 4/4 已用满，下一个偏好补丁会被拒）。
  同时校验**全部 6 处版本钉**（`.pnpmfile.cjs`、`verify-upstream.mjs`、`upgrade-backup.cjs`、`package.json`、
  workspace 键、补丁文件名）与 `docs/upstream-lock.json` 一致——改版本时它会告诉你到底还有哪几处没改。
- `pnpm run canary [--version X]`：不碰 lockfile、不装依赖，直接预测哪些补丁会冲突，并告诉你**哪个冲突可以直接删而不是修**。

### 8.2 其余顺序

**第 1 周（只修缺陷，不碰架构）**
1. `listDirectories` 的 `break` → `continue`（§2.2）——一行，用户可见的功能 bug，先修。**本轮已完成**
2. `space/` 挪到 userData + 一次性迁移（§2.3）。**本轮已完成**
3. `copyResource` 加受保护根校验（§2.1，纵深防御）。**本轮已完成**
4. `SANDRONE_QA_PICK_DIRECTORY` 加 `!app.isPackaged`；`writeExtensionsPatch` 补 `mode: 0o600`；根 `.gitignore` 加 `sandrone-harness/space/`。**本轮已完成**
5. `whenReady().catch` 改成弹错误框；补 `unhandledRejection` / `child-process-gone`。
6. 改 README 关于 Python 的说法（§2.6）。**本轮已完成**

**第 2 周（低成本高感知）**
7. `profiles/*.patch.yml` 里 `disabled: true` 掉 `ui-brand-official`，用插件提供自己的品牌（解决启动 logo，§6.1）。
8. `titleBarStyle: 'hidden'` + `titleBarOverlay`，`minWidth` 降到 520，`backgroundColor` 跟随主题（§6.2/6.4/6.5）。
9. 退出前检查进行中任务 + 加托盘（§2.5 + §6.6）。
10. 按 §8.0 的表删掉 `sdk-minimal`、`model-selection`、`open-in-app` 三个补丁，并把 `preferenceBudget` 下调到 1。

**第 3 周（一次性投入，长期省事）**
11. 打开 `asar: true` + `asarUnpack`，同步修 `deploy-runtime-package.cjs` 的 symlink（§2.4）。
12. 加 `build-info.json` 溯源 + `write-checksums.mjs` 生成 `SHA256SUMS.txt`（§6.8/§6.9）。
13. `files` 排除非目标平台二进制与多余 locale（§3）。
14. 用 profile 关掉不需要的官方插件，删除被取代的自研实现（例如在 0.2.x 上用 `dsh-plugin-manager` 取代 `extensions-config.cjs` 的一部分）。

**随后：把版本族追平到 0.2.x**，再谈别的功能。这一步会顺带解锁 `dsh/profile-boot`（进程内 boot，摆脱 stdout 正则）、官方插件管理器、以及 51 个新包里的能力。


---

## 9. 值得肯定的部分

这份承载层的 **IPC 信任模型、路径收敛、导航策略、就绪检测** 明显高于同类个人项目的平均水准，请保留：

- `lib/ipc-policy.cjs`（22 行）：主窗口 + `event.sender` + `senderFrame === mainFrame` 三重校验，45 个 handler 全部调用，测试还专门构造伪造 frame 的场景。
- `lib/navigation-policy.cjs`：loopback 判定处理了 `::ffff:127.0.0.1` 的 IPv4-mapped IPv6、尾随点号、拒绝 `user:pass@`，测试全部钉住。
- `lib/workspace-browser.cjs`：`realpath` 校验根 → 拒绝 `..` → **解析后再校验一次**（防符号链接逃逸）→ 过滤 `entry.isSymbolicLink()`。三层收敛比很多商业 Electron 应用都严谨。
- `lib/local-image-policy.cjs`：`realpathSync` 后再比对 + 扩展名白名单 + 大小上限 + 根必须来自已登记 workspace 或用户显式选择。**唯一的问题是 §2.1 那条平行通道没走这里。**
- `lib/harness-supervisor.cjs`：`generation` 计数防跨代污染、跨 chunk 拼接就绪行、预算内退避重启、`stableAfterMs` 后重置预算、就绪 URL 强制 `http://127.0.0.1`、token 只进 `ready` 事件不进公开 status。我实测了它的正常路径与预算耗尽路径，行为都正确。
- 截图链路的分层是对的：DOM→PNG 在沙箱渲染进程完成，主进程只用 `sharp` 做拼接与边界校验，并显式禁用 `capturePage`/`executeJavaScript`。
- `resolve-package.cjs`：包名白名单 + 清单身份校验 + bin 落在包目录内 + `realpath` 二次校验。
- `rename-with-retry.cjs` 与 `deploy-plugin.cjs` 的回滚：针对 Windows `EPERM/EBUSY` 的真实修复，不是花架子。
- 仓库追踪卫生良好：`release/`、`runtime/`、`tmp/`、`node_modules/`、`.pnpm-store/` 均已忽略且未被跟踪（唯一漏网是 `space/`）。
