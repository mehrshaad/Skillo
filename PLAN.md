# Skillo — Execution Plan

**Chrome extension that tailors your Overleaf LaTeX resume to a LinkedIn job posting, using LLM backends you bring your own keys for (OpenRouter / Anthropic / OpenAI) or your locally installed Claude Code.**

This document is the complete, self-contained plan for building v1. It is written to be executed by an agent (Opus 5) milestone by milestone. Every open question has been decided; the decision log records what and why. Do not re-litigate decisions — if a decision proves impossible during implementation, stop and surface it rather than silently substituting.

---

## 1. Product summary

The user pastes a LinkedIn job URL into the extension's side panel (or clicks "Use current tab" while viewing a job). The extension extracts the full job posting, has an LLM analyze it into a structured profile (must-have skills, ATS keywords, seniority, etc.), reads the user's current LaTeX resume from their open Overleaf tab (or from paste/upload), and has the LLM produce a tailored revision of the resume. The user reviews a diff plus a change summary, optionally regenerates with feedback, and applies the result directly into the Overleaf editor as a single undoable edit.

**Hard product rules:**

1. **No fabrication.** The LLM may rephrase, reorder, emphasize, and trim — it may never invent employers, roles, dates, degrees, certifications, or skills not present in the source resume or the user's own notes. This is enforced in the prompt and by the human diff-review gate.
2. **Human gate before writing.** Nothing is ever written into Overleaf without the user explicitly clicking Apply on a reviewed diff.
3. **No Skillo server.** All data stays local except the calls to the LLM provider the user configured. Keys live in `chrome.storage.local` only (never `sync`).

---

## 2. Scope

### In scope (v1)

