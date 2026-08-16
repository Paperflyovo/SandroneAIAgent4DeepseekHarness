# Sandrone AI Agent for DeepSeek Harness

这是 SandroneCode 对 DeepSeek Harness 的开源适配项目。仓库保留 DeepSeek Harness 的完整源码，同时提供 Sandrone 风格的 Web 视觉插件和 Electron 载体。

> Co-authored by Paperfly_ovo & Seint

## 目录

- `deepseek-harness/`：DeepSeek Harness 官方源码，保持上游目录结构和许可证，不在适配层中复制或改写。
- `sandrone-harness/`：Sandrone Web 适配、Buddy 宠物视觉层、Electron carrier、运行脚本、技能和验收测试。

## 设计边界

DeepSeek Harness 负责 agent loop、会话与历史、流式事件、上下文压缩、provider/model、凭据、权限、工作区、技能、MCP、持久化和官方 Web 生命周期。Sandrone 只通过公开客户端插件接口提供视觉和桌面体验：暖纸张与墨色的界面、可切换深色模式、紧凑侧栏、Buddy 宠物和 Electron 窗口载体。

这样可以直接吸收 DeepSeek Harness 后续的后端和 Web 能力，同时保持 Sandrone 的产品识别度。移除 `sandrone-harness/packages/sandrone-ui` 后，官方 Harness 的状态、对话和运行时仍然完整可用。

## 快速开始

环境要求：Node.js 22.19 或更新版本，以及 pnpm 11。

```powershell
cd .\sandrone-harness
pnpm install
pnpm run build:ui
pnpm run verify:architecture
pnpm run verify:upstream
pnpm test
pnpm run web
```

浏览器 Web 入口由脚本启动在本机回环地址。启动 Electron 桌面版：

```powershell
cd .\sandrone-harness
pnpm run desktop
```

打包安装程序：

```powershell
cd .\sandrone-harness
pnpm run desktop:pack
```

Windows 安装包使用 DeepSeek 官方的应用内目录浏览器选择工作区，避免 Electron 内置 Node 与原生目录弹窗 worker 的 ABI 冲突。`node-pty` 使用其官方 Windows x64 预编译模块，因此普通打包不要求安装 Visual Studio Spectre 缓解库。

当前开源构建没有商业代码签名证书，首次运行安装包时 Windows SmartScreen 可能要求用户确认。发布页提供 SHA-256 用于核对下载文件。

首次运行会在本机用户数据目录创建 Harness 数据。不要把 `.env`、API Key、会话目录、浏览器 profile、`node_modules` 或 `release/` 上传到 Git。

## 更新 DeepSeek Harness

上游代码位于 `deepseek-harness/`，适配层通过 DeepSeek 的公开客户端包和插件接口工作。升级时请整体更新 DeepSeek 包族，重新执行适配层的构建、架构检查、上游锁定检查和测试，并在发布前备份 Harness 用户数据。`sandrone-harness/docs/upstream-lock.json` 记录了当前适配所依据的上游版本证据。

## 技能

`sandrone-harness/skills/sandrone-harness-frontend-lifecycle/SKILL.md` 记录了 Sandrone 适配层如何使用 DeepSeek 的 Web 生命周期、会话投影、流式输出和刷新机制。它既是开发规范，也是后续上游升级时的验收清单。

## 许可证

Sandrone 适配层采用 MIT 许可证，见根目录 `LICENSE`。DeepSeek Harness 保留其上游 MIT 许可证、版权声明和 `THIRD_PARTY_NOTICES.md`，详见 `deepseek-harness/LICENSE`。
