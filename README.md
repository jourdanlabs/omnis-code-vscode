# OMNIS CODE — AI agent receipts

**Proves what it did, or refuses to say.**

Your coding agent edits files and runs commands. This extension shows you the
tamper-evident receipt chain those actions leave behind, inside the editor.

---

## What this extension does

- Shows the live receipt chain state: `RECEIPT_CHAIN_VALID`, `RECEIPT_CHAIN_INVALID`,
  `RECEIPT_STATE_UNSAFE`, `EMPTY_NOT_YET_EVIDENCED` — with entry count and head hash
- Lists recorded receipts — what tool ran, against what, with what result
- Verifies the chain on demand, and shows the engine's real output and exit code
- Explains and remedies an unsafe state directory instead of just flagging it red

## What this extension does not do

**An extension can observe. It cannot gate.**

This extension does not block writes, does not intercept your agent, and does not
stop anything from touching your disk. The VS Code extension API gives no extension
that power — not this one, not any other. It reads the receipt chain and shows you
what it says.

If the chain is broken, you will see that it is broken. Nothing was prevented.
That distinction is the honest one, and we would rather state it plainly than let
the panel imply otherwise.

## The four states

Three of these exit non-zero, and they do not mean the same thing:

| State | Meaning |
|---|---|
| `RECEIPT_CHAIN_VALID` | Every entry hashes to its successor. |
| `RECEIPT_CHAIN_INVALID` | An entry was altered after it was written. |
| `RECEIPT_STATE_UNSAFE` | The ledger directory is readable by other users; the engine declines to trust it. The panel shows the exact fix. |
| `EMPTY_NOT_YET_EVIDENCED` | Nothing recorded yet. **A new install, not a broken chain.** |

Receipt entries are shown only under `RECEIPT_CHAIN_VALID`. Under any other state
they are withheld, because they carry no verdict of their own.

## Requirements

The `omnis-key` engine must be installed.

VS Code launched from the Dock or Finder on macOS does not inherit your shell
`PATH`, so a user-local install at `~/.local/bin` may be invisible to it. If the
panel reports the engine unreachable, set:

```jsonc
"omnisCode.enginePath": "/Users/you/.local/bin/omnis-key"
```

## Privacy

Receipts are local and redacted at the source: the ledger records a program name
and a hash of its arguments, never the full command line. This extension applies a
second allowlist on top of that and never renders, logs, or caches raw commands,
file contents, or paths. Nothing is transmitted anywhere.

## License

See [LICENSE](LICENSE).
