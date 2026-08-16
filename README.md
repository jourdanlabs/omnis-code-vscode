# OMNIS CODE — AI agent receipts

**Proves what it did, or refuses to say.**

Agent actions run through the `omnis-key` engine leave a tamper-evident receipt
chain behind. This extension shows you that chain inside the editor — and, with
MAP THE SOUL, the sealed identity of the agent doing the work.

Identity sealed. Actions receipted. One environment.

> Scope: the panels read the ledgers written by `omnis-key`. An agent that does
> not run through that engine writes no receipts, and there is nothing here for
> this extension to show.

---

## Install

This extension is not listed on the Visual Studio Marketplace. Download
`omnis-code-0.1.2.vsix` from the
[latest GitHub Release](https://github.com/jourdanlabs/omnis-code-vscode/releases/latest),
then:

```bash
code --install-extension omnis-code-0.1.2.vsix
```

Or use the Command Palette: **Extensions: Install from VSIX…**

The panels still need the `omnis-key` engine (and, for each extra surface, its
own binary). A missing binary is reported by name, with the setting that locates
it. That report is the correct outcome, not a broken install.

---

## What this extension does

**Receipts** — the live chain state (`RECEIPT_CHAIN_VALID`, `RECEIPT_CHAIN_INVALID`,
`RECEIPT_STATE_UNSAFE`, `EMPTY_NOT_YET_EVIDENCED`) with entry count and head hash;
the recorded receipts themselves; on-demand verification showing the engine's real
output and exit code; and a stated remedy for an unsafe state directory rather than
a bare red dot.

**Claims** — verdicts in the engine's own vocabulary: `CERTIFIED`, `REFUTED`,
`REFUSED_NO_VERIFIER`, `REFUSED_UNRESOLVED`, `UNGROUNDED`.

> A refusal is a **successful** outcome. When the ledger answers
> `REFUSED_NO_VERIFIER` to *"this is faster"*, it is declining to assert something
> it cannot ground. That renders as a verdict with its own mark — never an error
> icon, never a warning triangle. Only `REFUTED` — a claim the codebase actually
> disproved — reads as a failure.

**Turns** — run one OMNIS CODE turn from the editor and watch the receipt appear.
The panel watches the ledger directory, so a turn run in a terminal outside the
editor moves it too. (On a fresh install that directory does not exist yet, so
auto-refresh begins once the first receipt is written.)

**CRUCIBLE** — an explicit, cancellable repository scan, and a results view over
the stored scan.

**CAIRN** — contributed to VS Code natively over MCP, when CAIRN is installed
where the extension can find it. If it is not, nothing is contributed rather
than a definition that cannot start.

**MAP THE SOUL** — author, seal, and verify an agent's identity without leaving
the editor. Souls on this machine are listed with the verdict `mts soul-verify`
gives them, and a soul that fails verification renders as failed.

> **The `mts` CLI is the only authority.** This extension computes nothing: it
> asks the questions, hands the answers to the CLI, and renders whatever comes
> back. It does no hashing, sealing, signing, or validating of its own, so there
> is only ever one implementation of what a soul is.

> **A refusal is the product.** The engine will not birth a soul with fewer than
> three specific refusals. The wizard does not suggest axioms, does not offer an
> example, and has no skip — if you have none to give, no soul is created and
> the engine's refusal is shown verbatim. That is the correct outcome, not an
> error to be worked around.

**Sealed is not signed.** A hash-seal proves provenance; an operator signature
proves authenticity. They are different claims and the panel never conflates
them — `operator-signed` appears only when the engine names a signing key.

## What this extension does not do

**An extension can observe. It cannot gate.**

This extension does not block writes, does not intercept your agent, and does not
stop anything from touching your disk. The VS Code extension API gives no extension
that power — not this one, not any other. It reads the receipt chain and shows you
what it says.

If the chain is broken, you will see that it is broken. Nothing was prevented.
That distinction is the honest one, and we would rather state it plainly than let
the panel imply otherwise.

**There is no CAIRN ask/answer panel.** VS Code lets an extension publish MCP
*server definitions*, not call MCP tools itself. A panel would have to
re-implement the transport, and anything it displayed while CAIRN Studio was down
would be invented. So the extension registers CAIRN and lets the chat surface do
the asking.

**CRUCIBLE is a report, not a linter.** A scan reads a whole repository and takes
30–150 seconds, so nothing runs on save or on keystroke. Results come from the last
stored scan and always carry its age. A scan whose timestamp cannot be read says
so, rather than appearing current.

## The four states

Three of these exit non-zero, and they do not mean the same thing:

| State | Meaning |
|---|---|
| `RECEIPT_CHAIN_VALID` | Every entry hashes to its successor. |
| `RECEIPT_CHAIN_INVALID` | The ledger does not match its own hash chain. Entries are withheld. |
| `RECEIPT_STATE_UNSAFE` | The ledger directory is readable by other users; the engine declines to trust it. The panel shows the exact fix. |
| `EMPTY_NOT_YET_EVIDENCED` | Nothing recorded yet. **A new install, not a broken chain.** |

Receipt entries are shown only under `RECEIPT_CHAIN_VALID`. Under any other state
they are withheld, because they carry no verdict of their own.

## Requirements

The `omnis-key` engine must be installed. Individual features need more:

| Feature | Also requires |
|---|---|
| Receipts, Claims | `omnis-key` |
| Turns | `omnis-code`, resolved beside `omnis-key` |
| CRUCIBLE | `crucible-scan`, resolved beside `omnis-key` |
| MAP THE SOUL | the `mts` CLI |
| CAIRN | a CAIRN install the extension can locate |

A feature whose binary is missing says so. None of them invent a result.

VS Code launched from the Dock or Finder on macOS does not inherit your shell
`PATH`, so a user-local install at `~/.local/bin` may be invisible to it. If a
panel reports the engine unreachable, set:

```jsonc
"omnisCode.enginePath": "/Users/you/.local/bin/omnis-key",
"omnisCode.mtsPath": "/Users/you/.local/bin/mts"
```

**Authoring a soul requires an operator signing key** in your login keychain.
Without one, `mts` refuses to seal — the extension shows that refusal rather
than producing an unsigned soul, because working around it would mean forking
the engine's rules.

## Privacy

**What the panels render** passes a strict allowlist: a program name, a tool
name, an exit code, and truncated hashes. Paths are reduced to basenames and
token-shaped strings are replaced with `[redacted]`.

**What the output channel shows is different, and deliberately so.** Verify,
turns, scans, and soul authoring write the engine's real output to the "OMNIS
CODE" channel, unfiltered — that is the point of it, since a verdict you cannot
read is a verdict you have to take on faith. Be aware of what that includes:

- The **claim** ledger is *not* redacted at source the way the receipt ledger
  is. Its `verification.evidence` carries full argv, stdout/stderr excerpts, and
  an absolute path. The claims panel reads two scalars out of it and drops the
  rest, but `Show me a refusal` prints the engine's raw JSON to the channel.
- A CRUCIBLE scan prints the absolute path it was given, and the scanner's own
  output.
- A turn prints the agent's streamed output, which can contain file contents.

This extension writes nothing into your project and sends nothing over the
network itself. It writes exactly one file, and only while authoring a soul: the
answers you typed go to a private temp file with `0600` permissions, are passed
to the CLI, and are deleted immediately afterwards. They are never logged, never
cached, and never printed to the output channel.

**A turn does leave your machine** — `omnis-code` sends your prompt to whichever
model provider you explicitly select. That is the agent doing its job, not the
panel, but it belongs in a privacy section.

## License

MIT, © 2026 JourdanLabs. See the `LICENSE` and `NOTICE.md` files.

This extension contains no jcode or OMNIS KEY source; it invokes the `omnis-key`
binary as a separate process.
