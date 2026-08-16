# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] — 2026-08-16

Stranger-usable install. The extension is still an observer: it does not block
writes, and it still invents no receipts, hashes, or verdicts.

### Added

- GitHub Release workflow that attaches a built `omnis-code-x.y.z.vsix`.
- README install: download that vsix, then
  `code --install-extension omnis-code-0.1.2.vsix`. No Marketplace listing.
- Activation names a missing `omnis-key` and points at `omnisCode.enginePath`.
  The same honesty applies to `omnis-code`, `crucible-scan`, `mts`, and `cairn`.
- Status bar lists missing binaries. No green mark for "binary found".
- `omnisCode.showMissingBinaries` writes the named-binary report to the
  output channel.

### Fixed

- `omnis-code` / `crucible-scan` now resolve beside a configured
  `omnisCode.enginePath`, not only the PATH probe list.
- A turn with no `omnis-code` binary no longer pretends no provider is
  configured.
- CRUCIBLE names `crucible-scan` when that binary is missing, instead of
  implying a scan can be run.
- Claims panel surfaces the missing-engine detail, not only a banner.

## [0.1.1] — 2026-08-02

MAP THE SOUL in the extension. The `mts` CLI remains the only authority on
sealing and verification. Packaged locally; not published.

## [0.1.0] — 2026-08-01

First release.

This extension observes. Every verdict it shows is issued by an external engine
— `omnis-key` for receipts and claims, `mts` for souls — and it computes none of
its own. It does no hashing, sealing, signing, or validating anywhere. It does
not block, intercept, or gate anything.

### Added

**Receipts**

- Tree view (`omnisCode.receipts`) over `omnis-key receipts status --json`.
- Four chain states, branched on the engine's `code` field rather than on `ok`
  or the exit status: `RECEIPT_CHAIN_VALID`, `RECEIPT_CHAIN_INVALID`,
  `RECEIPT_STATE_UNSAFE`, `EMPTY_NOT_YET_EVIDENCED`. The last three all exit 3,
  so a fresh install does not read as a tampered chain.
- Entry count and head SHA-256 under `RECEIPT_CHAIN_VALID`. Ledger entries are
  withheld under every other state.
- `ENGINE UNREACHABLE` and `UNRECOGNIZED ENGINE OUTPUT` as first-class states.
  No state is cached, defaulted, or guessed.
- `omnisCode.receipts.verify` runs `receipts verify --json` and writes the
  engine's raw stdout and exit code to the "OMNIS CODE" output channel.
- `RECEIPT_STATE_UNSAFE` shows an explanation and the exact remedy — `chmod 700`
  over the `$JCODE_HOME` directory chain — copyable via
  `omnisCode.receipts.copyRemedy`.
- `omnisCode.receipts.copyHead` copies the full head hash.
- Debounced `fs.watch` on `$JCODE_HOME/state/omnis-key/`, so a turn run in a
  terminal outside the editor refreshes the panel.

**Claims**

- Tree view (`omnisCode.claims`) over `claims status --json`, with the same
  fresh-install distinction (`EMPTY_NOT_YET_EVIDENCED` is not
  `CLAIM_CHAIN_INVALID`).
- Verdicts in the engine's own vocabulary: `CERTIFIED`, `REFUTED`,
  `REFUSED_NO_VERIFIER`, `REFUSED_UNRESOLVED`, `UNGROUNDED`.
- A refusal gets its own mark (`circle-slash`, neutral colour) — never an error
  or warning icon. Only `REFUTED` renders as a failure.
- `omnisCode.claims.showRefusal` runs `claims verify --refuse-demo --json`.

**Turns**

- `omnisCode.run` runs one OMNIS CODE turn: provider chosen explicitly from
  `omnis-code auth status`, prompt entered in the editor, NDJSON streamed to the
  output channel, cancellable.
- `buildTurnArgs` is the single place a turn command line is built. It rejects
  `--provider auto` (the CLI default, and ambient credential discovery) and
  never emits `--receipt-full-argv` or `--no-receipts`.

**CRUCIBLE**

- Tree view over the newest stored scan in `~/crucible-scans`, matched to the
  workspace folder name.
- `omnisCode.crucible.scan` runs an explicit, cancellable repository scan
  (30–150s). Nothing runs on save or on keystroke.
