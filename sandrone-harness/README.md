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

The Windows desktop profile pins DeepSeek's official in-app browse directory picker. This preserves workspace selection without loading the native picker worker, which is not ABI-compatible with Electron's embedded Node runtime. Packaging uses the official Windows x64 prebuild shipped by `node-pty`, so a normal build does not require Visual Studio Spectre-mitigated libraries.

On first launch, finish DeepSeek's preview notice and API-key onboarding before using controls behind those dialogs; choosing **稍后配置** is supported. `pnpm run qa:desktop` exercises that cold-start flow, opens the picker from Sandrone's top bar, adopts a real temporary directory, reloads the renderer, and verifies that the Workspace remains registered. Set `ELECTRON_EXECUTABLE_PATH` to a packaged executable to run the same checks against `win-unpacked` or an installed build.

The desktop supervisor starts the official `dsh web` profile on a random
`127.0.0.1` port. Harness data is kept under Electron's user-data directory and
survives application upgrades.

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
focus line. Light and dark modes are token-driven; mobile layouts collapse without
horizontal overflow; reduced-motion users receive the same controls without animation.

The Buddy pet is an optional overlay, not another assistant. Its visibility is stored
under `sandrone.harness.buddy.v1`, and it has no access to prompts, responses,
providers, API keys or session history.

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
