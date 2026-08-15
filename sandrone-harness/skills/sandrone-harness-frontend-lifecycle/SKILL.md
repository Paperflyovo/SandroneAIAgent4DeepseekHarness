---
name: sandrone-harness-frontend-lifecycle
description: Design, implement, diagnose, or review Sandrone and other DeepSeek Harness Web/Electron client extensions while preserving the official Harness lifecycle, session projection, streaming, reconnect, settings, Slot, and plugin contracts. Use for Harness client plugins, UI state ownership, long-response rendering, history paging, refresh recovery, stale async work, hot reload cleanup, or frontend backports based on DeepSeek Harness patterns.
---

# Sandrone Harness Frontend Lifecycle

Keep DeepSeek Harness authoritative for business state and transport. Add presentation through its public client extension points, with every resource tied to one reversible lifetime.

## Load The Needed Evidence

- Read [references/deepseek-runtime-evidence.md](references/deepseek-runtime-evidence.md) before choosing Harness APIs, state owners, streaming behavior, or reconnect behavior.
- Read [references/spatiotemporal-composability.md](references/spatiotemporal-composability.md) when designing lifecycle boundaries, async work, hot reload, or Electron process integration.
- Read [references/review-checklist.md](references/review-checklist.md) before reviewing or declaring an implementation complete.

Re-check the installed Harness version and exported package surfaces. Treat source observations as evidence, not as permission to import private `src/*` paths.

## Establish Ownership First

Write an ownership table before editing code. Give every value and effect exactly one owner.

| Concern | Owner |
| --- | --- |
| Provider, model, credential, permission, Session, Workspace, durable history | Harness Host |
| Connection generation, history window, partial Assistant, projections, queue, settings mirror | Harness client runtime |
| Slot placement, theme presentation, component-local interaction | Client plugin |
| Electron window and supervised Harness process | Electron shell |

Consume the official owner instead of mirroring it. Do not add a second WebSocket, protocol client, event fold, history database, Provider store, refresh loop, or session projection. Keep plugin persistence limited to genuinely presentation-only preferences.

## Build Through Public Contracts

1. Declare the package root entry and browser `./client` export.
2. Declare `dsh.client.platform: web` and package-id dependency edges in `dsh.client.inject`.
3. Make the browser bundle register with the Harness module loader.
4. Export Cordis `inject` names for services the browser plugin actually reads.
5. Contribute to another package's UI with `ctx.slots.inject(key, () => ctx.slots.register(...))`.
6. Override only public `--dsw-*` theme tokens and provide both light and dark values.

Keep branding, Buddy, and desktop affordances additive. Never replace the root runtime merely to change appearance.

## Consume State Without Rebuilding It

- Read observable state through Harness-provided selector hooks. Select the smallest stable slice and use an equality function only when it is correct for that slice.
- Keep `subscribe` and `getSnapshot` identities stable. Do not construct subscriptions during arbitrary renders.
- Read domain projections through `useProjection`; treat `undefined` as capability absence.
- Let the official runtime fold wire events, maintain sequence watermarks, page history, and repair gaps.
- Keep durable finalized nodes and the in-flight Assistant projection separate. Render text, reasoning, tool calls, terminal errors, interruption, and max-token endings without collapsing one into another.
- Represent initial history loading, older-page loading, and end-of-history separately. Prepending older rows must preserve existing keys, scroll position, and streamed content.

## Own Every Effect

Use Cordis-managed registrations when available. Wrap every unmanaged listener, timer, observer, request, worker, IPC subscription, and process handle in `ctx.effect()` and return its disposer.

For asynchronous work:

1. Capture an owner generation or request id.
2. Pass an `AbortSignal` through every cancellable boundary.
3. After each `await`, reject results from an aborted or stale generation.
4. Serialize writes that share a revision or durable namespace.
5. Make disposal idempotent and bounded; await quiescence where the API promises it.

If cleanup steps require order, perform and await them inside one disposer. Do not rely on ordering between separate async disposers.

## Recover By Convergence

Let Harness reconnect and replay authoritative baselines. On generation loss, clear only generation-scoped transient state; retain no optimistic result that can outrank a fresh baseline. Apply sequence-bearing values under the upstream ordering rule, and let later authoritative snapshots replace local loading or error states.

Do not use polling or page reload as correctness machinery. A reload, reconnect, plugin unload/reload, and clean boot must converge to the same observable state.

## Execute The Change

1. Identify the public package exports, Slot declaration, services, and snapshot fields for the target Harness version.
2. Record ownership, lifecycle, failure, reload, and capability-absent behavior.
3. Implement the smallest additive plugin change.
4. Test normal flow plus stale response, cancellation, reconnect, history prepend, long stream, disposal, redeclaration, and failed dependency cases.
5. Run the repository's architecture checks, type checks, unit tests, Web smoke test, and Electron smoke test when applicable.
6. Review every item in the checklist and report any unverified boundary explicitly.

Reject a design that can display state the current Harness generation no longer owns, lose finalized output after refresh, leave an effect alive after unload, or require private Harness imports.
