# DeepSeek Harness Runtime Evidence

Use this as a source map, not a frozen substitute for upstream documentation. The observations were taken from DeepSeek Harness commit `47f943859bef60e4160492346772ded9b24f765a` (`0.1.0-rc.5` source); the Sandrone distribution resolves the runnable package family at exact `0.1.0-rc.6`. Verify exports and behavior again when upgrading.

## Compatibility Boundary

- `docs/subsystems/client-modules.md` defines the Host-to-browser plugin graph. A client package has a package-root Host entry, exports `./client`, declares `dsh.client.platform = "web"`, and lists package-id dependency edges in `dsh.client.inject`.
- The served browser bundle self-registers with `window.__ModuleLoader__.load({ id, factory })`. The graph row id equals the package name. Browser `export const inject` values are Cordis service names, not package ids.
- The graph and bundle content hashes are cache consistency anchors. A page boots against one injected graph; reload obtains the live graph.
- Published package contents, not repository paths, define the external contract. Do not import a dependency's `src/*` merely because its source checkout exposes that path.

Relevant sources:

- `docs/subsystems/client-modules.md`
- `packages/client/modules/README.md`
- `packages/client/web/README.md`

## Cordis Effects And Quiescence

`docs/cordis-tutorial/02-lifecycle-and-effects.md` establishes these rules:

- A plugin can unload after configuration changes, hot reload, explicit disposal, or loss of a required service.
- Cordis registrations such as `ctx.on`, `ctx.plugin`, service registration, and Harness registry registration are effects owned by the calling fiber.
- Put unmanaged resources in `ctx.effect()` and return the release function.
- `fiber.dispose()` resolves after recursive cleanup, including async cleanup, completes.
- Disposers begin in reverse registration order, but separate async disposers may overlap. Put ordered teardown in one disposer.

This is the basis for treating disposal as a testable quiescence claim, not a best-effort callback.

## Slot Lifetime And Failure Containment

`packages/client/runtime/README.md` and `packages/client/ui-slots/README.md` define the extension pattern:

- `ctx.slots.inject(name, callback)` waits for the actual Slot declaration, runs synchronously while it exists, disposes the callback effect when the declaration collapses, and runs it again after redeclaration.
- The injection controller belongs to the contributor's fiber, so contributor unload cancels both pending and active work.
- A callback can return one disposer or an iterable of disposers. A generator supports transactional multi-registration rollback.
- Direct registration into an undeclared Slot is an error.
- Disposing an entry recursively collapses its child declarations and releases their registrations and store mounts.
- Render bindings reject stale authorization after a registration is disposed. Per-entry boundaries contain registrant failures without turning framework misassembly into a silent blank page.

Use the Slot lifecycle instead of guessing plugin order or retaining a component after its declaration owner disappears.

## Observable State And React

`packages/client/web-react/src/bind.ts` and `session-provider.tsx` show one React binding model:

- Runtime and Host objects expose bare `getSnapshot` / `subscribe` sources.
- React binds those sources with `useSyncExternalStoreWithSelector`.
- The bridge captures stable closures once per source. Source-to-hook caches prevent unsubscribe/resubscribe churn during unrelated renders.
- Selectors read a narrow value; identity changes represent publication. Missing session or projection capability is represented without changing hook order.

Business plugins should consume the provided hooks and standard Slot props. They should not create a parallel React store over the same Harness state.

## Session Projection And Sequence

`docs/subsystems/session-projection.md` and `packages/client/runtime/src/client/sessions/projection-store.ts` establish the projection contract:

- The Host is the sole computation site for log-derived domain projections. Clients receive schema-validated whole current values, not domain deltas to fold.
- A tail history page can carry a consistent projection baseline with an `asOfSeq` watermark. Live `session/projection` frames carry one whole value and its sequence.
- The client applies one ordering law: higher sequence wins. A replayed frame or stale baseline cannot regress a newer row.
- An omitted key at an authoritative cut means capability absence unless a newer frame already superseded that cut.
- A reconnect baseline may truncate values that claim sequence beyond the Host's durable `lastSeq`; surviving data is restored by replay and fresh baselines.

Use this pattern for state already represented by Harness projections. Do not duplicate the fold in a component or Electron layer.

## History, Streaming, And Finalization

`packages/client/runtime/README.md`, `packages/client/runtime/src/client/sessions/partial.ts`, and the conversation/trajectory packages provide these patterns:

- One Session owns a contiguous event window plus explicit `openState`, `hasMore`, and `loadingOlder` state.
- Live append updates the affected conversation context. Loading an older page prepends events while preserving existing context, node, and row identity; full rebuild is reserved for open, resync, and gap repair.
- Assistant stream chunks accumulate by block index into text, reasoning, and tool-call blocks. Usage and finish chunks do not invent visible blocks.
- In-flight partial output is distinct from durable finalized Assistant nodes. Final messages and turn closure publish immediately; partial visual updates may be frame-batched.
- Retry, interruption, terminal errors, and max-token endings are log-derived presentation states. Refresh and history replay must reconstruct them without resurrecting discarded chunks or hiding retained output.

For long responses, test every visible channel and the transition from partial to final. Never make the task/status area the only owner of generated content.

## Reconnect, Lists, And Settings

`packages/client/runtime/README.md` and `packages/host/apiproxy/README.md` document convergence patterns:

- Workspace and Session lists have independent monotone baseline phases plus separate refresh activity and error state.
- Increments arriving during a baseline request replay over the response. Tombstones prevent late frames from resurrecting removed entities.
- Generation-scoped pending interactions clear on disconnect and rebuild from replay on the next mux generation.
- `connection/reset` tells wire-derived caches to repull. It is not a reason for every component to build a reconnect loop.
- `bindSettingsScope` subscribes before its nonblocking initial read, serializes writes against the latest namespace revision, suppresses stale publications, recovers a rejected latest write from Host state, and reaches quiescence on disposal.
- Configuration invalidation is push-driven. Provider, model, credential, and settings state remain Host-owned; remote pages may have fewer capabilities than loopback pages.

Separate `pending`, background refresh, recoverable error, and ready-with-stale-data states. Never erase useful state merely because a refresh started.

## Theme Extension

`packages/client/ui-theme/README.md` makes semantic `--dsw-*` tokens the color authority. A theme override must define both light and dark values for every token it changes. The official runtime owns theme preference, Host persistence, system resolution, and initial no-flash bootstrap. A distribution plugin should override tokens; it should not create another theme preference service.
