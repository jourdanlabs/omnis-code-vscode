import * as vscode from 'vscode';
// randomBytes is used for ONE thing: the webview's CSP script nonce. This
// extension does no hashing, signing, sealing, or verifying — that is the CLI's
// job and only the CLI's (Rule 1). See the no-reimplementation test.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ACTS,
  AuthorDraft,
  AuthorOutcome,
  INTERVIEW,
  buildAnswers,
  buildNewSoulArgs,
  parseAuthorOutcome,
  resolveMtsCommand,
  runMts,
} from './mts';
import { configuredMtsPath, configuredSoulsDir } from './soulsView';

/**
 * The soul-authoring wizard.
 *
 * 🔴 Read this before changing anything below.
 *
 * Every ordinary good-UI instinct is wrong in this panel. A wizard's whole
 * reflex is to help the user succeed: autofill a sensible default, soften a
 * hard error, offer "skip for now", suggest an example they can accept with
 * one click. Here, each of those would be a defect.
 *
 * A soul's refusals must be *authored*. If the user has none, the correct
 * product outcome is that no soul is born and they leave empty-handed. So:
 *
 *   · No axiom is ever suggested, pre-filled, exemplified, or generated.
 *   · There is no skip, no "add later", no default set.
 *   · The Seal button stays ENABLED with fewer than three axioms — on purpose.
 *     Disabling it would stop the engine's refusal from ever firing, which is
 *     swallowing the refusal by another name. The CLI must get to say no, in
 *     its own words, and we render that verbatim as a verdict.
 *   · Client-side hints are courtesy only. The CLI is the authority.
 *
 * The refusal is not an error state to be recovered from. It is the product.
 */
export class SoulWizard {
  public static readonly viewType = 'omnisCode.soulWizard';
  private panel: vscode.WebviewPanel | null = null;

