# Sandrone AI Agent for DeepSeek Harness

This repository is a Sandrone-flavoured distribution of the official DeepSeek Harness.
The official Harness owns the agent loop, sessions, event history, streaming projection,
providers, models, credentials, permissions, skills, MCP, workspaces and persistence.
Sandrone contributes only reversible client plugins, the Electron carrier and visual
identity. The old Sandrone server and WebSocket protocol are deliberately not included.

## Run from source

Requirements: Node 22.19 or newer and pnpm 11.

```powershell
pnpm install
pnpm run build:ui
pnpm run verify:architecture
pnpm run verify:upstream
pnpm test
pnpm run desktop
```

The desktop picks workspace directories through the OS-native folder dialog:
Electron's own `dialog.showOpenDialog` (no native worker, so no ABI surface with
the embedded Node runtime). The Sandrone UI occupies the official
`sidebar.workspaces.directoryFlow` and `conversation.hero.workspace.directoryFlow`
slots with a bridge-backed flow, and the desktop profile (`profiles/
sandrone-desktop.patch.yml`) omits the official in-app browse picker. The Web
profile keeps DeepSeek's in-app browse picker unchanged. Packaging uses the
official Windows x64 prebuild shipped by `node-pty`, so a normal build does not
require Visual Studio Spectre-mitigated libraries.

On first launch, finish DeepSeek's preview notice and API-key onboarding before using controls behind those dialogs; choosing **稍后配置** is supported. `pnpm run qa:desktop` exercises that cold-start flow, opens the picker from the official sidebar add-workspace button, adopts a real temporary directory, reloads the renderer, and verifies that the Workspace remains registered. Set `ELECTRON_EXECUTABLE_PATH` to a packaged executable to run the same checks against `win-unpacked` or an installed build.

The desktop supervisor starts the official `dsh web` profile on a random
`127.0.0.1` port. Harness data is kept under Electron's user-data directory and
survives application upgrades.

The desktop window is frameless and mirrors SandroneCode's desktop titlebar: a
38px full-width drag strip with history chevrons, the 文件/编辑/视图/帮助 app-menu
labels, and right-aligned minimize/maximize/close controls — all driven through
the narrow desktop bridge. The OS-facing title stays `Sandrone AI Agent`; the
sidebar keeps the session names, and menu commands delegate to the official
sidebar/settings/workspace controls.

### Instant UI reload (Ctrl+R)

While the desktop app is running, press `Ctrl+R` (视图 menu) to rebuild the
Sandrone UI plugin, redeploy it into `DSH_HOME` and hard-reload the renderer —
no application restart. The Harness serves plugin bundles from disk with
`cache-control: no-cache`, so the next paint reflects the new bundle; the
official `client-hmr` poll also notices the redeployed files and pushes a
rebuild frame to the browser half.

The 视图 menu also exposes a persisted **GPU 硬件加速** checkbox (stored in
`desktop-settings.json` under user-data), mirrored by the settings page's
**其他** section as a toggle switch. Turning it off calls
`app.disableHardwareAcceleration()` on the next launch so the renderer uses
software compositing — the remedy for afterimage/ghosting artifacts on GPU
drivers with broken accelerated compositing. The menu change offers an
immediate restart; the settings switch simply takes effect on the next launch.

## Cross-platform desktop sandbox

`pnpm run desktop:pack` now selects a native Builder profile from the current host and CPU. Windows produces NSIS, macOS produces DMG and ZIP, and Linux produces AppImage and DEB. `pnpm run desktop:dir` creates only the unpacked application for the current platform. Cross-compilation is deliberately rejected: platform-native dependencies are installed and packaged on matching runners.

The Windows and macOS profiles use the prebuilt `node-pty` artifacts shipped by its package. Linux has no published `node-pty` prebuild in this dependency version, so its profile enables a sequential Electron rebuild and the CI runner installs the required compiler toolchain. Every package runs an `afterPack` gate that refuses an artifact missing the matching PTY binary.

The repository-level `Desktop cross-platform sandbox` workflow is manual and uploads unsigned x64/arm64 artifacts for 14 days; it cannot publish a GitHub Release. This keeps early macOS/Linux experiments separate from the signed release path. macOS Gatekeeper and Windows SmartScreen warnings remain expected until signing and notarization are configured.

The implementation boundary, native dependency policy, public reference evidence and promotion checklist are recorded in `docs/cross-platform-desktop.md`.

## Upstream rule

The npm distribution is pinned to `@deepseek-ai/dsh@0.1.0-rc.6` and the matching
DeepSeek package family. The audited source reference is recorded in
`docs/upstream-lock.json`; it is evidence for review, not a claim that npm rc.6 is
byte-identical to the earlier source checkout. Upgrade the whole package family in a
separate change, run the compatibility gates, and back up the Harness data directory
before opening the candidate.

## Extension boundary

`packages/sandrone-ui` is a normal out-of-tree Harness client plugin. It uses only
public `/client` package exports, `ctx.slots`, `ctx.theme` and semantic `--dsw-*`
tokens. Its Buddy overlay has no session or message state. Removing the plugin removes
its slot registrations, theme layer and stylesheet without touching official state.

## Sandrone Web experience

The Web surface deliberately keeps SandroneCode's visual language while DeepSeek
Harness remains the only product/runtime owner. The UI uses a warm paper-and-ink
palette, a quiet sidebar, compact controls, restrained shadows and a red composer
focus line. The sidebar search keeps SandroneCode's flat icon-plus-input row with
its round clear button, the `项目与会话` results group, and the slide-in/fade
animations for the results tree and rows. Light and dark modes are token-driven;
mobile layouts collapse without
horizontal overflow; reduced-motion users receive the same controls without animation.

The Buddy pet is an optional overlay, not another assistant. Its visibility is stored
under `sandrone.harness.buddy.v1`, and it has no access to prompts, responses,
providers, API keys or session history.

Settings open as a standalone page that fills the window below the 38px
titlebar — no floating dialog, dimming mask, close button, or redundant
"设置" nav title. The left navigation starts with a 返回工作区 row and a
section-search box that filters the settings sections (Enter opens the first
match), and keeps the official left navigation and content, restyled onto the
paper palette.

The plugin marks stable public `data-slot` regions with `data-sandrone-*` attributes.
This keeps the visual layer resilient to DeepSeek's generated class names while
leaving the official conversation, streaming, refresh and persistence paths intact.

### Updating the Web bundle

Run `pnpm run build:ui` after changing the visual plugin. Startup deployment is
content-aware: a changed `lib` bundle is atomically refreshed even when the plugin
version remains `0.1.0`. This prevents a warm `DSH_HOME` from silently serving an old
visual bundle. `tests/deploy-plugin.test.mjs` covers the same-version refresh and
rollback-safe managed link behavior.

## Security posture

- The Harness host binds to loopback only; `0.0.0.0` is rejected by the official CLI.
- Renderer Node integration is disabled and context isolation is enabled.
- IPC is a small, typed status surface; it is not a second application API.
- Only `http`/`https` links are opened externally, and navigation stays on the
  supervisor's loopback origin.
- Child process shutdown is awaited and bounded; crash restarts are limited.
- Public Windows artifacts are currently unsigned and may trigger SmartScreen; verify the SHA-256 published with each release.
