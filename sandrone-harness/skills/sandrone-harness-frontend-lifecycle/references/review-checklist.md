# Frontend Lifecycle Review Checklist

Use this checklist for implementation and review. Treat unchecked ownership, lost output, stale publication, leaked effects, private imports, and duplicated Harness state as blocking findings.

## Contract And Ownership

- [ ] Record the exact Harness package version or commit used for verification.
- [ ] Import only published public exports in external plugins; scan for dependency `src/*` imports.
- [ ] Keep Provider, model, credentials, permissions, Sessions, Workspaces, history, projections, and settings Host-owned.
- [ ] Keep connection, paging, stream accumulation, and reconnect projection in the official client runtime.
- [ ] Limit plugin-owned persistence to presentation-only state and namespace it.
- [ ] Declare package dependency edges separately from browser Cordis service injection.

## Client Plugin And Slots

- [ ] Provide the Host entry, `./client` export, Web client metadata, and module-loader registration.
- [ ] Declare only Cordis services the client plugin reads.
- [ ] Use `ctx.slots.inject` for a Slot declared by another package.
- [ ] Verify unload removes every Slot row, child declaration, store mount, style, and theme override.
- [ ] Verify declaration collapse and redeclaration remove and reinstall the contribution exactly once.
- [ ] Contain one plugin component failure without hiding framework assembly failures.

## State And React

- [ ] Read official bare observables through provided selector hooks.
- [ ] Keep source, `subscribe`, and `getSnapshot` identities stable across renders.
- [ ] Select narrow values and preserve unchanged references.
- [ ] Keep missing optional capability distinct from loading, empty data, and error.
- [ ] Avoid copying an official snapshot into component state unless editing an explicit draft.
- [ ] For drafts, reconcile Host revision conflicts without overwriting newer durable state.

## Streaming And Long Responses

- [ ] Exercise text, reasoning, tool-call, usage, finish, retry, abort, error, and max-token paths.
- [ ] Keep in-flight partial output separate from finalized durable nodes.
- [ ] Ensure a final message atomically supersedes its partial without a blank frame or duplicate.
- [ ] Keep all intermediate user-visible process output available when the product requires it.
- [ ] Confirm long content wraps, scrolls, virtualizes, and does not push status controls outside their container.
- [ ] Refresh during and after a long response; finalized output and terminal state must reappear from Harness history.

## History And Reconnect

- [ ] Distinguish initial loading, background refresh, loading older, end of history, reconnecting, and recoverable error.
- [ ] Prepend older history without replacing existing row keys or jumping the viewport.
- [ ] Replay frames that arrive during a baseline request over that response.
- [ ] Apply sequence-bearing projection values under the upstream higher-sequence-wins rule.
- [ ] Clear generation-scoped interactions on disconnect and rebuild them from the next authoritative replay.
- [ ] Prevent late responses and removed-entity frames from resurrecting stale state.
- [ ] Do not add polling or forced page reload as the primary repair path.

## Effects And Async Work

- [ ] List every listener, timer, observer, request, worker, Slot registration, IPC handler, and process.
- [ ] Give each acquisition one owning lifetime and a concrete disposer.
- [ ] Abort cancellable work and guard every post-await publication with owner generation or request identity.
- [ ] Make cleanup idempotent and verify repeated disposal.
- [ ] Put teardown that requires ordering into one awaited disposer.
- [ ] Verify disposal reaches quiescence: no callbacks, writes, registrations, timers, or processes remain.
- [ ] Test setup failure after partial acquisition and confirm rollback.

## Theme And Presentation

- [ ] Override public semantic tokens instead of replacing the theme service.
- [ ] Supply light and dark values for every overridden token.
- [ ] Preserve system preference and the official initial no-flash theme bootstrap.
- [ ] Respect reduced motion and keyboard/focus behavior.
- [ ] Verify narrow sidebars, long project titles, compact windows, and high zoom without overlap.

## Electron Carrier

- [ ] Bind the official Harness Web server to loopback on a non-conflicting port.
- [ ] Restrict in-window navigation to the active loopback origin; open allowed external HTTP(S) links outside the app.
- [ ] Keep `contextIsolation` enabled, Node integration disabled, and preload IPC minimal.
- [ ] Use one process generation for readiness, logs, failure, restart, and exit events.
- [ ] Bound restart backoff and avoid restart storms during intentional shutdown.
- [ ] Store Harness data under stable user data, outside the installation directory, so upgrades preserve it.
- [ ] Close the app with no residual Harness process.

## Verification Evidence

- [ ] Run architecture and private-import scans.
- [ ] Run type checks and focused unit tests for every changed state transition.
- [ ] Run Web smoke tests against the real official runtime.
- [ ] Run Electron desktop and compact-window smoke tests when applicable.
- [ ] Exercise unload/reload, reconnect, stale async completion, history paging, long streaming, and failed startup.
- [ ] Record tests not run and residual risk; do not translate missing evidence into confidence.
