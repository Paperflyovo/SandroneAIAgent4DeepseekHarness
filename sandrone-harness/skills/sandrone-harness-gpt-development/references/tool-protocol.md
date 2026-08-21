# GPT Tool Protocol for Sandrone Harness

Use this protocol when a task requires repository inspection, edits, builds,
installation, runtime verification, or Git operations. It addresses the failure
patterns most likely to waste a GPT model's tool calls in this Harness.

## 1. Establish the execution contract

Before the first mutating call:

1. Read the injected filesystem sandbox mode and approval policy.
2. Resolve the repository root and the exact `sandrone-harness` directory.
3. Read every applicable `AGENTS.md`.
4. Run `git status --short` and preserve pre-existing changes.
5. Run `pnpm run preflight` from `sandrone-harness` when project commands are needed.

Classify the next operation:

- **Read-only:** search, read, inspect status, or calculate a report.
- **Idempotent local mutation:** apply a focused source patch or rebuild generated output.
- **External mutation:** install software, publish, push, create a release, or alter a remote.

Do not treat permission to edit as permission for an external mutation. Obtain
the user's explicit authorization before commit, push, release, or installation
unless the current request already grants it.

## 2. Choose sandbox arguments correctly

The Harness only permits a strictly wider sandbox escalation:

```text
read-only -> workspace-write -> danger-full-access
read-only --------------------> danger-full-access
```

Therefore:

- If the current mode is `danger-full-access`, omit `sandbox_permissions` and
  `justification`. There is no wider mode.
- If the current mode is narrower, first attempt the operation using its normal
  permitted mode. Escalate only when the tool rejects an in-scope operation and
  explicitly supports a wider mode.
- When escalating, provide `sandbox_permissions` and a non-empty, concrete
  `justification` together. Retry at most once after correcting the permission.
- Never alternate between `workspace-write` and `danger-full-access` retries.
  An error saying the requested mode is not strictly wider is an argument error,
  not evidence that the repository cannot be changed.

## 3. Use Windows tools predictably

- Use `rg` for content search and `rg --files` for file discovery.
- Do not send Bash brace patterns such as `**/*.{tsx,ts,css}` to Windows glob tools.
- Quote Chinese Windows paths and use `-LiteralPath` with PowerShell file cmdlets.
- Keep individual reads within the tool's 2,000-line limit. Use `-TotalCount`,
  `Select-Object -Skip/-First`, or a narrower `rg` query for large files.
- Use `apply_patch` for source edits. Use project scripts for generated bundles
  instead of manually rewriting compiled files.
- Read each tool result before deciding the next call. Do not issue the same
  failed call again with unchanged arguments.

## 4. Recover from failures by evidence

After a failure, identify its layer before retrying:

| Failure | Next check |
| --- | --- |
| Path not found | Current directory, repository root, exact filename with `rg --files` |
| Read limit | Page or narrow the read; do not raise it beyond 2,000 |
| Invalid tool argument | Tool schema, paired fields, quoting, and current sandbox mode |
| Permission rejection | Whether the current mode is actually narrower and escalation is supported |
| Build failure | First real compiler/test error, dependency/runtime version, generated output freshness |
| Interrupted mutation | Inspect filesystem, process, installer, or Git state before retrying |

After three consecutive tool failures, stop the retry loop. Re-establish the
working directory, tool schema, permissions, and target path, then choose a new
minimal reproduction. Do not start a subagent to route around a local tool error.

## 5. Keep the UI and Electron build fresh

Treat these as separate states:

1. `packages/sandrone-ui/src` source changed.
2. `packages/sandrone-ui/lib/client.js` rebuilt.
3. The managed plugin under the active `DSH_HOME` redeployed.
4. The Harness process restarted or reloaded.
5. Electron loaded the new deployed bundle.

For UI changes, run `pnpm run build:ui`, `pnpm run verify:ui-sync`, the closest
contract test, and `git diff --check`. If the screen still differs from source,
compare timestamps or hashes of the source bundle and deployed plugin before
adding more CSS. Check stale processes and the active `DSH_HOME`; do not assume
Ctrl+R proves that a packaged application was rebuilt.

## 6. Close Git operations safely

Before committing:

1. Run `git status --short`, `git diff --check`, and the relevant tests.
2. Stage only the authorized files, unless the user explicitly requests all
   current project changes.
3. Inspect `git diff --cached --stat` and `git status --short`.
4. Exclude installers, `dist`, screenshots, temporary browser profiles, and
   diagnostics unless the repository intentionally tracks them.
5. Push only when explicitly authorized, then report the commit hash and remote.
