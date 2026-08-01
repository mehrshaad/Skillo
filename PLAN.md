# Skillo - v2 Execution Plan

**Written for Opus 5 to execute.** The v1 plan is complete and lives in git history
(`git show 629e467:PLAN.md` or any earlier commit); everything it described is built,
tested (123 unit tests) and committed through `d77cbf5`. This plan covers the next round
of changes only. Do not re-litigate v1 decisions; where this plan says nothing, v1's
conventions stand.

---

## 0. Established facts — do not re-derive these

Verified during v1 against real systems; they constrain everything below.

1. **LinkedIn ships no JSON-LD**, and signed-in pages render hashed class names with no
   description in the DOM. The unauthenticated fetch path (`credentials: 'omit'`) is the
   reliable one. All LinkedIn knowledge lives in `src/lib/jobIntake/`.
2. **Overleaf free has no API.** Read/write goes through the CodeMirror 6 view reached via
   `.cm-content → cmView.view` from a MAIN-world script. Undocumented; feature-detected;
   all Overleaf knowledge lives in `src/lib/overleaf/` + `src/entrypoints/overleaf*.ts`.
   Writes are one transaction, guarded by a hash of the doc as it was read.
3. **`temperature`/`top_p`/`top_k` are never sent** — current Anthropic models 400 on
   them, and any provider can front any model. Asserted in tests; keep it that way.
4. **Claude CLI contract (v2.1.220):** `claude -p --tools "" --output-format json
   --system-prompt <text>` with the prompt on stdin; reply text is `result` in the JSON.
   Windows needs a `.bat` launcher because Chrome can't execute `.mjs`.
5. **WXT quirks:** `publicDir` resolves from the project root (not `srcDir`); typed
   `browser` comes from `wxt/browser`; injectable script paths must match
   `.wxt/types/paths.d.ts`. `.gitattributes` pins LF on `*.sh` and `bridge/host.mjs`.
6. **The extension id is pinned** to `hfbincjmdcgfhffnpanjdfcccpejdkei` via the `key`
   field in `wxt.config.ts` for unpacked/dev loads.

Hard product rules carried over unchanged: **no fabrication at any setting** (rephrase,
reorder, emphasize, cut — never invent employers/dates/degrees/metrics/skills), **human
diff gate before any write**, **no Skillo server**.

---

## 1. Scope of v2

| # | Change | Summary |
|---|--------|---------|
| S1 | Name dash | `Skillo — Resume Tailor` → `Skillo - Resume Tailor`; plain ASCII hyphen everywhere the product name appears |
| S2 | Fit level | 5-step level bar (lowest/low/medium/high/very high, default medium) controlling how aggressively the rewrite chases the job vs. staying close to the real resume |
| S3 | Match score | After generation, an evaluation pass scores original and revised resume against the job, 0–10, shown as before → after with the gaps that remain |
| S4 | Page settings | Page limit selector 1–3 (default 2) in the generate step, plus a "fill the last page" toggle; generation must actually respect them, with verification |
| S5 | Section editor | Edit / add / remove / reorder the resume's sections before tailoring — draggable list with keyboard fallback |
| S6 | Bolder UI | Heavier weights, stronger contrast, thicker accents — same design language, more confident |
| S7 | New icon | New minimal mark, still generated from `scripts/generate-icons.mjs` |
| S8 | Store distribution | Chrome Web Store-ready build, and the bridge install reduced to one download + one double-click |

Out of scope for v2: other job sites, multi-file LaTeX tailoring, per-hunk diff apply,
Codex bridge, dark mode.

---

