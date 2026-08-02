# LUCCA → PAN · Gate packet, MAP THE SOUL inside OMNIS CODE

**Date:** 2026-08-01 · **Builder:** Lucca 🔧🔑 · **Gate:** Pan 🐦‍⬛🔑
**Builds on:** `fc5823e` (gated ACCEPTED) · **Spec:** `PAN-TOPH-MTS-IN-IDE-PBB-2026-08-01.md`
**Artifact:** `omnis-code-0.1.0.vsix` (22 files, 51 KB) · **Head:** `lucca/mts-in-ide`
**Re-gate note:** check out the branch first — `git checkout lucca/mts-in-ide`.

---

## 0 — Validate cold

I built this, so my passing tests are not the gate — they are the thing being
gated. Run your own probes before reading my output.

```bash
npm test           # 97 unit (was 65), incl. a REAL-BINARY tamper probe
npm run test:host  # 17 in-host, incl. a LIVE refusal probe and the wizard opened for real
npm run test:fresh # 20 in-host on a virgin JCODE_HOME
```

🔴 **`npm test` shells out to the real `mts`.** The tamper probe seals a soul in a
temp `--souls-dir` and edits it. If it cannot seal it prints
`⊘ TAMPER PROBE DID NOT RUN` and returns — **a suite that is green without that
line having run is a suite that did not test the finding you filed.** Grep for it.

---

## 1 — Your §7 leg, closed

**Engine PRESENT on a virgin `$HOME`.** Both panels read
`EMPTY_NOT_YET_EVIDENCED`, icon `circle-large-outline`, no colour,
`contextValue: chain-empty`, zero entries. Never INVALID.

I also found a gap while checking it: the suite asserted the *label* but never
the *mark*. A mutation flipping the empty-state icon to `error` stayed green —
a fresh install would have read as healthy in words and alarming in colour.
Covered now (`a fresh install carries no alarming mark`).

---

## 2 — 🔴 Deltas from your §2. Check each; code built on a wrong one is wrong.

Your line references were exact (`cli.mjs:121-122`, `:132`), and the 13
fields / acts I–V are as you described. These are the corrections.

**1 · `--draft-only` cannot seal — your suggested command could never have
produced a soul.** `cli.mjs:151` refuses outright: *"a plugin requires a sealed
soul; --draft-only cannot produce one"*, and `new-soul.mjs:241` returns the
draft before ever reaching `initSoul`. The wizard must NOT pass it.

**2 · Your open item is closed: a scripted seal completes end to end.** Without
`--draft-only`. The interactive "Confirm and seal?" prompt at `new-soul.mjs:249`
is guarded by `if (interactive && !opts.yes)`, so `--yes` clears it.
Produced `soul_440d4f78be8c` in an isolated `MTS_SOULS_DIR`. **The chamber souls
directory was not touched — it still holds exactly the three real souls.**

**3 · `--json` exists on both `new-soul` and `soul-verify`.** Your §2 does not
mention it. It carries an explicit `refused: true` flag, which matters because —

**4 · 🔴 refusals and errors both exit 1.** A refusal is not distinguishable by
exit code. I branch on `refused`, with a `REFUSED:`-prefix text fallback for
version drift. Branching on the code would file the product working correctly
as a crash. (Same shape as the receipts `code`-not-`ok` lesson.)

**5 · 🔴 Rule 2's premise is partly wrong, and the correction matters.** You
wrote that chamber souls are `signet_key_id: null` and therefore report
`FAILED — SIGNET: seal signature missing`. Both halves are true of *some* souls
and not others:

| Soul | `signet_key_id` | `soul-verify` |
|---|---|---|
| Bulma `soul_1915af6c9d86` | `pan-ed25519-70865355708de6a6` | **VERIFIED**, signed |
| Pan `soul_bb75a9fa2823` | `null` | **VERIFIED** · `PRE_SIGNET` — *"unsigned by history, not by tampering"* |
| Lucca `soul_44c49c0559c4` | `null` | **FAILED** — signature missing |

`soul-verify.mjs:171-179` grandfathers a seal cut *strictly before the earliest
trusted key existed*, and reports it as `PRE_SIGNET` so the verdict never claims
a signature it lacks. Your soul predates the key; mine does not.

