# Sandrone Harness Architecture

## 0.1.5 upgrade ownership and acceptance

Target: published `@deepseek-ai/dsh` family `0.1.5-rc.1`, source
`183f08e9c6dde7e36cd2318eaee70b0da08fb35e`.

| Value or effect | Owner and lifetime |
| --- | --- |
| Sessions, models, settings, history, migration | Official Host controllers and persistence |
| Connection, session snapshots, replay | Official connection and UI session services |
| Buddy conversation | Official companion Session; component owns only draft and request cancellation |
| Theme, Slot entries, DOM markers | Sandrone plugin fiber; remove on disposal |
| Attachment intake, command palette, permissions | Official composer; Sandrone styles its existing controls |
| Conversation width and resize handles | Official conversation root; composer uses the same native width variables |
| External-app catalog, selected app, launch and menu state | Official open-in-app controller/component; versioned presentation patch selects the public header-actions slot |
| File explorer, document preview, pane state | Official `sidebarRight`; one Sandrone toolbar entry calls its public service |
| Process, startup backup, filesystem IPC | Electron carrier; bound to application lifetime |

Upgrade acceptance proceeds through dependency and public API migration, UI and
image capability adaptation, isolated V0-to-V3 history migration, then packaged
Windows cold boot with a system-only PATH. Live user data must not be used by QA.
The existing embedded website browsing feature remains removed.

Validation on Windows x64 with Electron 43.3.0 covers automated tests, the build/UI
sync/architecture/upstream/Skill gates, and packaged desktop cold-start checks.
`qa:upgrade` also runs the shipped runtime against a local mock provider and checks
PowerShell execution, image upload and delivery, main/Buddy history reload, and
command activation by pointer/keyboard/slash, permission changes, native file/image
intake and removal, file preview, view switching, and 1280/1440/768/390/1920px layouts
with reduced motion. Geometry checks assert that the titlebar has one inset before
and after opening the right pane. Packaged execution uses a system-only
PATH; the migration and native tests additionally load shipped dependencies under
Electron-as-Node. The Windows installer is a local candidate; these checks do not
constitute a macOS/Linux release validation or a live-provider compatibility test.

The versioned V0 migration patch admits only the released permission origins
(`default`, `selection`, `inferred`) and validates descriptor V2 against its known
fields before promoting it to V3. It preserves permission values, persona and tool
restrictions; unknown fields/versions still reject. Read/write migration tests
verify that original artifacts remain byte-identical. A local audit also migrated
36 real legacy-session copies, including two descriptor-V2 subagents, without
opening the original data for writing.

DeepSeek model catalog overrides inherit only omitted input modalities from the
matching built-in model ID. The schema preserves omission through parsing; it must
not materialize `['text']` before catalog resolution. Explicit modality declarations
remain authoritative, and unknown IDs retain the upstream text default. This keeps
the resolved capability shared by request preparation, image pricing and adapter
serialization. Disabling only adapter image rejection is insufficient: the core
LLM runtime substitutes text placeholders before a text-only adapter receives images.
The regression test passes a renamed `deepseek-flash` through the real LLM runtime
and DeepSeek adapter to a local Files/Chat API, verifies upload bytes and file IDs
on the first and subsequent requests, and confirms the original history is unchanged.

The layout marker locates the frame through the permanent `data-rightbar-col`
child. Collapse attributes are transient state and cannot identify a frame. The
frame reserves titlebar space once for all columns; hidden blank-session headers
remain hidden. This prevents repeated insets after pane toggles or session changes.

The composer must use `--dsh-composer-card-max-width` and
`--dsh-composer-side-clearance`. Fixed 800px overrides let the native full-height
resize strip overlap the paperclip at a 1280px logical window width (1920px at
150% display scaling). Acceptance clicks the real button, observes the file chooser,
and probes its hit targets before and after native left/right width drags, with the
file pane open, and across responsive widths. Setting a hidden file input alone
does not verify that users can open it.

The pinned open-in-app presentation patch moves its own registration from the
public header-utilities list to the compatible header-actions list. It renders the
selected app name, aligns its inline menu to the start with keyboard focus, and adds a
styling marker. The original controller still owns discovery, choice persistence,
launch concurrency and error/busy states; no React DOM nodes are moved. The app
menu remains available on narrow windows. QA intercepts launch POST requests so
verification does not open external programs on the user's desktop.

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

There is one mutable owner for every official concern. Sandrone deploys managed
plugins and takes a pre-upgrade backup; it never rewrites history, emits SessionEvents,
proxies providers, or assembles a second transcript. A refresh or reconnect goes through the official connection and
session runtime, so long reasoning, tool output and final responses remain recoverable.

## Sandrone Web visual layer

The Web application keeps the official Harness DOM, routes, session projection and
streaming implementation. Sandrone is an out-of-tree visual layer applied through the
public plugin contract:

- `ctx.theme.overrideTokens` supplies the paper, ink, sidebar, border and dark-mode
  tokens without replacing the official theme service.
- `ctx.slots` adds desktop controls, settings and the Buddy panel. Buddy reads a
  bounded visible activity summary, sends through an official companion Session,
  and consumes public `SessionEventStream` history. Local storage holds its session
  association; it is not the authoritative transcript.
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