## 2. Decision log (v2)

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| D1 | Where fit/page settings live | Wizard state (per run) + last-used values persisted to `Settings.defaults` so the next run starts where the user left them | They're generation inputs, not global config; but re-picking every run is friction |
| D2 | How fit level reaches the model | The tailor **system prompt is assembled** from a base + one fit-level block + page-budget block; five hand-written level blocks, not a numeric dial in the prompt | Models follow concrete behavioral instructions far better than "aggressiveness: 4/5" |
| D3 | Match score mechanism | A **separate stage-3 evaluation call** after tailoring, scoring BOTH original and revised in one call, JSON out | Self-grading inside the generation call is flattery; a separate judged pass with both versions gives an honest delta for one cheap call (~1k tokens out) |
| D4 | Page-count ground truth | Best-effort read of Overleaf's PDF toolbar page count ("1 of 2") via the existing content-script bridge; fall back to a chars-per-page constant | The extension cannot compile LaTeX; Overleaf already did |
| D5 | Page-budget enforcement | Prompt budget (target chars computed from calibrated chars/page) + a page-aware validator replacing the generic ±40% drift rule + post-apply recheck offering "shorten" regeneration | Honest layering: steer, then check, then verify against the real compile |
| D6 | Section parsing strategy | Slice the body at known section-start patterns (`\section`, `\section*`, `\cvsection`, `\resumesection`, `\sectiontitle`, and `\begin{rSection}{…}…\end{rSection}`); if fewer than 2 sections are found, hide the editor with a note | Resume templates are wildly diverse; degrade to invisible rather than mangle |
| D7 | Drag and drop | Hand-rolled HTML5 `draggable` + **always-visible up/down buttons** per card | No dependency; the buttons are the keyboard/accessibility path, not an afterthought |
| D8 | Editing model for sections | The section editor mutates the **working copy** (`resume.latex`); the hash of the Overleaf doc as read moves to a new field `resume.overleafDocHash` used only by the apply guard | Today `resume.hash` doubles as both "working text identity" and "stale-doc guard". Restructuring locally would otherwise make apply refuse its own edit. This split is load-bearing — see §6 |
| D9 | Store build vs dev build | Two build modes: dev keeps the pinned `key`; `build:store` strips it via env flag | CWS assigns its own id and packages with `key` are known to cause upload trouble; verify at first upload, but plan for the id to differ |
| D10 | Bridge distribution | Single self-contained installer per OS, **generated at build time** with `host.mjs` embedded (base64), shipped inside the extension package and downloaded from Settings; installer allowlists dev id + store id + optional custom id argument | One download, one double-click is the floor Chrome's sandbox permits. No fetch from a server; the extension carries its own installer |
| D11 | Bridge connect UX | While the bridge screen is open, poll `bridge/status` every 3 s so the UI flips to *connected* by itself after the user runs the installer | Removes the "now go back and press a button" step |
| D12 | Match score placement | Review step header: `match 6/10 → 8/10` with remaining gaps listed under it; stored in history | The score is a review artifact, not a vanity metric — gaps tell the user what honest tailoring could not fix |
| D13 | Icon mark | Two rounded horizontal bars on the ink plate — top short in paper, bottom long in proof blue | Reads as "a resume line, strengthened"; survives 16 px better than the old check; still script-generated |

---

## 3. S1 - Name dash (trivial, do first)

Replace the em dash with `-` in the product name and any string that embeds it:
`wxt.config.ts` manifest `name`, `README.md` heading/description lines, `bridge/README.md`,
`bridge/install.ps1`/`install.sh` echo lines if they print the name. This is about the
**product name string**, not prose punctuation in docs. Grep `Skillo —` and `— Resume` to
find them all. Update the M0 manual-e2e line that quotes the name if it does.

---

## 4. S2 - Fit level

### State

```ts
// WizardState additions
fitLevel: 1 | 2 | 3 | 4 | 5;        // default 3
// Settings additions
defaults?: { fitLevel?: number; pageLimit?: number; fillLastPage?: boolean };
```

Panel patches state before `pipeline/tailor`; background reads state (message shape
unchanged). On successful generation, write the used values into `Settings.defaults`.

### UI (Tailor step, above the notes box)