- Findings open at `file:line`; absolute and traversing paths are rejected.
- Results always carry the age of the scan they came from. An unreadable scan
  timestamp reads as "scan time unknown", never as current; scans older than
  24 hours are called out.
- Scan success is never inferred from the exit code — `crucible-scan` exits 0 on
  a bad argument.

**CAIRN**

- Registered as an MCP server definition via
  `lm.registerMcpServerDefinitionProvider` when the server script is present.
  No ask/answer panel: VS Code exposes no MCP *client* API to extensions, so a
  panel would have to invent what it displayed.

**MAP THE SOUL**

- Tree view (`omnisCode.souls`) listing sealed soul packages, each with the
  verdict `mts soul-verify <soul_id> --json` gives it. Listing a soul is a
  directory read and carries no verdict; nothing renders as sound until the CLI
  has spoken about it.
- Four verify outcomes kept distinct, verified against three real souls:
  operator-signed (the engine names a key), hash-sealed, hash-sealed with a
  missing signature, and a failed bedrock or chain. A pre-SIGNET soul —
  grandfathered because it was sealed before any trusted key existed — verifies
  and is never reported as tampered. A missing signature over an intact chain is
  reported as a signature problem, not as tampering.
- `operator-signed` is reachable from exactly one place in the code and only
  when the engine names a signing key. A hash-seal proves provenance, not
  authenticity, and is never described as signed.
- A soul-authoring wizard (`omnisCode.souls.author`) covering the CLI's five
  acts. It emits an answers file, shells out to `mts new-soul
  --non-interactive --json`, and renders the result — including refusals.
- The engine's refusal to birth a soul with fewer than three specific refusals
  is rendered verbatim as a first-class verdict. No axiom is suggested,
  pre-filled, or generated; there is no skip; and the seal action is not
  disabled below three axioms, so the engine always gets to refuse in its own
  words rather than being pre-empted by the UI.
- Refusals are distinguished from failures by the engine's `refused` flag, never
  by the exit code — `mts` exits 1 for both.
- `omnisCode.souls.verify` runs verification on demand and puts the engine's own
  verdict on the glass, including when it fails.
- `omnisCode.mtsPath` and `omnisCode.soulsDir` locate the CLI and the soul
  packages.

**Engine resolution**

- Probes `$OMNIS_CODE_ENGINE_PATH`, `~/.local/bin`, `~/.cargo/bin`,
  `/usr/local/bin`, and `/opt/homebrew/bin`, because an editor launched from the
  Dock or Finder on macOS does not inherit the login shell `PATH`.
- `omnisCode.enginePath` overrides the probe and takes effect without a reload.
- `omnisCode.cairnServerScript` and `omnisCode.cairnUrl` locate CAIRN.

### Security

- Receipt evidence passes a strict allowlist: `argv_program`, `tool`, `target`,
  `exit_code`, and the two content hashes. A denylist would leak the first field
  a future engine version adds.
- Paths are reduced to basenames; hashes to their leading hex characters.
- The claim ledger's `verification.evidence` carries full argv, stdout/stderr
  excerpts, and an absolute cwd. The claims view reads two scalars out of it —
  `verifier` and `exit_code` — and drops the rest.
- Token-shaped strings (`sk-…`, `ghp_…`, `Bearer …`, `AKIA…`) are replaced with
  `[redacted]` even in fields otherwise trusted.
- Soul answers carry personal content. They are written to a private temp file
  with `0600` permissions, passed to the CLI, and removed in a `finally`. They
  are never logged, cached, or echoed to the output channel.
- The soul wizard's webview runs under a strict CSP with a per-render nonce and
  no remote content.
- No runtime dependencies and no bundled third-party code. Build-time
  dependencies are TypeScript and type definitions only.

### Notes

- Protocol behaviour verified against `omnis-key` 0.1.0 on 2026-08-01.
- Requires the `omnis-key` engine. Turns additionally require `omnis-code`, and
  scans require `crucible-scan`, both resolved as siblings of `omnis-key`.
- Not published to Open VSX or the Visual Studio Marketplace; distributed as a
  packaged `.vsix`.
- Verified only on the machine it was built on. A clean install on another
  machine is unproven.
