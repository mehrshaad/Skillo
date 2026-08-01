# Skillo - v3 Plan

v2 is built and committed (`1357f2b`), 187 tests green, and the extension has now been
run in Chrome against a real job, a real Overleaf project and OpenRouter. This plan covers
what that first real run exposed, plus the publishing prerequisites.

**Order matters:** W3 measures, W4 uses the measurement. Do not start W4 first.

---

## 0. The bug, diagnosed

Reported: page limit 2, output compiled to ~2.2 pages. The user's position is that
overflow must never happen. Agreed — a limit that is sometimes exceeded is not a limit.

Three separate causes, all real:

**C1 — Characters are not height.** The whole budget rests on `bodyChars`, but vertical
space is consumed by *structure*, not characters. Three added bullets, a new section
heading, or a line break costs almost no characters and a lot of height. So a revision can
sit comfortably inside its character budget and still overflow. No amount of tuning the
constant fixes this; it is the wrong unit.

**C2 — The calibration assumes the last page is full.** `charsPerPage = bodyChars / pages`
treats a resume whose second page is 40% full as though it were 100% full, so
chars-per-page comes out systematically low. Wrong in the *safe* direction here, but wrong,
and it makes the fill target meaningless.

**C3 — The validator explicitly permits overflow.** `over: 1.15` allows 15% more than
budget. For a 2-page target that is 2.3 pages. It was written as "catch gross failures",
but the user asked for a limit, so anything projected past the limit must fail.

**C4 — Page count is read at the wrong moment.** `runGeneration` reads the *current*
Overleaf page count but pairs it with `state.resume.latex`, which was read earlier. If the
document changed in between (e.g. a previous revision was applied), the calibration pairs a
character count with an unrelated page count.

**Consequence for the design:** the only trustworthy signal is the compiled PDF. The fix is
therefore *measure the real thing*, not *tune the proxy*.

---

## 1. Scope

| # | Item | Milestone |
|---|------|-----------|
| S1 | Score band label (very low / low / moderate / high / very high) beside the number | W1 |
| S2 | Pointer cursor on everything clickable | W1 |
| S3 | Sync settings across devices via `chrome.storage.sync`; API keys stay local | W1 |
| S4 | `PRIVACY.html`, publish repo, GitHub Pages | W2 |
| S5 | Fill-ratio measurement from the compiled PDF | W3 |
| S6 | Accurate page model + no-overflow validator + pre-apply projection | W3 |
| S7 | Guaranteed fit: measure-and-correct loop | W4 |
| S9 | ATS score — keyword coverage, computed locally | W1 (coverage) + W5 (parseability) |
| S8 | Export the compiled PDF; plain-text export | W6 |

Out of scope, with reasons in §6: `.docx` export, syncing full history.

**Review order is match, then ATS.** Match answers *should I apply at all*; ATS answers
*what should I add* — headline before detail. It is also the more honest order: tailoring
reliably lifts keyword coverage, so leading with ATS would lead with the flattering number
and bury a sobering match score underneath it.

**Both collapse to a single row, collapsed by default**, so the diff stays the focus. The
collapsed row still carries the uncomfortable part — the gap count — so nothing honest is
hidden behind a chevron:

```
▸ MATCH   3 → 5 /10   low          18 gaps
▸ ATS     62% → 91%                3 terms missing
```

Expanded, they show the rationale and the full lists as designed. The open/closed choice is
remembered in the synced settings (§W1 S3), so a user who always expands them keeps them
expanded.

---