A horizontal 5-stop level bar — the same visual family as the step indicator: a track
with 5 tick stops, labels `lowest … very high` under the ends, the active stop filled in
proof blue. Radio-group semantics (`role="radiogroup"`, arrow keys move the stop). One
line of dynamic caption under it explaining the current stop, e.g. medium: *"Balanced -
reorders and rephrases toward the job, keeps your resume recognizable."*

### Prompt assembly (`prompts.ts`)

`buildTailorSystemPrompt(fitLevel, pageBudget)` = shared base (rules 1–2 and 6–7 of the
v1 prompt, unchanged — the no-fabrication rule is **identical at every level**) + one of
five level blocks + the page block (§5). Draft level blocks (executor copies verbatim,
tunes only on observed failures, recording tunings in the file):

- **1 · lowest** — "Change as little as possible. Reorder bullets and sections so the most
  job-relevant material comes first, and surface keywords ONLY where the existing text
  already states that experience. Do not rephrase sentences except where a keyword swap
  requires it. Cut nothing."
- **2 · low** — "Conservative pass. Reorder freely; rephrase individual bullets to use the
  job's vocabulary where the meaning is unchanged; do not restructure sections; cut only
  clearly irrelevant bullets."
- **3 · medium** — v1 behavior verbatim (rules 3–5 of the v1 prompt).
- **4 · high** — "Aggressive alignment. Rewrite bullets around what the employer values,
  lead every section with the most relevant material, compress or merge weak bullets, cut
  content that does not serve this application. Keep every claim traceable to the
  original."
- **5 · very high** — "Maximum alignment. Restructure section order around the job's
  priorities, rewrite the summary/profile entirely for this role, rewrite bullets to
  mirror the job's language wherever truthful, cut everything that does not sell this
  application. The result should read as written for this job — while every fact remains
  from the original resume or the candidate's notes."

Unit-test the assembly: each level produces exactly one level block; the fabrication rule
text is present at all five; page block appears iff page settings are active.

---

## 5. S4 - Page limit and fill toggle

### State

```ts
pageLimit: 1 | 2 | 3;      // default 2
fillLastPage: boolean;     // default false
```

### UI (Tailor step, "generating section", below fit level)

A 3-stop level bar for pages (same component as fit level — build it once as
`<LevelBar stops={n} …>`), plus a toggle row: *"Fill the last page - expand or trim so
page N ends full, no half-empty last page."*

### Calibration and budget

```
charsPerPage = knownPages ? originalBodyChars / knownPages : 3200   // fallback constant
targetChars  = charsPerPage * pageLimit
```

- `originalBodyChars` = chars between `\begin{document}` and `\end{document}` of the
  source resume.
- `knownPages`: new message `overleaf/pageCount` → content script reads Overleaf's PDF
  toolbar page indicator. Add the selector(s) to the Overleaf adapter as a tolerant list
  (inspect the live DOM at implementation time — do not guess and ship; this is exactly
  the kind of internal that must be verified the way v1 verified `cmView`). Returns
  `null` when the project isn't compiled or the selector misses; that's fine, the
  constant takes over. 3200 is a starting point — calibrate it against one real resume
  fixture during implementation and record the measured value.

### Prompt block

Appended to the system prompt whenever page settings are active (always, since default
is 2): "The revised resume must fit N page(s) when compiled. Budget roughly {targetChars}
characters of body content ({pageLimit} page(s) at ~{charsPerPage} chars/page from this
template). If content exceeds the budget, cut the least job-relevant material rather than
compressing formatting." Fill toggle adds: "The final page must end essentially full:
within ~10% of the budget, expand the most job-relevant sections or trim, whichever is
needed — do not leave a mostly-empty last page and do not overflow."

### Validation (`validateLatex.ts`)

When a page budget is present, **replace** the generic ±40% drift rule with:

- body chars > `targetChars * 1.15` → problem: "likely exceeds N pages" (retry-worthy);
- fill ON and body chars < `targetChars * 0.85` → problem: "last page will be mostly
  empty" (retry-worthy);
- fill OFF and body chars < `targetChars * 0.5` → problem (content was gutted).

