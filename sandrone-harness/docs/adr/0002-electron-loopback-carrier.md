# ADR 0002: Electron Supervises a Loopback Web Host

## Decision

Electron starts `dsh web` with `--port 0`, waits for the official readiness line, and
loads the resulting `http://127.0.0.1:<port>` URL. It does not invent a second RPC or
message transport.

## Consequences

- Browser and desktop use the same Harness connection, settings and persistence.
- The supervisor owns bounded restart and deterministic shutdown.
- Renderer security can stay strict because the page does not need Node access.
- A future `file://` bridge would require a separate compatibility review.