## 2. Decisions

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| D1 | Score band | Computed client-side from the number, no extra model call | The band is a presentation of the score, not a second judgement |
| D2 | Band thresholds | 0-2 very low, 3-4 low, 5-6 moderate, 7-8 strong, 9-10 excellent | Matches the scoring prompt's own "most real resumes are 4-8" |
| D3 | Cursor | One global rule in `globals.css`, not per-component classes | Tailwind v4's Preflight dropped `cursor: pointer` on buttons — that is why it is missing everywhere at once |
| D4 | What syncs | Provider choice, model per provider, fit level, page limit, fill toggle | Small, and the settings a user would hate re-picking |
| D5 | What never syncs | API keys, history, wizard state | Keys would land on Google's servers; history entries blow the 8 KB/item cap |
| D6 | Key storage on a new device | Keys stay local, so a second device asks once | Correct trade; the alternative is uploading secrets |
| D7 | Fill measurement | PDF.js text layer first, canvas ink-scan as fallback | Text layer is cheap but can be virtualized; the canvas is same-origin so pixels are readable and always right |
| D8 | Page unit | "Page-heights of content" = `(pages - 1) + lastPageFill` | Turns two pages that are 55% full into the honest 1.55, so the model of capacity is real |
| D9 | Overflow tolerance | `over: 1.0` — any projected overflow is a failure | The user asked for a limit |
| D10 | Guaranteed fit | Opt-in loop that applies, measures the real compile, regenerates, re-applies; max 3 rounds | The only way to *guarantee* is to look at the compiled output. Safe because the original is kept and restorable in one click |
| D11 | Triggering recompile | Click Overleaf's Recompile control if found; otherwise ask the user and poll | Same discipline as every other Overleaf internal: tolerant selector, degrade to instructions |
| D12 | PDF export | Download Overleaf's own compiled PDF | Skillo cannot compile LaTeX; Overleaf already did |
| D13 | Word export | Not shipping | Faithful LaTeX→docx needs a pandoc-class converter. A mangled .docx is worse than none — see §6 |
| D14 | ATS score is computed locally, no model call | Deterministic keyword matching | Coverage is a **fact**, not a judgement. A model asked "how ATS-friendly is this" would guess; counting which of the job's terms appear is exact, instant, free, and explainable down to the individual missing word |
| D15 | What the score reads | The compiled PDF's text layer when available, LaTeX-stripped text otherwise | An ATS parses the PDF, not the source. Matching what it actually sees is the only honest input — and it catches the case where text exists in the source but does not survive into the PDF |
| D16 | Reported as original → revised | Same shape as the match score | Keyword coverage is the one thing tailoring reliably improves, so the delta is real and earned |
| D17 | Naming | "ATS — keyword coverage and parseability", never a bare "ATS score" | No universal ATS number exists; every vendor scores differently. Claiming one would be the same dishonesty the no-fabrication rule exists to prevent |

---

## 3. Milestones

### W1 - Quick wins

**S1 score band.** `scoreBand(n)` helper + label beside the number in `MatchScoreCard`, and
in history. Colour follows the existing add/warn/cut tokens.

**S2 cursor.** In `globals.css`:
```css
button:not(:disabled), [role='button']:not(:disabled), [role='radio'], [role='switch'],
summary, a[href], label[for] { cursor: pointer; }
button:disabled { cursor: not-allowed; }
[draggable='true'] { cursor: grab; }
```
Then sweep for clickable `div`s that should be buttons.

**S3 settings sync.** Split storage:
- `chrome.storage.sync` — `activeProviderId`, per-provider `model`, `defaults`
- `chrome.storage.local` — per-provider `apiKey`, history, wizard state

`getSettings()` merges both; `saveSettings()` routes each field to the right area. Migrate
existing local settings on first read (read local, write the syncable half to sync, keep
keys local) so nobody loses their setup. Settings screen states plainly: *"Your choices
sync to other Chrome profiles signed in with this Google account. API keys stay on this
machine."*

**Verify:** unit tests for the split, the merge, and the migration; assert a key never
reaches sync. Manual: change settings on one machine, confirm on another.

**S9a ATS keyword coverage.** `src/lib/pipeline/atsScore.ts`, pure and model-free:

```ts
interface AtsResult {
  covered: string[];
  missing: string[];
  coverage: number;        // 0-1
  score: number;           // 0-10, banded like the match score
}
atsScore(profile: JobProfile, resumeText: string): AtsResult
```

- Terms come from `atsKeywords` ∪ `mustHaveSkills` ∪ `toolsAndTech`, de-duplicated
  case-insensitively.
- Matching is word-boundary and case-insensitive, and normalizes the punctuation that
  wrecks naive matching: `CI/CD` ≡ `CI-CD` ≡ `CICD`, `Node.js` ≡ `NodeJS`, `C++` and `C#`
  survive escaping. Multi-word terms match as phrases with flexible whitespace.
- Weighting: a `mustHaveSkills` term counts double — missing a must-have is not the same as
  missing a nice-to-have.
- Input text is LaTeX-stripped (drop comments, macros, keep argument text) in W1; W5
  upgrades the input to the PDF text layer.

Shown in Review **below** the match score, as `62% → 91%` with the missing terms listed.
Also stored on the history entry.