Tolerances are constants in one place; the executor tunes them against the fixture
resume, not by feel.

### Post-apply verification (the honest check)

After Apply, the Review step shows a "Check the compiled page count" row: user recompiles
in Overleaf, Skillo calls `overleaf/pageCount` (poll a few times for ~20 s, since compile
takes a moment). If the count exceeds `pageLimit`, show: "Compiled to M pages, target N —
regenerate shorter?" which re-runs stage 2 with feedback pre-filled ("the result compiled
to M pages; cut to fit N"). If the count matches, show a quiet confirmation chip. If the
selector misses, show nothing — never a false alarm.

---

## 6. S3 - Match score

### Pipeline

New `src/lib/pipeline/scoreMatch.ts`, called inside `runGeneration` after a successful
tailor (and after regeneration). Skippable failure: if scoring fails, the run still
succeeds — score is additive, never blocking. One retry on bad JSON, same pattern as
`analyzeJob`.

System prompt (draft): "You are a strict technical recruiter. Score how well each of two
resumes matches the job profile, 0–10 (10 = interview-certain fit on paper). Judge only
what is on the page against what the job demands. Return ONLY JSON:
`{"originalScore": int, "revisedScore": int, "rationale": string (≤2 sentences),
"remainingGaps": string[] (requirements the revised resume still does not evidence —
things tailoring cannot fix without inventing experience)}`."
User message: job profile JSON + original LaTeX + revised LaTeX. `maxTokens` 1024.

### State / history

```ts
// GenerationState addition
match?: { originalScore: number; revisedScore: number; rationale: string; remainingGaps: string[] };
// HistoryEntry additions
fitLevel: number; pageLimit: number; match?: …;
```

### UI (Review step, top)