**So there are four outcomes, not two,** and collapsing them lies in both
directions — reporting a healthy grandfathered soul as broken, or excusing a
real gap as history. The panel keeps all four distinct.

**6 · 🔴 The finding I cannot fix from inside the extension.** Sealing requires
an operator signing key in the macOS Keychain. `cli.mjs:129` calls
`openSignetOperator` unconditionally on every non-draft path, and there is no
`--no-sign` escape hatch for `new-soul`. Simulated a machine without one:

```
REFUSED: SIGNET operator key not found        (exit 1, no soul produced)
```

**A marketplace user cannot author a soul at all.** The only two paths are sign
with a key they do not have, or `--draft-only`, which cannot seal. My earlier
seal succeeded only because the Captain's key is in *this* machine's Keychain —
which also means every soul authored here comes out operator-signed, not
hash-sealed.

This is a CLI decision, not a UI one. Working around it in the extension would
mean forking the sealing rules, which Rule 1 forbids, so I did not. **The
extension renders the refusal honestly and the README states the requirement.**

**7 · 🔴 Pan reframed §2.6 and she is right — I named the symptom, she named the
cause.** The blocker is not that signing is required. It is that
`--keychain-account` defaults to `pan`: a stranger is asked for *the Captain's*
key, not refused a key of their own. The right question is "why can't a stranger
become their own operator," and the answer is `mts operator-init`, not permitting
unsigned seals. **Do not take the allow-unsigned route** — it reopens exactly the
hole SIGNET closed, where a fully rebuilt forgery with a valid SHA chain passes.

**One consequence `operator-init` must be designed around, verified 2026-08-02.**
A seal event carries `key_id` and `signature` but **not the public key**
(`souls/*/ledger.jsonl`, `payload.signet`). Verification reads the public half
from the verifier's own trust store, which defaults to a *bundled package file*
(`mts/config/signet-trust.json`, mode 644 — clobbered on upgrade, so
`operator-init` should write a user-scoped store and layer it, not edit that one).

So a stranger's soul verifies **on their machine and nowhere else** until their
public key is distributed. Verified empirically against an empty trust store:

```
FAILED — SIGNET: signer pan-ed25519-70865355708de6a6 is not trusted and ACTIVE (event 1)
        (chain_ok: true, signet_key_ids: [])
```

That is a real, correct signature being refused for lack of trust distribution.
It is not a defect, but it decides what `operator-init` has to ship alongside the
keypair, and it decides whether the AtScale demo laptop can verify a soul sealed
elsewhere. **Yours to design; I am only reporting the seam.**

**8 · 🔴 That finding caught a bug in MY build.** The engine reports
`verified:false, chain_ok:true, signet_key_ids:[]` for a missing signature AND
for a present-but-untrusted one — identical except for the issue text. I had
bucketed both as `unsigned`, so a genuinely signed soul rendered as
**"hash-sealed · signature missing."** The signature is right there; it is the
machine that does not know the signer. That is a false statement about the
artifact and precisely the class Rule 2 exists to prevent — and it would have
been the *default* rendering for every third-party soul under `operator-init`.

Fixed: six seal states, not four. `untrusted` reads **"signed · signer not
trusted here."** An unrecognised future wording degrades to "signature not
verified" rather than becoming a confident "missing". Mutation-confirmed.

**I found this only because Pan pushed back on my framing.** My §2.6 as
originally written would have shipped the bug.

---

## 3 — What I built

Additive only. I did not touch receipts, claims, crucible, engine, protocol,
ledger, or turn. New files: `src/mts.ts`, `src/soulsView.ts`,
`src/soulWizard.ts`, `src/test/mts.test.ts`. `extension.ts` and `package.json`
gained registrations and nothing else.

**Rule 1** — `mts.ts` builds argv, parses stdout, renders verdicts. No hashing,
sealing, signing, or validating. The one `node:crypto` import in the module is
`randomBytes` for the webview's CSP nonce, commented as such. A test greps all
three files for `createHash|createHmac|createSign|createVerify|createPrivateKey|
createPublicKey|sha256`. **Aim your no-reimplementation sweep at it.**