**S10 collapse behaviour.** `<Collapsible>` primitive in `ui.tsx`: a header row that is
always visible (title, headline figure, and a short "what you are not seeing" hint) plus
children revealed on toggle. Used by both score cards. Default collapsed; the choice
persists in synced settings (`ui.matchExpanded`, `ui.atsExpanded`).

**S11 sections open by default.** `SectionEditor` currently starts collapsed; start it
expanded instead. It is a thing to act on before generating, not a detail to go looking
for.

**S12 real headers, calmer chrome.** Section titles ("Soft skills", "ATS keywords",
"What changed") are currently `Eyebrow` — 10px, uppercase, letterspaced, muted. That is a
metadata caption, not a header, and with six of them stacked the panel is unscannable.

- New `SectionHeader`: 12.5px, semibold, **ink not muted**, sentence case, mono retained for
  identity, with an optional muted meta slot on the right for counts.
- `Eyebrow` survives only for genuine micro-labels (the error-code line).
- Bold stays in the *type*; it comes out of the *chrome* — 2px borders drop back to 1px on
  inputs and cards, relying on spacing and type weight for structure instead of boxes.
- More vertical rhythm between sections, less inside them.

Uppercase-plus-letterspacing everywhere is an editorial tic that reads dated; sentence-case
headers with real contrast read modern and are faster to scan. This is a refinement of the
v2 bolder pass, not a reversal of it.

**Verify:** unit tests for the punctuation variants, phrase matching, weighting, the
original→revised delta, and that a term appearing only in a LaTeX comment does not count.

### W2 - Privacy policy, repo, Pages

1. `PRIVACY.md` + `docs/privacy.html` (same content, styled to match the extension).
   Covers: what is collected (nothing by Skillo), what leaves the machine (resume + job
   text to the chosen provider only), where keys live, what syncs, retention, no analytics,
   no server, contact.
2. `gh repo create` (public), push all branches and tags.
3. Enable GitHub Pages from `/docs`; confirm the policy URL resolves.
4. Add the URL to `README.md` and keep it for the store listing.

**Verify:** the published URL loads and renders.

### W3 - Fill-ratio measurement and an honest page model

**`src/lib/overleaf/pageMetrics.ts`** — replaces `pageCount.ts`, returns:
```ts
interface PageMetrics { pages: number; lastPageFill: number; contentPageHeights: number }
```
- `pages` — as today, highest `data-page-number`.
- `lastPageFill` — on the last `.page`: try `.textLayer` spans, take
  `max(offsetTop + offsetHeight) / pageHeight`; if the text layer is absent or empty, scan
  the page canvas bottom-up for the lowest non-background row and use that. Returns `null`
  if neither works — never a guess.
- `contentPageHeights = (pages - 1) + lastPageFill`.

**Live verification before shipping**, exactly as the page-count selector was verified:
open a real Overleaf project, check both paths against a document whose fill is known by
eye, and record the numbers in §7.

**Budget rework** (`pageBudget.ts`):
- `charsPerPageHeight = bodyChars / contentPageHeights` (D8)
- `targetChars = charsPerPageHeight × pageLimit × SAFETY` where `SAFETY = 0.95`
- keep `calibrated` semantics; uncalibrated still falls back to the measured constant
- **fix C4**: capture metrics at *read* time and store them on `ResumeSource`
  (`sourcePages`, `sourceFill`), so the character count and the page count always describe
  the same document. Re-read refreshes both.

**Validator:** `over: 1.0` for calibrated budgets (D9); estimated budgets stay loose,
because failing a good revision over a guessed constant is worse than a soft warning.

**Pre-apply projection:** Review shows `projected ≈ 2.1 pages of 2` from the calibrated
model, with a warning when over. Labelled an estimate, because it is one.

**Verify:** unit tests for the new maths (including `contentPageHeights` with a part-full
last page, and the null path); fixtures for both measurement paths.

### W4 - Guaranteed fit

A **Fit exactly** toggle beside the page controls, off by default.