- Job source: **LinkedIn job postings** (all common URL shapes, logged-in and public).
- Resume source: **Overleaf editor tab** (read current open `.tex` doc), **paste LaTeX**, **upload `.tex` file**.
- Resume target: **Overleaf editor tab** (write), plus copy-to-clipboard and download `.tex`.
- LLM backends: **OpenRouter**, **OpenAI**, **Anthropic** (HTTP, user-provided keys), and **Claude Code** via a local native-messaging bridge (uses the user's existing Claude Code login; no API key).
- Optional free-text **user notes** fed into tailoring ("emphasize my Python work", extra context not in the resume).
- **History** of past runs (job, diff, output) stored locally.

### Out of scope (v1) — roadmap only

- Other job sites (Indeed, Glassdoor, company career pages) — the job-intake layer is built so a new site = a new extractor module.
- Overleaf Git bridge / Dropbox sync (premium features; user is on free plan).
- Multi-file LaTeX projects (`\input`/`\include`) — v1 operates on the single currently open doc; see §11.
- Per-hunk accept/reject in the diff review — v1 is accept-all or regenerate/cancel.
- Codex CLI bridge (same native-messaging pattern as Claude Code; add later).
- Generating a resume from scratch; cover letters.
- Firefox/Edge ports (Edge likely works as-is; don't spend time on it).

---

## 3. Decision log

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| D1 | Extension framework | **WXT** (wxt.dev) + React + TypeScript | Actively maintained MV3 framework; generates manifest, handles content-script entry points incl. MAIN-world injection, HMR dev flow. Less boilerplate than raw Vite multi-entry, healthier than CRXJS. |
| D2 | UI surface | **Chrome Side Panel** (not popup) | The workflow is multi-step and long-running (LLM calls, tab switching to Overleaf). Popups close on focus loss; side panel persists. Requires Chrome 116+, acceptable. |
| D3 | Styling | Tailwind CSS v4 | Fast to build a clean panel UI; executor should keep it minimal, no component library. |
| D4 | Provider architecture | One `LLMProvider` interface; **OpenAI-compatible client covers both OpenRouter and OpenAI** (different baseURL); separate small Anthropic client; Claude Code bridge implements the same interface | OpenRouter's API is OpenAI-compatible, so three of four backends are two clients. |
| D5 | LLM calls run from | **Background service worker** via `fetch` | With `host_permissions` on the provider domains, extension fetches bypass CORS. Panel never holds keys in DOM longer than needed. |
| D6 | Anthropic browser header | Send `anthropic-dangerous-direct-browser-access: true` | Harmless belt-and-suspenders; host permissions already bypass CORS, header guarantees it. |
| D7 | Job extraction strategy order | (1) LinkedIn **guest API** fetch → (2) **active tab** content script → (3) **background tab** with user session → (4) **manual paste** | Maximizes hands-off success while always having a fallback that cannot break. Details §6. |
| D8 | Overleaf write mechanism | **MAIN-world script drives CodeMirror 6** (`document.querySelector('.cm-content').cmView.view`, then `view.dispatch(...)`) | Free Overleaf has no API. Dispatching a CM6 transaction goes through Overleaf's own collab pipeline: it syncs to the server and is a single Ctrl+Z-able edit. Known-working technique used by Overleaf userscripts. Fragile → isolated in one adapter file with feature detection (§7). |
| D9 | Stage-2 output format | **Delimiter format**, not JSON (`===CHANGES===` / `===LATEX===` / `===END===`) | Embedding a whole LaTeX file inside a JSON string invites escaping corruption. Delimiters are trivial to parse and robust. Stage-1 (job analysis) stays JSON since it's small. §8. |
| D10 | Post-generation validation | Structural checks + one auto-retry | `\begin{document}`/`\end{document}` present, balanced braces heuristic, balanced environments, length within ±40% of original, no "% rest unchanged" markers. Fail → retry once with the error appended; fail again → show error, offer raw output. |
| D11 | Claude Code integration | **Native messaging host** (Node script) that runs `claude -p` headless, tools disabled | Extensions can't spawn processes; native messaging is Chrome's mechanism for talking to local software. Uses the user's existing Claude subscription — the key draw. Milestone M5. §9. |
| D12 | `nativeMessaging` permission | `optional_permissions`, requested when the user enables the Claude Code provider | Keeps install-time warnings minimal for users who only use HTTP providers. |
| D13 | Dev extension ID stability | Pin with `key` field in manifest for dev builds | Native-messaging host manifests whitelist the extension ID; unpacked IDs churn without a pinned key. WXT supports this via manifest config. |
| D14 | Key storage | `chrome.storage.local`, plaintext, with an explicit UI disclosure | Standard practice for BYO-key extensions; OS profile encryption is the boundary. Never `storage.sync` (would upload keys to Google account). |
| D15 | Diff library | `diff` (jsdiff) + small custom React renderer | `react-diff-viewer`-style deps are heavy/stale; a line-diff renderer over jsdiff hunks is ~100 lines. |
| D16 | Tests | **Vitest** for pure logic with HTML/text fixtures; **manual E2E checklist** per milestone | Automating real LinkedIn + Overleaf + Chrome-extension E2E is brittle and high-cost; unit-test everything deterministic, script the manual checks. |
| D17 | State | Wizard state in `chrome.storage.session`, orchestration in background SW; panel is a view | Survives panel close/reopen and SW restarts; MV3 service workers are ephemeral, so no in-memory-only state. |

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Chrome                                                          │
│                                                                 │
│  ┌──────────────┐   runtime    ┌──────────────────────────┐     │
│  │  Side Panel  │◄──messages──►│  Background Service      │     │
│  │  (React UI)  │              │  Worker (orchestrator)   │     │
│  └──────────────┘              │  • workflow state machine│     │
│                                │  • LLM HTTP clients      │──── fetch ──► openrouter.ai
│                                │  • job-intake pipeline   │──── fetch ──► api.openai.com
│                                │  • history/storage       │──── fetch ──► api.anthropic.com
│                                └───────┬──────────┬───────┘     │
│                                        │          │ connectNative
│                    runtime messages    │          ▼             │
│              ┌─────────────────────────┤   ┌──────────────┐     │
│              ▼                         ▼   │ Native host   │──► claude -p (headless)
│  ┌────────────────────┐  ┌────────────────┐│ (Node, stdio) │    (user's local Claude Code)
│  │ linkedin content   │  │ overleaf content│└──────────────┘    │
│  │ script (ISOLATED)  │  │ script (ISOLATED)                    │
│  └────────────────────┘  └───────┬────────┘                     │
│                                  │ window.postMessage           │
│                                  ▼ (origin-checked)             │
│                          ┌────────────────┐                     │
│                          │ overleaf MAIN- │  reads/dispatches   │
│                          │ world script   │  CodeMirror 6 txns  │
│                          └────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

### Repo layout

```
skillo/
├── PLAN.md                      (this file)
├── README.md                    (user install + usage + bridge install)
├── package.json
├── wxt.config.ts                (manifest config incl. dev `key`, permissions)
├── tsconfig.json
├── src/
│   ├── entrypoints/
│   │   ├── background.ts        (service worker: router + orchestrator)
│   │   ├── sidepanel/           (React app: index.html, main.tsx, App.tsx)
│   │   ├── linkedin.content.ts  (ISOLATED world, matches *.linkedin.com)
│   │   ├── overleaf.content.ts  (ISOLATED world, matches www.overleaf.com/project/*)
│   │   └── overleaf-main.content.ts (MAIN world, same matches)
│   ├── lib/
│   │   ├── messages.ts          (all runtime message types — single source of truth)
│   │   ├── state.ts             (WizardState machine + storage.session persistence)
│   │   ├── jobIntake/
│   │   │   ├── url.ts           (LinkedIn URL → jobId normalization)
│   │   │   ├── guestApi.ts      (strategy 1)
│   │   │   ├── tabExtract.ts    (strategies 2+3: DOM extraction, tab lifecycle)
│   │   │   ├── parseJobHtml.ts  (JSON-LD + selector parsing, shared by 1-3)
│   │   │   └── types.ts         (JobPosting)
│   │   ├── overleaf/
│   │   │   └── adapter.ts       (ALL Overleaf DOM/CM6 specifics live here)
│   │   ├── providers/
│   │   │   ├── types.ts         (LLMProvider, ChatMessage, ModelInfo)
│   │   │   ├── openaiCompatible.ts  (OpenRouter + OpenAI)
│   │   │   ├── anthropic.ts
│   │   │   ├── claudeCode.ts    (native messaging client)
│   │   │   └── registry.ts
│   │   ├── pipeline/
│   │   │   ├── prompts.ts       (system/user prompt builders — verbatim from §8)
│   │   │   ├── analyzeJob.ts    (stage 1: job text → JobProfile JSON)
│   │   │   ├── tailorResume.ts  (stage 2: latex+profile+notes → revision)
│   │   │   ├── parseOutput.ts   (delimiter parser, JSON extractor)
│   │   │   └── validateLatex.ts (structural checks, D10)
│   │   ├── storage.ts           (typed wrappers: settings, history)
│   │   └── diff.ts              (jsdiff wrapper → hunk model for renderer)
│   ├── components/              (React: JobCard, DiffViewer, ProviderSettings, …)
│   └── styles/
├── bridge/                      (Claude Code native host — own package)
│   ├── package.json
│   ├── host.mjs                 (stdio protocol + claude -p invocation)
│   ├── com.skillo.bridge.json.tpl  (host manifest template)
│   ├── install.ps1              (Windows: writes manifest + HKCU registry key)
│   ├── install.sh               (macOS/Linux)
│   └── README.md
├── tests/
│   ├── fixtures/                (saved LinkedIn HTML: guest-api response, logged-in DOM,
│   │                             public page with JSON-LD; sample resume .tex files;
│   │                             sample good/broken LLM outputs)
│   └── *.test.ts                (vitest)
└── docs/
    └── manual-e2e.md            (per-milestone manual verification checklist)
```

### Manifest (WXT-generated; key contents)

```jsonc
{
  "manifest_version": 3,
  "name": "Skillo — Resume Tailor",
  "minimum_chrome_version": "116",
  "permissions": ["storage", "sidePanel", "scripting", "tabs"],
  "optional_permissions": ["nativeMessaging"],
  "host_permissions": [
    "https://*.linkedin.com/*",
    "https://www.overleaf.com/*",
    "https://openrouter.ai/*",
    "https://api.openai.com/*",
    "https://api.anthropic.com/*"
  ],
  "side_panel": { "default_path": "sidepanel.html" },
  "key": "<dev key — generate once, keep in repo for stable unpacked ID (D13)>"
}
```

### Message protocol (`src/lib/messages.ts`)

All panel↔background↔content communication uses discriminated unions; define once, import everywhere:

```ts
type Msg =
  | { type: 'job/fetch'; url: string }                       // panel → bg
  | { type: 'job/useActiveTab' }                             // panel → bg
  | { type: 'job/extractFromDom' }                           // bg → linkedin cs
  | { type: 'overleaf/listTabs' }                            // panel → bg
  | { type: 'overleaf/read'; tabId: number }                 // panel → bg → overleaf cs
  | { type: 'overleaf/write'; tabId: number; content: string; expectedCurrent: string }
  | { type: 'pipeline/analyze' } | { type: 'pipeline/tailor'; notes: string }
  | { type: 'pipeline/regenerate'; feedback: string }
  | { type: 'provider/test'; providerId: string }
  | { type: 'provider/listModels'; providerId: string }
  | { type: 'state/get' } | { type: 'state/update'; patch: Partial<WizardState> }
```

Responses are `{ ok: true; data } | { ok: false; error: { code: string; message: string; detail?: string } }` — never throw across the message boundary. Error `code` is stable (e.g. `LINKEDIN_LOGIN_WALL`, `OVERLEAF_EDITOR_NOT_FOUND`, `LLM_TRUNCATED`, `VALIDATION_FAILED`) so the UI can show targeted guidance.

The MAIN-world ↔ ISOLATED-world channel on Overleaf uses `window.postMessage` with a namespaced `source: 'skillo'` field and strict `event.origin === 'https://www.overleaf.com'` checks both ways.

---

## 5. User flow (happy path)

1. User opens side panel. First run → Settings screen: pick provider, paste key, pick model, "Test connection".
2. **Step 1 — Job.** Paste LinkedIn URL (or "Use current tab"). Extension runs intake pipeline (§6), shows a Job Card: title, company, location, seniority, skill chips. If everything failed: textarea appears — "paste the job description manually".
3. **Step 2 — Resume.** Panel lists open Overleaf project tabs. User picks one (their resume project, main `.tex` open in the editor). Extension reads the doc, shows filename + line/char count as confirmation. Alternatives: paste LaTeX / upload `.tex`.
4. **Step 3 — Tailor.** Optional notes textarea. Click **Generate**. Progress: "Analyzing job…" (stage 1) → "Tailoring resume…" (stage 2) → validation.
5. **Step 4 — Review.** Change-summary bullets + line diff (old vs new). Buttons: **Apply to Overleaf** · Copy LaTeX · Download .tex · **Regenerate with feedback** (textarea → re-runs stage 2 with prior output + feedback).
6. **Apply.** Extension re-reads the current Overleaf doc; if it no longer matches what was read in step 3 (user edited meanwhile), warn and require re-read + re-diff. Otherwise dispatch the replacement transaction, store snapshot in history, show "Applied — recompile in Overleaf to check the PDF (Ctrl+Z in Overleaf undoes)".

Every step's state persists in `storage.session`; closing/reopening the panel resumes where the user left off. "Start over" button always visible.

---

## 6. Job intake (LinkedIn)

### 6.1 URL normalization (`url.ts`)

Accept and normalize to a numeric `jobId`:

- `linkedin.com/jobs/view/{id}` and `/jobs/view/{slug}-{id}`
- any LinkedIn URL with `currentJobId={id}` query param (search, collections, feed)
- regional subdomains (`*.linkedin.com`)
- `lnkd.in/*` short links → cannot resolve by regex; open in background tab and read final URL (strategy 3 handles this naturally)

Pure function, fully unit-tested against all shapes above plus garbage input.

### 6.2 Strategies, in order (stop at first success)

**S1 — Guest API fetch (background SW).**
`GET https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{jobId}` returns a server-rendered HTML fragment for many public postings without auth. Parse with `DOMParser`… **note:** service workers have no `DOMParser`; do the fetch in the SW but parse with a small regex/`linkedom`-free extractor, or fetch in SW and hand HTML to the panel (which has a DOM) via message for parsing. **Decision: parse in the side panel document** — panel is always open during the flow; keep the SW DOM-free. Extract: title, company, location, description text (`.description__text` / `.show-more-less-html__markup`), criteria list (seniority, employment type). 404/999/redirect-to-login/empty description → fall through.

**S2 — Active tab.** If the user's current active tab URL contains the same jobId, send `job/extractFromDom` to the LinkedIn content script. Extraction (`parseJobHtml.ts`, shared):
1. Prefer `<script type="application/ld+json">` with `"@type":"JobPosting"` when present (public/logged-out pages) — most stable.
2. Else logged-in DOM: description container (`.jobs-description__container` or `[class*="jobs-description"]`), read `innerText` (full text is in the DOM even when visually clamped behind "See more"); title from `h1`; company from the top-card company link; location/metadata from top-card spans. Use tolerant selector lists (try several, first match wins) — LinkedIn churns class names.
3. Else: grab `main` innerText as `descriptionText` with a `lowConfidence: true` flag; the UI shows it for user confirmation/edit.

**S3 — Background tab.** `chrome.tabs.create({ url, active: false })` → wait for `status === 'complete'` plus a 2.5s settle (LinkedIn hydrates late; poll for description selector up to 10s via injected check) → run the same extraction → `chrome.tabs.remove`. This rides the user's LinkedIn session, so login-walled postings work. If LinkedIn shows an authwall/challenge page, return `LINKEDIN_LOGIN_WALL` so the UI can say "open the job in a tab, log in, then click Use current tab".

**S4 — Manual paste.** Always-available textarea. Never blocked.

### 6.3 Output type

```ts
interface JobPosting {
  jobId: string | null; url: string;
  title: string; company: string; location: string;
  seniority?: string; employmentType?: string; workplaceType?: string;
  descriptionText: string;            // plain text, whitespace-normalized
  source: 'guest-api' | 'active-tab' | 'background-tab' | 'manual';
  lowConfidence?: boolean; extractedAt: string;
}
```

**ToS note for README:** extraction uses the user's own browser and session, on demand, one posting at a time — equivalent to the user reading the page. No crawling, no bulk collection. State this plainly in README.

---

## 7. Overleaf integration (`overleaf/adapter.ts` — the ONLY file allowed to know Overleaf internals)

Overleaf's editor is CodeMirror 6. Content scripts (ISOLATED world) cannot touch page JS, so a MAIN-world script does the editor work and talks to the ISOLATED script via origin-checked `postMessage`.

### 7.1 Editor handle (MAIN world)

```js
function getView() {
  const el = document.querySelector('.cm-content');
  const view = el?.cmView?.view;           // CM6 attaches ContentView at .cmView
  if (!view?.state?.doc || typeof view.dispatch !== 'function') return null;
  return view;
}
```

- **Read:** `view.state.doc.toString()` plus best-effort current filename from the file-tree's selected entry / editor tab header (tolerant selectors; filename is display-only, never load-bearing).
- **Write:** `view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: newText } })`. This flows through Overleaf's own change pipeline: it syncs to the server like typing and is one undo step.
- **Feature detection, not assumption:** if `getView()` returns null (Overleaf changed internals, doc not loaded yet, PDF-only layout, rich-text mode), return `OVERLEAF_EDITOR_NOT_FOUND` with guidance: "Open your resume's .tex file in the Overleaf **Code Editor** (not Visual Editor), then retry." Detect Visual Editor mode if identifiable and name it in the error.
- **Write safety (§5 step 6):** the `overleaf/write` message carries `expectedCurrent` (hash of the doc read at generation time). MAIN-world script re-reads, compares hash, refuses with `OVERLEAF_DOC_CHANGED` on mismatch. Panel then offers re-read + re-diff (diff against the fresh doc; the LLM output doesn't change).

### 7.2 Tab discovery

`chrome.tabs.query({ url: 'https://www.overleaf.com/project/*' })` → list `{tabId, title}` in the panel. Content scripts are declared for that match pattern; if Overleaf was opened before install, use `chrome.scripting.executeScript` to late-inject on demand.

### 7.3 Fallback (always works)

If the adapter fails at read or write: paste-LaTeX input and copy/download output. The product must remain fully usable with Overleaf integration completely broken.

---

## 8. LLM pipeline

### 8.1 Provider layer

```ts
interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
interface CompletionRequest { messages: ChatMessage[]; model: string; maxTokens: number; temperature: number }
interface LLMProvider {
  id: 'openrouter' | 'openai' | 'anthropic' | 'claude-code';
  complete(req: CompletionRequest): Promise<{ text: string; stopReason?: string }>;
  listModels?(): Promise<{ id: string; name: string }[]>;   // OpenRouter: GET /api/v1/models
  test(): Promise<void>;                                    // tiny completion round-trip
}
```

- `openaiCompatible.ts`: constructor takes `baseUrl` — `https://openrouter.ai/api/v1` or `https://api.openai.com/v1`. `POST /chat/completions`. For OpenRouter add optional `HTTP-Referer` / `X-Title` headers.
- `anthropic.ts`: `POST https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`. System prompt goes in top-level `system`, not messages.
- Model selection: OpenRouter → searchable dropdown from `listModels()`; OpenAI/Anthropic → curated defaults (look up current model IDs at implementation time — e.g. via the `claude-api` skill for Anthropic) plus a free-text override field. Never hardcode a model list as exhaustive.
- Errors: map HTTP 401 → "check key", 429 → retry with exponential backoff (2 attempts: 2s, 8s) then surface, 5xx → one retry. `stopReason` indicating truncation (`length` / `max_tokens`) → `LLM_TRUNCATED`, auto-retried once with `maxTokens` doubled (cap 16384).
- Defaults: temperature 0.3 (stage 1) / 0.5 (stage 2); maxTokens 2048 (stage 1) / 8192 (stage 2).

### 8.2 Stage 1 — Job analysis (JSON out)

System prompt (verbatim starting point; builder in `prompts.ts`):

> You are an expert technical recruiter and resume strategist. Analyze the job posting provided by the user and return ONLY a JSON object — no markdown fences, no commentary — with exactly these keys:
> `title` (string), `company` (string), `location` (string), `seniority` (string), `mustHaveSkills` (string[]), `niceToHaveSkills` (string[]), `responsibilities` (string[], max 8, condensed), `toolsAndTech` (string[]), `atsKeywords` (string[], the exact terms an ATS or reviewer would scan for, including variants like "CI/CD" vs "continuous integration"), `softSkills` (string[]), `summaryForTailoring` (string, 3-5 sentences: what this employer actually values and what a tailored resume should emphasize).
> If a field is not determinable, use "" or []. Do not invent information not present in the posting.

User message: title/company/location header + `descriptionText`.
Parsing: strip code fences if present, extract first balanced `{…}`, `JSON.parse`, validate shape with a lightweight guard (no zod dependency needed — hand-rolled checker is fine). On parse failure → one retry appending "Your previous reply was not valid JSON. Reply with ONLY the JSON object." Render result as an editable Job Profile card (chips removable — user can delete wrong keywords before tailoring).

### 8.3 Stage 2 — Resume tailoring (delimiter format out, D9)

System prompt (verbatim starting point):

> You are an expert resume writer working in LaTeX. You will receive: (1) a candidate's current resume as a complete LaTeX file, (2) a structured analysis of a job posting, (3) optional notes from the candidate.
> Produce a revised version of the SAME LaTeX file, tailored to this job.
>
> STRICT RULES:
> 1. NEVER invent employers, job titles, dates, degrees, certifications, projects, metrics, or skills that are not in the original resume or the candidate's notes. You may rephrase, reorder, condense, emphasize, and cut. You may surface a skill the resume already evidences (e.g. list "REST APIs" in a skills line if a bullet clearly shows API work).
> 2. Keep the documentclass, preamble, packages, and custom macro definitions unchanged unless a change is strictly required. Never switch template.
> 3. Preserve overall length: if the original fits one page, the revision must plausibly still fit one page (similar total content volume).
> 4. Weave in the job's ATS keywords where truthfully applicable, in natural phrasing.
> 5. Reorder bullets/sections so the most job-relevant material comes first within each section.
> 6. Output the COMPLETE file. Never truncate. Never write placeholders like "% rest unchanged".
> 7. The output must be compilable LaTeX: every \begin{x} matched by \end{x}, braces balanced, special characters escaped as in the original.
>
> OUTPUT FORMAT — exactly this structure, nothing before or after:
> `===CHANGES===`
> A markdown bullet list of every meaningful change and the reasoning (one line each).
> `===LATEX===`
> The complete revised LaTeX file.
> `===END===`

User message: job profile JSON + user notes (or "none") + original LaTeX.
**Regenerate with feedback** re-runs stage 2 with two extra messages: assistant = previous full output, user = "Revise according to this feedback: {feedback}. Same rules, same output format, complete file."

Parsing (`parseOutput.ts`): split on the three delimiters, tolerate surrounding whitespace/fences; missing delimiter → `LLM_BAD_FORMAT`, one auto-retry with format reminder.

### 8.4 Validation (`validateLatex.ts`, D10)

Checks on the extracted LaTeX: contains `\begin{document}` and `\end{document}`; environment stack balances (`\begin{x}`…`\end{x}` LIFO); brace balance ignoring `\{ \} %`-comments (heuristic — flag, don't hard-fail, on imbalance ≤ 2 since some templates are weird; hard-fail above); no `% rest unchanged`-style ellipsis markers (regex for `\.\.\.|rest (is |remains )?unchanged|unver[äa]ndert`); length within ±40% of original char count. Any hard failure → automatic single retry with the specific failure appended to the conversation; second failure → surface error, offer the raw output via copy/download anyway (clearly labeled "failed validation").

---

## 9. Claude Code bridge (Milestone M5)

**Goal:** `LLMProvider` #4 that routes `complete()` through the user's locally installed Claude Code (their existing subscription auth — no API key), via Chrome native messaging.

### 9.1 Native host (`bridge/host.mjs`, Node ≥ 18, zero npm deps)

- Speaks Chrome's native-messaging stdio protocol: read 4-byte little-endian length + UTF-8 JSON; write same. Host→Chrome messages must stay under 1 MB — resume-sized payloads are far below this, but chunk defensively anyway (`{type:'chunk', i, n, data}` reassembled extension-side) so it never becomes a bug.
- Request `{ id, type: 'complete', system, messages, maxTokens }` → spawn:
  `claude -p <prompt-file-or-stdin> --output-format json --max-turns 1` with tools disabled (`--disallowedTools "*"` — verify exact current flag syntax with `claude --help` at implementation time; the intent is pure text generation, no tool use, no file access). Pass the composed prompt via stdin. Parse the JSON result, return `{ id, ok: true, text }`.
- `{ id, type: 'ping' }` → `{ id, ok: true, version, claudeFound: boolean, claudePath }` (resolve `claude` on PATH; on Windows also check `%USERPROFILE%\.local\bin` and npm global bin).
- Timeout 180s per request; kill the child and return `{ ok:false, error:{code:'BRIDGE_TIMEOUT'} }`.
- Concurrency: one child at a time; queue depth 1; reject extras (`BRIDGE_BUSY`) — the extension never issues parallel completions anyway.

### 9.2 Install scripts

- `install.ps1` (Windows): copies `host.mjs` + generated `com.skillo.bridge.json` (with absolute `path` to a `.bat` shim that runs `node host.mjs`, and `allowed_origins: ["chrome-extension://<ID>/"]`) into `%LOCALAPPDATA%\Skillo\`; writes `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.skillo.bridge` → manifest path. Takes the extension ID as a parameter; README explains where to read the ID from `chrome://extensions`.
- `install.sh` (macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`; Linux: `~/.config/google-chrome/NativeMessagingHosts/`).
- Both print a success line and a test command. Uninstall flags (`-Uninstall` / `--uninstall`).

### 9.3 Extension side (`providers/claudeCode.ts`)

- Enabling the provider in Settings → `chrome.permissions.request({ permissions: ['nativeMessaging'] })` → `chrome.runtime.connectNative('com.skillo.bridge')` → `ping`. Status chip in Settings: Connected (version, claude found) / Host not installed (link to bridge README) / claude CLI not found (guidance).
- `complete()` maps the standard request onto a bridge message; correlates by `id`; single flight.
- Model/temperature fields hide for this provider (Claude Code decides the model; note this in the UI).

---

## 10. Storage, settings, history

```ts
// chrome.storage.local
interface Settings {
  activeProviderId: ProviderId;
  providers: {
    openrouter?: { apiKey: string; model: string };
    openai?:     { apiKey: string; model: string };
    anthropic?:  { apiKey: string; model: string };
    claudeCode?: { enabled: boolean };
  };
}
interface HistoryEntry {
  id: string; timestamp: string;
  job: JobPosting; jobProfile: JobProfile;
  originalLatex: string; revisedLatex: string; changeSummary: string;
  applied: boolean; providerId: string; model: string;
}
// history: HistoryEntry[] — newest first, capped at 20 (drop oldest; ~size guard 4MB total)
```

Settings screen shows, under the key fields: *"Keys are stored unencrypted in Chrome's local extension storage on this machine and are sent only to the provider you selected. Your resume and the job text are sent to that provider when you generate."*

History screen: list → detail (job card, diff, copy/download buttons, "reuse this job" action).

---

## 11. Edge cases & error handling (implement, don't improvise)

| Case | Behavior |
|------|----------|
| LinkedIn URL unrecognized | Inline validation; accept anyway via S3 (background tab follows any linkedin.com/lnkd.in URL) |
| All extraction strategies fail | Auto-open manual paste with explanatory text, prefill nothing |
| Job description suspiciously short (< 300 chars) | Warn chip on Job Card: "extraction may be incomplete — verify" |
| Overleaf tab has Visual Editor open | `OVERLEAF_EDITOR_NOT_FOUND` + specific guidance to switch to Code Editor |
| Overleaf doc changed between read and apply | `OVERLEAF_DOC_CHANGED` → offer fresh re-read + re-diff (D8/§7.1) |
| Resume uses `\input{}`/`\include{}` | Detect via regex on read → warning: "Multi-file project detected. Skillo v1 edits only this open file; sections in other files won't be tailored." Proceed allowed |
| Resume > 60k chars | Warn (token cost), require explicit continue |
| LLM returns truncated/malformed output | Auto-retry per §8.3/§8.4 (one attempt), then surface with raw-output escape hatch |
| Provider 401/429/5xx | Mapped messages + backoff per §8.1 |
| Panel closed mid-generation | Background SW continues; state in `storage.session`; panel reopen resumes into the right step |
| SW killed mid-generation (MV3 eviction) | Fetch keeps SW alive in practice; guard anyway: persist `phase` before each stage, on SW restart mark stale in-flight runs as failed with "Generation interrupted — retry" |
| User clicks Generate twice | Single-flight lock in SW state |

---

## 12. Milestones — build order, each with acceptance criteria

Execute strictly in order. Each milestone ends with its verification pass (unit tests green + the listed manual checks done and noted in `docs/manual-e2e.md`). Do not start milestone N+1 with N's checks failing.

### M0 — Scaffold
WXT + React + TS + Tailwind project; side panel opens from toolbar icon; background SW logs install; manifest per §4 (incl. dev `key`, D13); message router skeleton; typed storage wrappers; Vitest wired.
**Verify:** `npm run build` clean; load unpacked in Chrome → panel renders; a dummy settings value survives browser restart; extension ID stable across reloads.

### M1 — Job intake
`url.ts` + all four strategies + `parseJobHtml.ts` + Job Card UI + manual paste. Save real fixtures (guest-API response HTML, logged-in job page DOM snapshot, public page with JSON-LD) into `tests/fixtures/linkedin/`.
**Verify:** unit tests: URL forms of §6.1 (≥ 8 cases), JSON-LD parse, selector parse, guest-HTML parse. Manual: public job via URL paste (S1 hits); logged-in-only job with active tab (S2); same job with tab closed (S3 opens/closes a background tab); garbage URL → manual paste path.

### M2 — Providers (HTTP) + Settings
`openaiCompatible.ts`, `anthropic.ts`, registry, Settings UI (keys, model pickers incl. OpenRouter model search, test-connection), stage-1 `analyzeJob` end-to-end, Job Profile card with removable chips.
**Verify:** unit tests: request shaping per provider (mock fetch), JSON extraction incl. fenced/dirty replies, backoff logic. Manual: test-connection succeeds on all three providers with real keys; analysis of a real job renders a sensible profile; a wrong key shows the 401 message.

### M3 — Resume input + tailoring + review
Overleaf adapter read path (MAIN-world script, postMessage bridge, tab list UI), paste/upload inputs, `tailorResume` + `parseOutput` + `validateLatex`, diff (jsdiff + renderer), change summary, notes field, regenerate-with-feedback.
**Verify:** unit tests: delimiter parser (good/missing/fenced), every validator rule with broken-fixture inputs, diff hunk model. Manual: read a real Overleaf resume — panel char count matches editor; generate against a real job — diff renders, summary matches diff reality; feedback regenerate changes output accordingly; Visual-Editor tab produces the guided error.

### M4 — Apply + history + hardening
Write path with `expectedCurrent` guard, history store + screen, copy/download, all §11 rows implemented, single-flight lock, resume-on-reopen.
**Verify:** manual: apply → Overleaf shows new content, syncs (reload project page — content persisted), single Ctrl+Z restores; edit doc in Overleaf between generate and apply → guarded warning appears; history entry complete; panel closed during generation → reopen lands on progress/result.

### M5 — Claude Code bridge
Everything in §9. Test on Windows first (user's platform), scripts for macOS/Linux included.
**Verify:** manual on Windows: `install.ps1` → Settings shows Connected with version; full generate flow via Claude Code provider; kill scenario (uninstall host) → clean "host not installed" state, no hang; timeout path (unplug: rename claude binary) → `BRIDGE_TIMEOUT` surfaced.

### M6 — Polish + docs
Onboarding empty-states, loading skeletons, error-message pass (every `code` has human guidance), README (install, provider setup incl. where to get each key, bridge install walkthrough, ToS/privacy notes §6.3/§10), `docs/manual-e2e.md` finalized, demo GIF of the happy path.
**Verify:** fresh-profile Chrome walkthrough following only the README, zero prior knowledge, completes the happy path.

---

## 13. Risks

| Risk | Mitigation |
|------|-----------|
| LinkedIn DOM/endpoint churn or anti-bot friction | 4-layer strategy; selectors as tolerant lists in one file; manual paste guarantees function; fixtures make breakage visible in tests |
| Overleaf CM6 internals (`.cmView`) are undocumented and can change | Single adapter file; feature-detect + guided errors; paste/copy fallback keeps product usable; revisit Git-bridge path if user upgrades to premium |
| LLM fabricates resume content | Prompt rules + human diff gate; change summary forces the model to declare edits; validation blocks truncations |
| Whole-file LLM rewrite corrupts LaTeX | Validators + one-retry loop + user recompiles in Overleaf before anything is final; single-undo restore |
| Native messaging setup friction (registry, extension ID) | Scripted install with ID parameter; pinned dev key (D13); status chip diagnoses each failure mode distinctly |
| MV3 SW eviction mid-flow | State persisted per phase; stale-run recovery (§11) |
| `claude -p` CLI flags change | Bridge probes `claude --help` at implementation time; version reported in ping; flags kept in one constant |

---

## 14. Instructions to the executing agent

1. Work milestone-by-milestone (§12); finish each verification pass before proceeding. Keep a running checklist in `docs/manual-e2e.md`; manual checks that require the user (real keys, real Overleaf/LinkedIn accounts, bridge install) — stop and ask the user to perform them, listing exact steps.
2. All Overleaf specifics stay in `overleaf/adapter.ts`; all LinkedIn parsing in `jobIntake/`. If you find yourself writing a LinkedIn selector outside `jobIntake/` or an Overleaf detail outside the adapter, stop and refactor.
3. Prompts in §8 are the starting text — copy them verbatim into `prompts.ts`, then tune only if verification shows concrete failures (record tunings in a comment block above the prompt).
4. Look up current model IDs and `claude` CLI flag syntax at implementation time; do not trust this document's examples as current.
5. Commit per milestone at minimum (plain messages, no co-author lines per user's global CLAUDE.md). Don't push unless asked.
6. If a decided approach turns out to be technically impossible (e.g. `.cmView` gone from Overleaf), do not silently substitute — implement the documented fallback, then surface the finding to the user with what you observed.
