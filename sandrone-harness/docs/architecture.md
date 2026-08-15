# Sandrone Harness Architecture

## Ownership

| Concern | Owner |
| --- | --- |
| Agent loop, tools and approvals | DeepSeek Harness host |
| Session log, sequence and projections | DeepSeek Harness host and official client runtime |
| Provider, model, API key and credentials | DeepSeek Harness settings and credential plugins |
| Skills, MCP and permissions | DeepSeek Harness plugins |
| Workspace and official Web navigation | DeepSeek Harness UI plugins |
| Brand tokens and Buddy | Sandrone client plugin, reversible effects only |
| Window, process, menu, external links and updates | Sandrone Electron carrier |

There is one mutable owner for every official concern. Sandrone never writes the
Harness data directory, emits SessionEvents, proxies providers, or assembles a second
transcript. A refresh or reconnect always goes through the official connection and
session runtime, so long reasoning, tool output and final responses remain recoverable.

## Sandrone Web visual layer

The Web application keeps the official Harness DOM, routes, session projection and
streaming implementation. Sandrone is an out-of-tree visual layer applied through the
public plugin contract:

- `ctx.theme.overrideTokens` supplies the paper, ink, sidebar, border and dark-mode
  tokens without replacing the official theme service.
- `ctx.slots` adds only the Buddy overlay; Buddy stores one display preference in its
  own `sandrone.harness.buddy.v1` localStorage key and never reads session data.
- Semantic `data-sandrone-*` markers are attached to stable `data-slot` regions so CSS
  can target the sidebar, center conversation, composer, details and overlay without
  depending on hashed class names.
- `client.css` owns typography, restrained paper surfaces, narrow-radius controls,
  red composer focus, responsive sidebar behavior and reduced-motion fallbacks. The
  stylesheet is installed and removed by the plugin effect, so a plugin reload cannot
  leave stale visual rules behind.

The marker pass runs through a `MutationObserver` because the official Web shell
materializes slots asynchronously. The observer is disposed with the plugin effect;
it does not create a second render loop or refresh cycle.

## Build and same-version deployment

`pnpm run build:ui` compiles `packages/sandrone-ui/src` into the `lib` bundle. At
startup, the Web launcher and Electron supervisor call the same deployment helper. It
copies only `package.json` and `lib/**` into the managed extension version, compares
the complete tree, and atomically replaces the version directory when the bundle
changed even if the semantic version stayed the same. The profile junction is then
pointed at that exact target. A failed replacement rolls back to the previous target;
an unmanaged profile package is never overwritten.

## Lifecycle invariants from the paper

The supplied *A Programming Paradigm for Spatiotemporal Composability* is translated
into implementation rules rather than copied as a formal system:

1. Every listener, timer, stylesheet, Slot registration, child process and IPC handler
   has one reversible owner.
2. A plugin is not considered unloaded until its effects are quiescent and its child
   declarations have collapsed.
3. A reconnect or dynamic reload must converge to the same projection as a clean boot.
4. Async results carry a generation; stale generations cannot overwrite current state.
5. Cross-plugin dependencies are declared through public services and Slot contracts,
   never through private source imports or module-level mutable state.

These rules are checked by `scripts/verify-architecture.mjs` and by the supervisor
and plugin tests.

## Deliberate non-goals for the first release

Git worktrees, QQ Bot transport and old Sandrone data import are not implemented as a
parallel backend. When added, each must become an official Harness plugin or a separate
carrier extension and must enter the official permission/session APIs.