  /** Last outcome, exposed so in-host tests assert on what really happened. */
  public lastOutcome: AuthorOutcome | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly output: vscode.OutputChannel,
    private readonly onSealed: () => void,
  ) {}

  open(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      SoulWizard.viewType,
      'MAP THE SOUL — author a soul',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = this.html(this.panel.webview);
    this.panel.onDidDispose(() => {
      this.panel = null;
    });
    this.panel.webview.onDidReceiveMessage(async (msg: { type: string; draft?: AuthorDraft }) => {
      if (msg.type === 'seal' && msg.draft) {
        await this.seal(msg.draft);
      }
    });
  }

  /**
   * Hand the draft to the CLI and render whatever comes back.
   *
   * The answers file carries personal content, so it is written to a private
   * temp directory and removed in a `finally` — it is never logged, cached, or
   * left behind. The engine's stdout is echoed to the output channel because
   * §4.1 says results go on the glass, but the answers never are.
   */
  public async seal(draft: AuthorDraft): Promise<AuthorOutcome> {
    const dir = mkdtempSync(join(tmpdir(), 'omnis-soul-'));
    const answersPath = join(dir, 'answers.json');
    try {
      writeFileSync(answersPath, JSON.stringify(buildAnswers(draft), null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      const args = buildNewSoulArgs(answersPath, configuredSoulsDir());
      const res = await runMts(resolveMtsCommand(configuredMtsPath()), args);
      const outcome = parseAuthorOutcome(res);
      this.lastOutcome = outcome;

      // Echo the verdict, never the answers.
      this.output.appendLine('$ mts new-soul --non-interactive --answers-file <redacted> --yes --json');
      this.output.appendLine(res.stdout.trim() || res.detail || '(no stdout)');
      this.output.appendLine('');
      if (outcome.kind !== 'sealed') {
        this.output.show(true);
      }

      this.post(outcome);
      if (outcome.kind === 'sealed') {
        this.onSealed();
      }
      return outcome;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private post(outcome: AuthorOutcome): void {
    this.panel?.webview.postMessage({ type: 'outcome', outcome });
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    const actSections = ACTS.map((act) => {
      const fields = INTERVIEW.filter((f) => f.act === act.id);
      const body =
        act.id === 'II'
          ? AXIOMS_HTML
          : act.id === 'III'
            ? fieldsHtml(fields) + EXEMPLAR_HTML
            : fieldsHtml(fields);
      return `<section class="act" data-act="${act.id}" hidden>
          <h2>${escapeHtml(act.title)}</h2>
          ${body}
        </section>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         background: var(--vscode-editor-background); padding: 1.5rem 2rem; max-width: 60rem; }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  h2 { font-size: 1rem; margin: 0 0 1rem; color: var(--vscode-descriptionForeground); }
  .sub { color: var(--vscode-descriptionForeground); margin: 0 0 1.5rem; font-size: .9rem; }
  label { display: block; margin: 1rem 0 .3rem; font-size: .9rem; }
  .opt { color: var(--vscode-descriptionForeground); font-weight: normal; }
  input, textarea { width: 100%; box-sizing: border-box; padding: .5rem;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px;
    font-family: inherit; font-size: .9rem; }
  textarea { min-height: 5rem; resize: vertical; }
  button { padding: .45rem 1rem; margin-right: .5rem; border: none; border-radius: 2px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    cursor: pointer; font-size: .9rem; }
  button.secondary { background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground); }
  nav { margin-top: 2rem; display: flex; align-items: center; }
  .steps { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: .85rem; }
  .note { border-left: 2px solid var(--vscode-descriptionForeground);
    padding: .4rem .8rem; margin: .75rem 0; color: var(--vscode-descriptionForeground);
    font-size: .85rem; }
  #outcome { margin-top: 1.5rem; padding: 1rem; border-radius: 3px; display: none; }
  #outcome.refused { background: var(--vscode-inputValidation-infoBackground);
    border: 1px solid var(--vscode-inputValidation-infoBorder); }
  #outcome.sealed { background: var(--vscode-inputValidation-infoBackground);
    border: 1px solid var(--vscode-charts-green); }
  #outcome.failed { background: var(--vscode-inputValidation-errorBackground);
    border: 1px solid var(--vscode-inputValidation-errorBorder); }
  #outcome h3 { margin: 0 0 .5rem; font-size: .95rem; }
  #outcome pre { white-space: pre-wrap; margin: .5rem 0 0; font-family: var(--vscode-editor-font-family);
    font-size: .85rem; }
  .verdictline { font-family: var(--vscode-editor-font-family); font-size: .9rem; }
</style>
</head>
<body>
  <h1>MAP THE SOUL</h1>
  <p class="sub">The <code>mts</code> CLI decides what a soul is. This panel only asks the questions and shows you its answer.</p>

  ${actSections}

  <nav>
    <button id="back" class="secondary">Back</button>
    <button id="next">Next</button>
    <button id="seal" hidden>Seal this soul</button>
    <span class="steps" id="steps"></span>
  </nav>

  <div id="outcome" role="status"></div>

<script nonce="${nonce}">
(function () {
  const vscodeApi = acquireVsCodeApi();
  const acts = Array.from(document.querySelectorAll('.act'));
  let step = 0;

  function render() {
    acts.forEach((a, i) => { a.hidden = i !== step; });
    document.getElementById('back').disabled = step === 0;
    document.getElementById('next').hidden = step === acts.length - 1;
    document.getElementById('seal').hidden = step !== acts.length - 1;
    document.getElementById('steps').textContent =
      'Act ' + acts[step].dataset.act + ' of ' + acts.length;
  }

  document.getElementById('next').addEventListener('click', () => {
    if (step < acts.length - 1) { step++; render(); }
  });
  document.getElementById('back').addEventListener('click', () => {
    if (step > 0) { step--; render(); }
  });

  function collect() {
    const fields = {};
    document.querySelectorAll('[data-field]').forEach((el) => {
      fields[el.dataset.field] = el.value;
    });
    const axioms = document.getElementById('axioms').value
      .split(/\\r?\\n/).map((s) => s.trim()).filter(Boolean);
    return {
      fields: fields,
      axioms: axioms,
      exemplarContext: document.getElementById('exemplar_context').value,
      exemplarOutput: document.getElementById('exemplar_output').value
    };
  }

  // Deliberately unguarded. Fewer than three axioms still submits, so the
  // engine can refuse in its own words. Blocking it here would hide the
  // refusal that is the whole point of this step.
  document.getElementById('seal').addEventListener('click', () => {
    const box = document.getElementById('outcome');
    box.style.display = 'block';
    box.className = '';
    box.innerHTML = '<h3>Asking the engine…</h3>';
    vscodeApi.postMessage({ type: 'seal', draft: collect() });
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.type !== 'outcome') return;
    const o = msg.outcome;
    const box = document.getElementById('outcome');
    box.style.display = 'block';
    if (o.kind === 'refused') {
      box.className = 'refused';
      // The engine's words, verbatim. Nothing is added, softened, or
      // accompanied by a way around it.
      box.innerHTML = '<h3>&#8856; REFUSED &mdash; no soul was created</h3>' +
        '<pre class="verdictline"></pre>';
      box.querySelector('pre').textContent = o.message;
    } else if (o.kind === 'sealed') {
      box.className = 'sealed';
      box.innerHTML = '<h3>Sealed</h3><pre></pre>';
      box.querySelector('pre').textContent =
        'soul_id: ' + o.soulId + '\\n' +
        (o.signed
          ? 'operator-signed — the engine named a signing key'
          : 'hash-sealed, NOT operator-signed — provenance only');
    } else if (o.kind === 'unreachable') {
      box.className = 'failed';
      box.innerHTML = '<h3>MTS unreachable &mdash; no verdict</h3><pre></pre>';
      box.querySelector('pre').textContent = o.detail;
    } else {
      box.className = 'failed';
      box.innerHTML = '<h3>The engine did not return a verdict</h3><pre></pre>';
      box.querySelector('pre').textContent = o.detail;
    }
  });

  render();
})();
</script>
</body>
</html>`;
  }
}

function fieldsHtml(fields: { id: string; label: string; required: boolean; multiline: boolean }[]): string {
  return fields
    .map((f) => {
      const opt = f.required ? '' : ' <span class="opt">(optional)</span>';
      const control = f.multiline
        ? `<textarea data-field="${f.id}" id="f_${f.id}"></textarea>`
        : `<input type="text" data-field="${f.id}" id="f_${f.id}" />`;
      return `<label for="f_${f.id}">${escapeHtml(f.label)}${opt}</label>${control}`;
    })
    .join('\n');
}

/**
 * Act II.
 *
 * The framing text is the engine's own, quoted from the MTS interview script —
 * guidance about specificity, not a candidate the user can accept. There is no
 * example axiom, no generator, and no way past this step.
 */
const AXIOMS_HTML = `
  <p class="note">This is the spine. A soul is defined more by what it won't do than
  what it will. These get hash-sealed &mdash; the floor that cannot move silently.</p>
  <p class="note">The engine requires at least three, and it decides whether yours
  count. It rejects the aspirational: &ldquo;be ethical&rdquo; is a value, not a refusal.
  A refusal names a specific line. <strong>Nothing here will write one for you.</strong>
  If you have none to give, no soul is born, and that is the correct outcome.</p>
  <label for="axioms">Their hard refusals &mdash; one per line</label>
  <textarea id="axioms" rows="8"></textarea>
`;

/** Act III's voice anchor. Same discipline: no sample output is offered. */
const EXEMPLAR_HTML = `
  <p class="note">A canonical exemplar: one real moment, in their voice. The engine
  refuses a soul with no voice anchor.</p>
  <label for="exemplar_context">The moment &mdash; what was happening</label>
  <textarea id="exemplar_context" rows="3"></textarea>
  <label for="exemplar_output">What they said, in their own words</label>
  <textarea id="exemplar_output" rows="6"></textarea>
`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