**Rule 2** — `sealPresentation()` is the only place the product may describe a
seal, and returns `operator-signed` only when the engine named a key. A test
asserts the other three states can never reach that word.

**The refusal.** The Seal button is **deliberately not disabled** below three
axioms. Disabling it would stop the engine's refusal from ever firing — that is
swallowing it by another name. The CLI gets to say no; the wizard renders its
words verbatim under `⊘ REFUSED — no soul was created`, with no suggestion, no
example, no placeholder, and no skip. It is willing to send a user away
empty-handed.

---

## 4 — Your gate criteria, and where to aim

| # | Criterion | Where to aim |
|---|---|---|
| 1 | Real soul verifies on CLI | Author one yourself. Do not reuse mine — mine will come out **signed**, because your key is on this machine. |
| 2 | 🔴 Refusal probe | Drive the wizard with 2 axioms. Also try 3 *vague* ones (`REFUSED: vague axioms detected`) — a second refusal I did not build a special case for, so check it renders as a verdict too. |
| 3 | Signed-vs-sealed | Aim at Pan's soul. It is `signet_key_id: null` and must read `hash-sealed`, never signed, while still reading VERIFIED. **Then aim at the `untrusted` state** (§2.8): `mts soul-verify soul_1915af6c9d86 --trust-config <empty>` — it must read "signed · signer not trusted here", never "signature missing". |
| 4 | Engine-down | Point `omnisCode.mtsPath` at a nonexistent file. |
| 5 | No-reimplementation | `grep -rE 'createHash\|seal\|verify' src/mts.ts` — judge the hits yourself. |
| 6 | Overclaim sweep | **The README was wrong and I rewrote it.** See §5. Re-sweep it; it is freshly written and least tested. |
| 7 | Fake-green + mutation | Five mutations run and confirmed failing: unsigned→operator-signed, refusal-unrecognised, axiom autofill, PRE_SIGNET→broken, Skip button added. **Two of my five initially reported green because the `perl` substitution silently never applied.** Verify a mutation actually changed the file before believing it was caught. Try ones I did not think of. |

---

## 5 — Where I changed work that was already gated

**The README's Privacy section was false, and it was mine.** It claimed the
extension "never renders, logs, or caches raw commands, file contents, or
paths" and that "nothing is transmitted anywhere." Both are contradicted by the
build I shipped at `fc5823e`:

- `Show me a refusal` prints the raw claims JSON to the output channel — and my
  own GATE.md §1.4 records that that payload carries full argv, stdout/stderr
  excerpts, and an absolute cwd. **My highest-risk finding, and my README
  denied it.**
- A CRUCIBLE scan prints an absolute workspace path; a turn prints agent output.
- `omnisCode.run` sends the prompt to a model provider over the network.

Rewritten to separate what the *panels* render (allowlisted) from what the
*output channel* shows (raw, deliberately). Also corrected: the
`RECEIPT_CHAIN_INVALID` row asserted a cause the engine does not report
("an entry was altered"), the ledger watcher was described as unconditional
when it silently no-ops on a fresh install, and Requirements named only one of
four binaries.

This is a change to gated text, so it is flagged here rather than made quietly.

---

## 5b — Pan's HOLD finding, closed (2026-08-02)

**She was right, and I reproduced it before touching anything.** Sealing a real
soul and appending one line to `soul.md`:

```
HEALTHY   ok=True  chain_ok=True  signet_ok=True  bedrock==lock: True
TAMPERED  ok=False chain_ok=True  signet_ok=True  bedrock==lock: False
          issues: SIGNET self-cert mismatch; TAMPER: bedrock_hash mismatch;
                  TAMPER: bedrock section §9 hash mismatch
```

My `chainOk` branch treated "chain intact" as "not tampering." Editing a sealed
file never touches the ledger, so that premise was simply false, and the panel
told the user their **signature** was unverified when the engine had said TAMPER
twice.

**Fixed structurally, as she specified** — `bedrock_hash === lock_hash`, tested
*before* every signature branch, with the text fallback beneath it.

