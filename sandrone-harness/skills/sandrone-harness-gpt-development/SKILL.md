---
name: sandrone-harness-gpt-development
description: Develop and debug the Sandrone desktop distribution of DeepSeek Harness, especially Electron/Web UI behavior, public client plugins, CSS, runtime loading, and verification. Use when a request mentions Sandrone Harness, the Electron desktop app, its Web renderer, composer/input box, settings, sidebar, Buddy, or UI reload.
metadata:
  short-description: Sandrone Harness development workflow
---

# Sandrone Harness GPT Development

Use this skill as the project-specific operating contract. Read
[references/tool-protocol.md](references/tool-protocol.md) before the first tool
call in an implementation, debugging, build, installation, or Git task. The
repository has two distinct products: `deepseek-harness/` is upstream runtime
code, while `sandrone-harness/` is the Sandrone adaptation. Prefer changing the
adaptation unless the user explicitly asks to change upstream.

## First response and discovery

- Treat the repository root as the directory containing `sandrone-harness/` and
  `deepseek-harness/`; run commands from `sandrone-harness/` for project scripts.
- Read the applicable `AGENTS.md`, then run `git status --short` and
  `pnpm run preflight`. Preserve existing user changes and do not reset, stash,
  or overwrite them.
- Locate behavior from source and generated output together. For UI, inspect
  `packages/sandrone-ui/src/` first, then `lib/`; do not infer a missing path
  from a failed broad glob.
- For Electron behavior, trace `apps/desktop/main.cjs`,
  `apps/desktop/harness-runner.mjs`, and `apps/desktop/lib/` before editing.

## Architecture boundaries

DeepSeek owns agent loop, sessions, event history, providers, credentials,
permissions, workspaces, skills, MCP, and persistence. Sandrone owns reversible
visual plugins and the Electron carrier. Do not create a second transcript,
provider proxy, session store, or backend protocol. UI code should use public
client exports, `ctx.slots`, `ctx.theme`, semantic `data-slot` regions, and
`--dsw-*` tokens; avoid hashed upstream class names when a stable marker exists.

## Editing and tool failures

- Use `apply_patch` for source edits. Never respond with a proposed patch only
  when the user asked for implementation.
- Read the injected sandbox policy before choosing tool arguments. When the
  current mode is already `danger-full-access`, never pass escalation fields.
  Only request a wider mode when the current mode is narrower, the rejected
  operation is in scope, and the tool explicitly supports escalation.
- `sandbox_permissions` and `justification` are a pair. If escalation is valid,
  send both once with a concrete reason; otherwise send neither.
- A tool failure is not evidence that the file is unwritable. Re-read the
  result and inspect the path, arguments, schema, permissions, and external
  state before choosing a different call. Do not repeat an identical failed
  call or delegate merely to bypass it.
- Keep file reads at 2,000 lines or fewer and page larger files. In PowerShell,
  prefer `rg` and `rg --files`; do not use Bash brace-glob syntax.
- Do not add CSS as a blind final override until existing responsive and desktop
  rules have been inspected; explain which cascade rule caused the bug.

## UI and Electron workflow

For visual requests, identify the stable semantic region and its desktop/mobile
breakpoints. Preserve normal responsive behavior unless the user explicitly
requests a fixed desktop dimension. Input/composer sizing must account for
`min/max/flex` constraints and overflow, not just `width` or `height`.

After changing `packages/sandrone-ui/src/**`:

1. Run `pnpm run build:ui`.
2. Run `pnpm run verify:ui-sync`.
3. Run the most relevant contract test, then `git diff --check`.

In source Electron mode, a fresh UI check means rebuild, deploy into the active
`DSH_HOME`, and hard-reload or fully restart Electron as appropriate. Ctrl+R is
the development reload path; it is not proof that a packaged build changed.
Never stop unrelated Node, browser, or Electron processes.

## Verification and handoff

Use the smallest useful validation first: targeted test, UI sync, architecture
or upstream verification, then broader `pnpm test` when practical. For desktop
changes, also inspect the supervisor and IPC boundary tests. Report exact files
changed, commands run, and any validation blocked by the environment. Do not
commit or push unless explicitly requested.

## Typical request translation

For a request such as “make the Electron input box keep a stable size when the
window is short and remove the ugly settings search box”: inspect composer
container and textarea rules plus media queries, determine whether the scrollbar
comes from flex shrinking or overflow, implement a scoped fix in the Sandrone
plugin, restyle the settings search using its stable marker, rebuild the bundle,
verify sync, and run the adjacent UI contract tests. Do not edit DeepSeek's
official session or settings runtime to solve a visual problem.