`match 6/10 → 8/10` set large in mono (this is a "bolder UI" moment — the delta is the
product's receipt), rationale as one muted line, then `remainingGaps` as a short list
under an eyebrow "What still doesn't match". Frame gaps as honesty, e.g. a caption:
*"Tailoring can't close these without inventing experience — which Skillo won't do."*
Scores also shown in history entries.

---

## 7. S5 - Section editor

### Parser (`src/lib/latexSections.ts`, pure, heavily tested)

```ts
interface ResumeSection { id: string; title: string; raw: string }   // raw = full block incl. heading
interface SectionedResume { before: string; sections: ResumeSection[]; after: string }
parseSections(latex: string): SectionedResume | null   // null → editor hidden
assembleSections(doc: SectionedResume): string
```

- Only the region between `\begin{document}` and `\end{document}` is sectioned; `before`
  holds preamble + any pre-section header block (name, contact line), `after` holds
  whatever trails the last section.
- Boundary patterns (tolerant list, one constant): `\section{…}`, `\section*{…}`,
  `\cvsection{…}`, `\resumesection{…}`, `\sectiontitle{…}`, and the environment form
  `\begin{rSection}{…}…\end{rSection}` (blocks are the env spans; boundaries elsewhere
  are "from this heading to the next heading").
- **Round-trip invariant (the test that matters):** `assemble(parse(x)) === x` for every
  fixture, byte-identical. Fixtures: at least three real, structurally different resume
  templates (moderncv-style `\section`, an rSection template, a custom-macro template) —
  add them under `tests/fixtures/latex/`.
- `parseSections` returns null for < 2 sections, env/heading mix it can't slice cleanly,
  or anything else suspicious. Null must be common and silent.

### UI (Resume step, after the resume card)

Collapsible "Sections" block, hidden when the parser returns null (with a one-line note
"couldn't detect sections in this template" only if the user expands it). Each section is
a card: drag handle (`draggable`), always-visible ▲/▼ buttons, title inline-editable,
expand chevron revealing a body textarea, delete (×) with a single-level "Undo remove"
bar. "Add section" appends `\section{New section}\begin{itemize}\item …\end{itemize}`
matching the detected heading command of the document. "Reset to as-loaded" restores the
original text.

Every operation reassembles and writes `resume.latex` (working copy). Edits invalidate
any existing generation (`generation: {status:'idle'}`, clear `match`), because the diff
baseline changed.

### The hash split (D8 — do this first, it's the correctness fix)

```ts
// ResumeSource: rename/lift
latex: string;              // working copy (may be restructured/edited locally)
overleafDocHash?: string;   // hash of the doc AS READ from Overleaf; only for kind 'overleaf'
```

- Apply guard sends `overleafDocHash` (not a hash of the working copy) as
  `expectedCurrentHash`. The MAIN-world check is unchanged.
- Re-read after `OVERLEAF_DOC_CHANGED` refreshes both `latex` and `overleafDocHash` —
  which discards local restructuring; warn the user before re-reading if
  `latex` had local edits.
- Unit-test the interplay: restructure locally → apply against unchanged Overleaf doc
  succeeds; Overleaf doc edited meanwhile → apply refuses regardless of local edits.

---

## 8. S6 + S7 - Bolder UI and new icon

**Bolder pass** (tokens + one sweep, no layout rework): base font 13px → 13.5px; ink
darkened (`#101014`); proof deepened for text contrast (~`#22688a`) while keeping the
wash light; `Eyebrow` → weight 600, slightly larger tracking; buttons → `font-semibold`;
step bar border 2px → 3px and active label bold; job/resume card titles →
`text-[15px] font-semibold`; diff add/del hues nudged more saturated; the match delta
(§6) set large. Keep the paper/workbench character — bolder, not louder. Check every
screen at 360 px panel width.

**Icon**: rewrite the drawing part of `scripts/generate-icons.mjs` (PNG encoder stays):
rounded-square ink plate as today; two horizontally-centered rounded bars — upper bar
paper-colored, ~40% width, upper third; lower bar proof blue, ~62% width, just below
center, slightly thicker. Verify by reading the generated 128 px and 16 px PNGs
(the harness renders them) — the two bars must be distinct at 16 px.

---

## 9. S8 - Store distribution and bridge install

### Store build

- `wxt.config.ts`: include `key` only when `process.env.SKILLO_STORE !== '1'`.
- `package.json`: `build:store` and `zip:store` scripts setting that env
  (`cross-env` or a tiny node wrapper — Windows-safe either way).
- **At first upload, verify** whether CWS accepts a manifest containing `key` — if it
  does, prefer keeping it (ids then match and the dual-allowlist below becomes belt and
  suspenders). Record the outcome and the assigned store id in §12.
- README gains a short "Publishing" section: `npm run zip:store`, dashboard upload,
  permission justifications to paste (why linkedin.com, overleaf.com, provider hosts,
  storage, scripting, tabs, offscreen, optional nativeMessaging).

### One-file bridge installers (D10)

New `scripts/build-bridge-installers.mjs`, run as part of `build`:

- Reads `bridge/host.mjs`, base64-encodes it, and emits two self-contained files into
  `public/bridge/`:
  - `skillo-bridge-setup.bat` — double-clickable on Windows. Decodes the embedded base64
    to `%LOCALAPPDATA%\Skillo\host.mjs` (PowerShell one-liner inside the bat:
    `[IO.File]::WriteAllBytes(...,[Convert]::FromBase64String('…'))`), then performs
    exactly what `install.ps1` does today: launcher bat with resolved Node path, host
    manifest, HKCU key. No parameters needed for the normal case.
  - `skillo-bridge-setup.sh` — same for macOS/Linux (`base64 -d`), `chmod +x`, manifest
    into the Chrome NativeMessagingHosts dir.
- `allowed_origins` embeds **both** the dev id and `STORE_EXTENSION_ID` (a constant in
  the script, placeholder until first publish, then filled in and committed), plus an
  optional first-argument override. Chrome host manifests accept multiple origins.
- The existing `bridge/install.ps1`/`.sh` stay for repo users; the generated files are
  the store-user path. Both must produce identical results — the generator should share
  logic by generating from a template, not by hand-duplicating (keep it simple: the .bat
  IS the template with two placeholders: base64 payload + origins list).
- Test the generated `.bat` the way v1 tested the installer: run it, then drive the
  installed launcher with real native-messaging framing (the scratch driver script
  pattern from v1) and assert ping + completion work. Same for `.sh` if a POSIX shell is
  available; otherwise mark it for the user's manual pass.

### Settings bridge screen rework (D11)

- "Download the installer" button → anchor with `download` attr pointing at
  `browser.runtime.getURL('/bridge/skillo-bridge-setup.bat')` (pick file by
  `navigator.platform`; show the other OS link small underneath).
- Show the live extension id (`browser.runtime.id`) with a copy button and one line: "if
  this id isn't in the installer's allowlist, run it as:
  `skillo-bridge-setup.bat <id>`". (Normally unnecessary — both known ids are baked in.)
- While this screen is visible and status is not connected: poll `bridge/status` every
  3 s; flip to *connected* automatically. Stop polling on unmount.
- Instruction copy: numbered 1-2-3 (download → double-click → restart Chrome if it was
  already running), replacing the current "run the installer in the bridge/ folder" text.

---

## 10. Milestones

Execute in order; each ends with `npm run compile && npm test && npm run build` clean and
its manual-e2e items appended to `docs/manual-e2e.md`. Commit per milestone, plain
messages, no co-author lines.

### V1 - Cosmetics (S1, S6, S7)
Name dash everywhere the product name appears; bolder token pass over every screen; new
icon generated and verified at 16/128 px by reading the PNGs.
**Verify:** manifest `name` has the plain dash; every screen eyeballed at 360 px; icons
in manifest; all existing tests still green.

### V2 - Generation controls (S2, S4)
`LevelBar` component (used for both fit and pages); state + settings-defaults
persistence; prompt assembly with level blocks and page budget; page-aware validator;
`overleaf/pageCount` adapter (verified against the live Overleaf DOM, tolerant selectors,
null on miss); post-apply page check with shorten-regeneration offer.
**Verify:** unit tests for prompt assembly (level blocks exclusive, fabrication rule at
all levels, budget math incl. fallback constant), validator thresholds, and the
pageCount-null path. Manual: generate at level 1 vs 5 on the same job — the diffs must
differ in the described direction; page 1 limit visibly shrinks a 2-page resume; fill
toggle produces a full final page; compiled-count check fires after apply.

### V3 - Match score (S3)
`scoreMatch` stage, state/history fields, Review header, history display. Scoring failure
must not fail the run.
**Verify:** unit tests for JSON parsing/clamping (scores clamped to 0–10 ints), the
skippable-failure path, history round-trip. Manual: scores appear, delta reads sanely,
gaps are real gaps.

### V4 - Section editor (S5)
Hash split first (D8) with its guard tests; then parser + assembler with round-trip
fixtures; then the UI with drag + buttons + undo-remove + add + reset; generation
invalidation on edit.
**Verify:** round-trip byte-identity on all fixtures; parser returns null on a
sectionless doc; guard interplay tests (local edits vs Overleaf edits). Manual: reorder
via drag AND via buttons only (no mouse); edit a section body; remove + undo; add; reset;
then generate and apply — apply must succeed against the untouched Overleaf doc.

### V5 - Distribution (S8)
Store build mode; installer generator + generated installers tested end-to-end on
Windows exactly like v1 tested `install.ps1`; Settings bridge screen rework with
polling; README publishing section.
**Verify:** `zip:store` output has no `key` in its manifest; generated `.bat` installs a
working host (framed ping + completion via the driver script); download link works from
the built extension; status flips to connected without a manual re-check (needs the
user's Chrome for the last two — list them in manual-e2e).

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Page enforcement is a heuristic before compile | Three layers (prompt budget, validator, post-apply real count); never block on the heuristic alone; fallback constant calibrated on a real fixture |
| Overleaf page-count selector is another undocumented internal | Same discipline as `cmView`: verify live before shipping, tolerant list, null on miss, adapter-only |
| LaTeX section diversity breaks parsing | Round-trip invariant + null-means-hidden; the editor failing closed costs nothing |
| Hash split regressions in the apply guard | Do D8 first in V4 with its own tests before any UI |
| CWS id/key mechanics differ from expectation | Dual-allowlist in the host manifest covers both outcomes; verify `key` acceptance at first upload and record it |
| Score inflation (model flatters its own rewrite) | Separate call, "strict recruiter" framing, both versions scored together; if scores still read inflated in practice, note it and tune the prompt — do not silently +N/-N adjust |
| Self-contained `.bat` escaping (base64 in batch) | Payload lives in a single PowerShell `-Command` string with the base64 as a plain literal; test the generated file for real, not by inspection |

---

## 12. Findings during execution

Append here as they're discovered, v1-style (grounded observation beats this plan —
record the contradiction, don't silently absorb it). Reserved: the CWS `key` outcome and
the assigned store id (needed by `scripts/build-bridge-installers.mjs`).

**G1 — v1's core Overleaf assumption is now verified live.** Probed a real signed-in
Overleaf project (read-only, nothing dispatched): `.cm-content` exists, `.cmView.view`
resolves, `view.dispatch` is a function, and `view.state.doc.toString()` returned the
real 11,938-character resume. This was the single largest unverified risk carried out of
v1 and it holds against production Overleaf.

**G2 — There is no "N of M" page indicator (contradicts §5's assumption).** The plan
expected to read a page count from Overleaf's PDF toolbar. That toolbar has no such text
in the current build. What does exist is better: the preview is PDF.js, which renders one
`.page` element per page inside `.pdfViewer`, each carrying `data-page-number` and an
`aria-label`. Taking the **highest** `data-page-number` is more robust than counting
canvases, because PDF.js virtualizes canvases but keeps a placeholder element per page.
Implemented in `src/lib/overleaf/pageCount.ts`. Because this needs no page JavaScript, it
runs in the ISOLATED content script rather than the MAIN-world bridge.

**G3 — Chars-per-page calibrated: 3600, not 3200.** Measured on a real two-page
article-class resume: 7288 body characters over 2 compiled pages = 3644/page. The plan's
placeholder was ~14% low. Set to 3600 (rounded down, since overshooting a page limit is
the more annoying failure). Only used when Overleaf cannot report a real page count.

**G4 — Estimated budgets are validated far more loosely than calibrated ones
(refinement of §5).** The plan specified flat validator tolerances. But when the budget
comes from the fallback constant rather than this resume's real page count, a tight
tolerance would fail perfectly good revisions because a constant was wrong for that
template. `PageBudget.calibrated` now selects between two tolerance sets (calibrated:
1.15× over / 0.85× under-when-filling / 0.5× gutted; estimated: 1.45 / 0.65 / 0.4).
Asserted by a test that the same over-length output passes on an estimated budget and
fails on a calibrated one.

---

## 13. Instructions to the executor

1. Milestones in order; V4's hash split before V4's UI. Don't start a milestone with the
   previous one's checks failing.
2. Adapter discipline is unchanged: LinkedIn knowledge in `jobIntake/`, Overleaf
   knowledge in the Overleaf adapter/entrypoints, and now section parsing in
   `latexSections.ts` only.
3. Prompts in §4–§6 are starting text — copy verbatim, tune only on observed failures,
   record tunings in a comment above the prompt.
4. The no-fabrication rule appears at every fit level, byte-identical, with a test
   asserting it. "Very high" changes packaging aggressiveness, never truthfulness.
5. Anything requiring the user (real keys, real Overleaf/LinkedIn, running installers in
   Chrome, the CWS upload itself) goes into `docs/manual-e2e.md` with exact steps — stop
   and ask rather than skipping the check.
6. Where this plan turns out to be wrong about an external system (CWS, Overleaf DOM,
   batch-file quirks), implement the documented fallback and record the finding in §12.