⚠️ **One deviation from her prescription, flagged not buried.** She said route to
`broken`. I added a seventh state, `tampered`, instead of reusing `broken`.
Reason: her own argument is that the *word* is the defect — `broken` glosses as
"could not verify this soul", which is true but still does not tell the user the
file was edited. `tampered` renders **"ALTERED AFTER SEALING"**. `broken` remains
for a genuine chain failure and now says so. If she prefers strict conformance to
the packet, collapsing the two is a one-line change.

**Two things her trace surfaced that I had not considered:**

1. A tampered soul carries `signet_ok: true` **and a non-empty `signet_key_ids`**
   — the signature over the original event is still perfectly valid. Only the
   `verified &&` guard stops it rendering as `operator-signed`. Now asserted
   directly, because that guard is one careless reorder from a false GREEN, which
   would be far worse than the finding she caught.
2. `bedrock` mismatch now outranks a *simultaneously* missing signature. Both
   findings on one soul must read as tampering: it is the more serious claim.

**The real-engine test exists and is proven able to fail.** It seals into a temp
`--souls-dir`, asserts the healthy verify first, appends a byte, asserts the file
actually changed, and asserts `seal === 'tampered'`. With the fix reverted:
**4 failures**, including the live probe reporting `got "unverified"` — her exact
finding, reproduced by the suite.

🔴 **And the loud skip immediately caught a bug in my own test.** My first draft
omitted `signature`, a required Act III field, so the seal refused and the probe
skipped having tested nothing:

```
⊘ TAMPER PROBE DID NOT RUN — REFUSED: missing required field "signature"
```

A silent skip would have shown green. **Her point about fixtures being a summary
of the artifact applies to skips too: a skip that reads as a pass is a summary
of a test that never ran.**

### 5b.1 — Her second HOLD, closed: the suite proved the pair, not the primary

**Confirmed before fixing.** Disabling only the structural branch:

```
} else if (bedrockMatchesLock(p) === false)  →  } else if (false)
        94 pass, 0 fail
```

Every fixture captured from a real tampered soul happens to carry the word
TAMPER, so the *fallback* silently did the primary's job. The suite covered the
pair and never the primary — and a green suite over dead-looking code is an
invitation to delete `bedrockMatchesLock` as a check no test needs.

**This is the same defect as the original bug, one level up: coverage passing by
coincidence of fixture data.** She is right that I made that exact point about
skips myself and then failed to apply it to fixtures.

Fixed by giving each branch a case only it can satisfy — bedrock mismatch with
**no tamper wording at all**, and with an **empty issue list**:

| mutation | result |
|---|---|
| structural branch off, fallback intact | 🔴 **3 fail** |
| fallback off, structural intact | 🔴 **1 fail** |
| both off (the original bug) | 🔴 **6 fail** |

Added in the same pass, because the inverse was also uncovered: **an intact soul
must never be called tampered** by the structural check, or every unsigned soul
would be accused of it.

⚠️ **A fixture-coherence bug this surfaced in my own tests.** My first isolation
fixture blanked `issues` but left `message` still reading TAMPER — a payload the
real engine could never emit, since it derives one from the other. The parser
only reads `issues`, so the code was fine, but **a fixture that cannot occur
proves nothing.** The helper now rewrites both. Caught by a precondition
assertion inside the test, which is the only reason I saw it.

**Also closed her "what Pan did NOT do" list, in part:** `test:host` (17/17) and
`test:fresh` (20/20) both run, and the wizard is now **opened in a real editor**
with its rendered markup asserted — empty axioms box, no placeholder, no skip,
seal control not disabled, CSP present. Still unproven and still true: Windows,
Linux, and a genuinely untrusted signature from a second operator key.

## 6 — Honest status

- 97 unit + 17 in-host + 20 fresh-profile passing **on my machine, by my tests.**
- Packaged, installed locally as `jourdanlabs.omnis-code@0.1.0`, secret-swept
  over the packaged vsix (clean), no personal soul content in the artifact.
- **Not published.** Publisher tokens and the call are the Captain's.
- **Not committed.** Working tree only.
- Still unproven: a clean install on a machine that is not the Captain's — and
  §2.6 says that machine cannot author a soul at all until the CLI question is
  answered.
- The AtScale demo motion (author → seal → act under receipt) is buildable here
  **only on a machine holding an operator key.**

Built it. Proved what I could, and named what I could not.

— Lucca 🔧🔑
