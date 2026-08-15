# Cross-platform Electron sandbox

> Research date: 2026-08-15
> Scope: unsigned Windows, macOS and Linux sandbox artifacts for x64 and arm64; no automatic GitHub Release publication.

## Decision

Build on a runner whose operating system and CPU match the artifact. Each runner installs the locked dependencies, runs the common build and tests, selects one platform-owned Electron Builder profile, and refuses the package if its target `node-pty` binary is absent. Cross-compilation is outside this sandbox because it can combine the wrong Electron distribution or native dependency set with an apparently valid installer.

```text
package.json
  -> scripts/package-desktop.mjs
  -> scripts/lib/desktop-platform.mjs
  -> apps/desktop/electron-builder.<platform>.yml
  -> electron-builder
  -> apps/desktop/verify-native-artifacts.cjs
  -> unsigned sandbox artifact
```

The application lifecycle stays owned by `apps/desktop/main.cjs`: one Electron process supervises one official `dsh web` child, renderer trust remains loopback-only, shutdown remains bounded and idempotent, and data stays under Electron `userData` on every platform.

## Public references

| Repository | Score | License | Observed evidence | What we use | What we do not copy |
| --- | ---: | --- | --- | --- | --- |
| [`Molunerfinn/PicGo`](https://github.com/Molunerfinn/PicGo) | 93/100 | MIT | Active, 26.9k stars, updated 2026-08-14. `.github/workflows/main.yml` uses native x64/arm64 runners for Windows, macOS and Linux, installs dependencies on each runner, then invokes Electron Builder with an explicit OS and architecture. | Native runner matrix and short-lived artifact staging. | Signing services, deployment infrastructure and product-specific upload jobs. |
| [`ipfs/ipfs-desktop`](https://github.com/ipfs/ipfs-desktop) | 88/100 | MIT | Active, 6.5k stars, updated 2026-08-13. `electron-builder.yml` owns per-platform targets; `.github/workflows/ci.yml` runs test and build matrices on Windows, macOS and Linux and keeps signing conditional on available credentials. | Separate test/package phases and unsigned fallback as an explicit state. | Auto-update, protocol registration, IPFS daemon packaging and release automation. |
| [`open-webui/desktop`](https://github.com/open-webui/desktop) | 84/100 | AGPL-3.0 | Active, 2.5k stars, updated 2026-08-15. `electron-builder.yml` declares Windows, DMG/ZIP and AppImage/DEB targets and handles `node-pty`; `.github/workflows/release.yml` packages six OS/architecture combinations on native runners. | Evidence that PTY packaging and six-way matrices need deliberate platform treatment. | No source or configuration text is copied; AGPL code is observation-only, and its release/update complexity is deferred. |

Evidence level is `Observed` for the repository metadata and named public files read through the GitHub API on the research date. Scores are recommendations under the local GitHub research rubric, not repository facts. No third-party repository was cloned, installed or executed.

## Platform policy

| Platform | Sandbox outputs | Native dependency policy | Current verification |
| --- | --- | --- | --- |
| Windows x64/arm64 | NSIS | Use package-provided `node-pty` prebuilds. Keep `npmRebuild: false` because rebuilding requires an optional Visual Studio Spectre toolchain. | Windows x64 config, unpacked package, PTY gate and 16-check desktop QA pass locally. Windows arm64 awaits its native runner. |
| macOS x64/arm64 | DMG, ZIP | Use package-provided `node-pty` prebuilds and the Electron distribution installed on the matching Mac runner. | Static configuration and executable-path tests pass. Native runner, Gatekeeper and TCC verification remain pending. |
| Linux x64/arm64 | AppImage, DEB | Rebuild native dependencies sequentially; `node-pty` has no Linux prebuild in the pinned package. Install compiler, Python, pkg-config and FUSE prerequisites first. | Static configuration and artifact expectations pass. Native runner, terminal and sandbox verification remain pending. |

## Sandbox workflow

`.github/workflows/desktop-cross-platform.yml` is manual, read-only and cannot create a Release. It uploads unsigned artifacts for 14 days. This first phase intentionally excludes Apple notarization, Windows signing, Linux repository publication, auto-update manifests and promotion to `latest`.

Promotion requires all of the following on each native platform:

1. Builder configuration loads and produces the expected artifact.
2. The afterPack native-artifact gate passes.
3. The application reaches the official loopback Harness UI.
4. First-run onboarding, top-bar Workspace selection and renderer reload persistence pass.
5. Terminal creation and one command round trip pass on the platform's default shell.
6. Graceful close removes the Harness child and loopback server.

Signing and notarization are separate release authority. The sandbox never treats an unsigned build as production-ready merely because it launches.
