# Spatiotemporal Composability

This reference operationalizes the supplied paper's composability philosophy for a Harness frontend. It does not copy a framework from the paper. It turns the central idea into engineering invariants: parts must compose across ownership boundaries in space and across load, use, failure, and disposal in time.

## Two Axes

Spatial composition asks which subsystem owns a capability and how another subsystem reaches it. Use one public, versioned seam for each dependency. Avoid shared hidden state and duplicated authorities.

Temporal composition asks what happens before activation, during updates, after failure, during replacement, and after disposal. A feature is incomplete unless every acquired resource has a defined inverse and stale work cannot publish after its lifetime.

## Laws

### Single Authority

Assign one owner to each durable fact, live projection, and side effect. Consumers read or request changes through that owner's public contract. Two independent stores for one fact cannot be made reliable by adding more refreshes.

### Reversible Acquisition

Model each acquisition as an effect pair:

```text
acquire resource -> publish capability -> stop publication -> release resource
```

Listeners unsubscribe, timers clear, observers disconnect, requests abort, Slot entries unregister, IPC handlers detach, and child processes terminate. The disposer belongs to the same lifetime that acquired the resource.

### Quiescent Disposal

Disposal is complete only when the owner can no longer publish, mutate, or retain work. Make disposal idempotent. Bound external shutdown, but do not call a timeout result "clean" unless any remaining resource is forcefully contained.

### Generational Isolation

Tag asynchronous work with the connection, component, request, or process generation that started it. Abort it when possible and check the generation after every await. A result from generation N must never overwrite generation N+1.

### Convergent Replay

A clean boot, refresh, reconnect, and unload/reload should converge to the same state from the same authoritative history. Prefer replayable events, whole-value baselines, monotonic sequence watermarks, stable ids, and idempotent application.

### Consistent Cuts

When related values must agree, read or publish them at one explicit watermark. Do not combine a new projection with an old history page and present the mixture as current. Apply lower-or-equal sequence data as a no-op when a newer cut is already installed.

### Local Change

Update only the identity and projection affected by an event. Preserve unchanged object and row identity. Paging older history, streaming one block, changing a theme token, or replacing one Slot contribution should not remount unrelated surfaces.

### Explicit Absence

Treat a missing optional capability as a normal state. Render a disabled or absent affordance rather than starting a competing implementation. Treat a missing required framework service as a loud assembly failure.

### Bounded Failure

Contain failures at the smallest owner that can recover: one request, Slot entry, plugin fiber, connection generation, or supervised process. Keep the last valid durable view while refresh fails when that view remains truthful. Expose a retry at the owner boundary.

## Lifecycle Worksheet

For each feature, answer:

| Question | Required answer |
| --- | --- |
| What is acquired? | Exact listeners, registrations, timers, requests, handles, styles, or processes |
| Who owns it? | One fiber, component effect, request, window, or process supervisor |
| When is it visible? | Only after dependencies and authoritative state are ready |
| What invalidates it? | Disposal, dependency loss, new generation, revision conflict, or user action |
| What is its inverse? | Concrete synchronous or awaited cleanup |
| What proves quiescence? | Testable absence of callbacks, registrations, writes, and child processes |
| How does it rebuild? | Authoritative baseline plus replay, not retained hidden state |

## Async Publication Pattern

Use this shape when a public Harness helper does not already own stale-result suppression:

```ts
ctx.effect(() => {
  const controller = new AbortController()
  const generation = currentGeneration()

  void load({ signal: controller.signal }).then(value => {
    if (controller.signal.aborted) return
    if (generation !== currentGeneration()) return
    publish(value)
  }, error => {
    if (!controller.signal.aborted && generation === currentGeneration()) publishError(error)
  })

  return () => controller.abort()
})
```

Prefer an upstream scope, settings binding, selector hook, or request helper when it already implements this law.

## Electron Mapping

Treat the Electron window and Harness runtime as separate lifetimes connected by a narrow carrier:

- The Harness process owns Host data and protocol behavior.
- Electron owns process supervision, the BrowserWindow, navigation policy, and native IPC.
- Renderer IPC exposes bounded commands and immutable status snapshots, not raw Node access.
- Window reload does not restart or fork business state accidentally.
- App shutdown stops new work, closes the carrier, requests graceful process exit, waits to a deadline, then contains any survivor.
- Process generation ids prevent logs, readiness, and exit events from an old child from changing the new child's UI.

The same laws apply to Web hot reload, but the acquired resources are browser-side effects rather than OS processes.