When on, after the user presses Apply:
1. Snapshot the current Overleaf text (already kept as the run's original).
2. Apply the revision.
3. Trigger a recompile (D11) and poll `pageMetrics` until it settles or ~30 s passes.
4. Evaluate:
   - `pages > limit` → regenerate with concrete feedback including the measured overshoot,
     re-apply
   - fill on and `lastPageFill < 0.85` → regenerate fuller, re-apply
   - otherwise → done, show the measured result
5. Stop after 3 rounds; report the best measured state honestly if it never converged.

Throughout: a persistent **Restore original** button that dispatches the snapshot back in
one transaction. Every step's state is visible — no silent rewriting of the user's file.

**Verify:** unit tests for the decision function (given metrics + settings → next action)
in isolation from the browser. Manual: force an overflow and watch it converge; force a
non-converging case and confirm it stops at 3 and says so; confirm Restore works at any
point.

### W5 - ATS: read the PDF, and check it parses

Upgrades W1's coverage score from an approximation of what the ATS reads to the real thing.

**Input swap.** When the compiled PDF is available, extract its text layer (the same layer
W3 measures for fill) and score against that instead of stripped LaTeX. This catches the
failure that matters most: a keyword that is in your source but does not survive into the
PDF as selectable text.

**Parseability checks**, each a concrete pass/fail rather than a vibe:

| Check | How | Why it matters |
|---|---|---|
| Text layer exists and is non-trivial | span count and character count | A resume that renders as an image scores zero at every ATS |
| Email and phone are extractable | regex over the extracted text | The single most common silent ATS failure |
| Reading order is sane | span `y` then `x` ordering vs visual order; flag large back-jumps | Multi-column layouts often extract interleaved and become nonsense |
| Section headings survive | the section titles from `latexSections` appear in the extracted text | Confirms structure is machine-visible |

Each failed check deducts from the parseability half of the score, and each names the
specific fix. If no PDF is available the checks are skipped and the score says so — never
a guess.

**Verify:** unit tests for each check against extracted-text fixtures, including a
two-column interleaving case and a no-text-layer case. Manual: run against the real
compiled resume and confirm the email/phone check actually finds them.

### W6 - Exports

- **Download PDF** in Review and History: locate Overleaf's compiled-PDF download
  (button or URL — verify live), trigger it. Falls back to a note if not found.
- **Download plain text**: from the section model, LaTeX markup stripped — genuinely useful
  for ATS paste-in, and honest about what it is.

**Verify:** manual, both paths; text export spot-checked for stray macros.

---

## 4. Publishing

Blocked on W4 (the overflow bug is a correctness bug the user has already hit). After W4:

1. `npm run zip:store`
2. Upload, fill listing, use the permission table in `README.md`, set the Pages privacy URL
3. Screenshots: job card, tailor controls, diff with match score, settings
4. On approval: put the assigned ID in `STORE_EXTENSION_ID`, `npm run bridge`, re-upload

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| ATS coverage is gamed by keyword stuffing | Coverage is reported, never optimised for: the tailoring prompt still forbids claiming unevidenced skills, and missing terms are shown as *gaps to be honest about*, not a checklist to pad |
| Users read the ATS number as a guarantee of passing a real ATS | Named "keyword coverage and parseability" throughout (D17), with a line saying vendors differ |
| Text layer or canvas measurement not available in some Overleaf state | Two independent methods, and `null` rather than a guess; budget falls back to the constant |
| The fit loop writes to the user's document repeatedly | Opt-in, capped at 3 rounds, original snapshotted, one-click restore, every step visible |
| Clicking Overleaf's Recompile is another undocumented internal | Tolerant selector; if absent, ask the user to press it and keep polling |
| `storage.sync` quota (100 KB, 8 KB/item) | Only small scalars sync; history and keys deliberately excluded |
| Migration loses someone's configured keys | Migration only ever *copies* the syncable half; keys are never moved or deleted |

---

## 6. Explicitly not doing

**`.docx` export.** Faithful LaTeX→Word needs a real converter (pandoc-class). Anything I
could write in-browser would drop or mangle formatting, and this product's whole premise is
that you can trust what comes out. Plain-text export covers the actual need (ATS paste-in)
without pretending. Revisit if a WASM converter proves viable.

**Syncing full history.** `chrome.storage.sync` caps items at 8 KB; one entry holds two
copies of a resume (~25 KB here). Metadata-only sync is possible later if wanted, but it
would show runs whose diffs cannot be opened on that device, which is a confusing product.

---

## 7. Findings during execution

Append as discovered. Reserved: measured `lastPageFill` values from the live check (W3),
whether Overleaf's Recompile control is reachable (W4), how reliably the PDF text layer
extracts on a real resume (W5), and how the PDF download is exposed (W6).
