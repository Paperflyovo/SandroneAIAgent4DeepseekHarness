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

## Install a release build

Download `SandroneAIAgent-26.9.12-x64.exe` from the
[latest release](https://github.com/Paperflyovo/SandroneAIAgent4DeepseekHarness/releases/latest)
and run it. The installer bundles
Electron, the Harness runtime, the Web UI bundle, and native Windows helpers; a
new machine does not need Node.js, pnpm, Python, or a separate Harness install
to launch the application. Tools required by an Agent's target project, such as
Git, Python, or a compiler, must still be installed for that project's tasks.
Launch **Sandrone AI Agent** from the Start menu or desktop shortcut. Choose
**稍后配置** on the optional API-key prompt if needed, then configure a provider
in Settings before sending a prompt. User data and session history stay in the
per-user application-data directory and survive upgrades.

Maintainers can smoke-test the unpacked release with `pnpm run desktop:dir`,
then start `release/win-unpacked/SandroneAIAgent.exe`. End users should use the
installer asset instead of running from a source checkout.

On first launch, finish DeepSeek's preview notice and API-key onboarding before using controls behind those dialogs; choosing **稍后配置** is supported. `pnpm run qa:desktop` exercises that cold-start flow, opens the picker from the official sidebar add-workspace button, adopts a real temporary directory, reloads the renderer, and verifies that the Workspace remains registered. Set `ELECTRON_EXECUTABLE_PATH` to a packaged executable to run the same checks against `win-unpacked` or an installed build.

Maintainer upgrade checks use `pnpm run qa:upgrade`: an isolated Harness home and a
local mock provider exercise the official PowerShell tool, image upload, streaming,
local image delivery, Buddy and history reload. No real API key is needed. Set
`QA_APP_ROOT` to `release/win-unpacked/resources/app` and `QA_NODE_EXECUTABLE` to the
absolute packaged executable to exercise shipped dependencies and the embedded
runtime. Set `QA_SYSTEM_PATH=1` with `qa:desktop` to remove development tools from
the application's PATH. `tests/session-migration.test.mjs` and
`tests/native-runtime.test.mjs` also honor `QA_APP_ROOT`; execute these files directly
with the packaged executable in `ELECTRON_RUN_AS_NODE=1` mode to verify migration,
PTY and PNG codecs without relying on system Node.

The desktop supervisor starts the official `dsh web` profile on a random
`127.0.0.1` port. Harness data is kept under Electron's user-data directory and
survives application upgrades.

The desktop window is frameless and mirrors SandroneCode's desktop titlebar: a
38px full-width drag strip with history chevrons, the 文件/编辑/视图/帮助 app-menu
labels, and right-aligned minimize/maximize/close controls — all driven through
the narrow desktop bridge. The OS-facing title stays `Sandrone AI Agent`; the
sidebar keeps the session names, and menu commands delegate to the official
sidebar/settings/workspace controls.

### Space region

The desktop sidebar's **工作区** switcher also opens **空间区**, a local Markdown
workbench for notes while an Agent is running. Spaces live under the user-data
directory as `space/<space-id>/` with `space.json`, `md/` and `res/` directories.
Earlier releases kept them beside the installed application, which loses them
whenever the installer is pointed at a new path; the first packaged launch copies
them into the user-data location and leaves the original directory untouched. The workbench provides space and document creation/deletion,
Markdown editing and reading, debounced auto-save, resource import with
automatic image references, relative Markdown links and resource previews. The Electron bridge validates every space id and relative
path before accessing the filesystem; Markdown writes use atomic replacement.
The editor follows the useful parts of the local Typora workflow without
embedding Typora itself: each document keeps an in-session edit history,
`Ctrl+Z`/`Ctrl+Y` and `Ctrl+Shift+Z` work in the editor, switching documents
flushes pending changes, and **编辑 / 分屏 / 阅读** modes are available. Typora
is used as a local interaction reference only; its executable and proprietary
runtime are not redistributed. Images can be pasted or dragged into the editor
and are copied into the space `res/` directory with a relative Markdown
reference. The space search searches every space and document body, while the
sidebar lists imported resources and inserts their relative references with one
click. Documents can be renamed without leaving the editor, and the last
document opened in each space is remembered locally. Deleted Markdown moves to
a local trash entry and can be restored from the sidebar immediately after
deletion. Tab indentation, Shift+Tab outdent, and Markdown list/task-list/
blockquote continuation are supported in the editor.
Space names support double-click renaming and inline deletion. The note `+`
menu creates Markdown files or subfolders; selecting a folder starts a document
inside it. Selecting a resource exposes insertion, rename, and delete actions,
and resource renames update existing `res/` references in the space.
Desktop Markdown files are checked for external timestamp changes while idle;
the editor offers an explicit reload instead of silently replacing newer file
content.

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

The **其他** section also includes **版本更新**. In the packaged desktop build,
the action checks the latest GitHub Release for the current platform and
architecture, downloads only the exact platform asset over Electron's
proxy-aware network stack, verifies its size and GitHub SHA-256 digest, then
lets you confirm before handing it to the platform installer (Windows starts
NSIS; macOS/Linux open the downloaded package with the system installer).
Windows `.exe` files also pass a PE-header check. Downloads are staged under
the app's user-data `updates` directory; partial files are removed after
failures. Source/web runs keep the control hidden because they are not
installed desktop builds.

## Cross-platform desktop sandbox

`pnpm run desktop:pack` now selects a native Builder profile from the current host and CPU. Windows produces NSIS, macOS produces DMG and ZIP, and Linux produces AppImage and DEB. `pnpm run desktop:dir` creates only the unpacked application for the current platform. Cross-compilation is deliberately rejected: platform-native dependencies are installed and packaged on matching runners.

The Windows, macOS and Linux profiles use the platform prebuilt `node-pty` artifacts shipped by the current dependency family. Linux keeps the sequential Electron rebuild policy as a fallback for native dependency changes. Every package runs an `afterPack` gate that refuses an artifact missing the matching PTY binary.

The repository-level `Desktop cross-platform sandbox` workflow is manual and uploads unsigned x64/arm64 artifacts for 14 days; it cannot publish a GitHub Release. This keeps early macOS/Linux experiments separate from the signed release path. macOS Gatekeeper and Windows SmartScreen warnings remain expected until signing and notarization are configured.

The implementation boundary, native dependency policy, public reference evidence and promotion checklist are recorded in `docs/cross-platform-desktop.md`.

## Upstream rule

The npm distribution is pinned to `@deepseek-ai/dsh@0.2.0-rc.2` and the matching
DeepSeek package family. The audited source reference is recorded in
`docs/upstream-lock.json`; it is evidence for review, not a claim that the npm artifacts are
byte-identical to the source checkout. Upgrade the whole package family in a
separate change, run the compatibility gates, and back up the Harness data directory
before opening the candidate.

## Extension boundary

### Upgrade backup and rollback

Before the first launch with Harness `0.2.0-rc.2`, Sandrone copies existing Harness
data to the sibling `DeepSeekHarness-backups/before-0.2.0-rc.2-*/data` directory.
The backup excludes package links and `node_modules`; it includes history, settings
and credentials, so keep it private. Startup stops if the backup cannot finish.
New installations only receive a version marker. Plain and Zstandard V0 histories
are migrated by the official JSONL backend on write; their original files remain.
The pinned compatibility patch preserves legacy permission-origin fields and
upgrades validated V2 subagent descriptors, including their tool restrictions.
Unknown historical fields still stop migration rather than silently dropping data.

To roll back, quit Sandrone completely, keep the current `DeepSeekHarness` directory
under a different name, copy the completed backup's `data` directory back as
`DeepSeekHarness`, then install the previous release. Check `backup.json` for
`complete: true` before restoring. New conversations since the upgrade remain in
the directory you set aside; do not merge V3 files into an old runtime.

### Client plugin

`packages/sandrone-ui` is a normal out-of-tree Harness client plugin. It uses only
public `/client` package exports, `ctx.slots`, `ctx.theme` and semantic `--dsw-*`
tokens. Buddy uses an official companion Session and the public SessionEventStream;
the plugin stores only the association between main and companion session IDs.
Removing the plugin removes
its slot registrations, theme layer and stylesheet without touching official state.

## Sandrone Web experience

The composer uses the native attachment and command controls with Sandrone styling:
one paperclip handles files and images; `+` and `/` open the official commands.
The folder button opens the native file explorer and document preview. The duplicate
workspace browser and extra sidebar launcher are removed. Header utilities use
borderless controls, while the existing paper palette, artwork and input design remain.
The native external-app action sits beside the agent mode below the session title,
using a monochrome launch glyph and the selected application's name. Its menu retains
native app discovery and choice persistence, with keyboard focus and responsive placement.
The composer follows Harness's shared conversation-width variables, so resizing the
transcript cannot place a resize handle over the attachment button.

Renaming a built-in DeepSeek model or adjusting its context window preserves the
built-in image capability when `inputModalities` is omitted. An explicit modality
list still takes precedence. This prevents a renamed `deepseek-flash` from silently
sending text-only image placeholders. Custom model IDs must declare their actual
capabilities; an endpoint's acceptance remains authoritative.

The Web surface deliberately keeps SandroneCode's visual language while DeepSeek
Harness remains the only product/runtime owner. The UI uses a warm paper-and-ink
palette, a quiet sidebar, compact controls, restrained shadows and a red composer
focus line. The sidebar search keeps SandroneCode's flat icon-plus-input row with
its round clear button, the `项目与会话` results group, and the slide-in/fade
animations for the results tree and rows. Light and dark modes are token-driven;
mobile layouts collapse without
horizontal overflow; reduced-motion users receive the same controls without animation.

Buddy is an optional development companion. It receives a bounded summary of visible
main-session activity and uses the same provider, preferring a lightweight model.
Messages and replay belong to Harness; legacy local chat caches are read only as a
fallback. Buddy does not execute tools or read provider credentials.

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
