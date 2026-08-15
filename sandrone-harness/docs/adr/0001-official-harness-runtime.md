# ADR 0001: Official Harness Is the Runtime

## Decision

Use the published DeepSeek Harness Web profile as the only backend and client runtime.
Compose Sandrone through out-of-tree Cordis client plugins and supervise the official
loopback host from Electron.

## Consequences

- Provider/model/API-key behavior follows upstream updates automatically within the
  pinned package family.
- Long-output recovery, history replay and reconnect semantics are not duplicated.
- Sandrone visual changes are constrained to public Slots and ThemeRuntime APIs.
- A future upstream upgrade is a package-family and contract review, not a backend fork.
