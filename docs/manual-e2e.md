# Manual verification checklist

Automated tests cover the deterministic logic (URL parsing, HTML extraction, output
parsing, validators, diffing). Everything below needs a real browser, real accounts
or real API keys, so it is checked by hand.

Load the extension once: `npm run build`, then `chrome://extensions` → enable
**Developer mode** → **Load unpacked** → select `.output/chrome-mv3`.

Status key: `[ ]` not yet run · `[x]` passed · `[!]` failed (note underneath).

---

## M0 — Scaffold

- [ ] `npm run build` completes without errors *(verified in CI-style run: clean)*
- [ ] `npm run compile` (typecheck) passes *(verified: clean)*
- [ ] `npm test` passes *(verified: 3/3)*
- [ ] Extension loads unpacked with no manifest errors
- [ ] Extension ID reads exactly `hfbincjmdcgfhffnpanjdfcccpejdkei` on `chrome://extensions`
      (this is what the Claude Code bridge will whitelist — if it differs, the pinned
      `key` in `wxt.config.ts` is not being applied)
- [ ] Clicking the toolbar icon opens the Skillo side panel and it renders the header
      and the four step chips
- [ ] Background worker logs `[skillo] installed: install` — open it via the
      "service worker" link on the extension card
- [ ] Storage round-trip survives a browser restart: in the service worker console run
      `await chrome.storage.local.set({ settings: { activeProviderId: 'openrouter', providers: {} } })`,
      fully quit and reopen Chrome, then open the panel — the header shows
      "Provider: openrouter"
- [ ] Reload the unpacked extension: the ID stays the same

## M1 — Job intake

Automated already: 38 unit tests, including the parser run against real saved responses
for two live postings, and the strategy ladder with `fetch` mocked.

- [ ] Paste `https://www.linkedin.com/jobs/view/4432351584` → the Job card shows
      "Back-end Software Engineer", CtrlChain, Eindhoven, chips for Mid-Senior level and
      Full-time, and the badge "fetched from LinkedIn"
- [ ] The description preview is the actual posting, and the character count looks like a
      full description (thousands, not hundreds)
- [ ] Paste a job URL in the `?currentJobId=` form from a LinkedIn search page → same result
- [ ] Paste a URL for a job that no longer exists → "LinkedIn says this job posting does
      not exist", not a generic failure
- [ ] Paste `https://example.com/jobs/1` → the error points you at manual paste, and the
      paste box opens by itself
- [ ] Open a job in a tab, then click **Use current tab** → a posting is captured. Expect
      the "could not find LinkedIn's description markup" warning on signed-in pages: that
      is the documented fallback (finding F2), not a bug. Confirm the excerpt shown is
      recognisably the job
- [ ] Paste a description manually with fewer than 300 characters → the button stays
      disabled; with a real description → the Job card appears with the "pasted by you" badge
- [ ] After a job is captured, closing and reopening the panel still shows it (session state)
- [ ] **Use a different job** clears the card and returns to the input

## M2 — Providers and settings

Needs your own API keys. Automated already: request shaping per provider against a
mocked `fetch`, error mapping, backoff, JSON extraction, and the analyze retry path.

- [ ] Settings → OpenRouter → paste key → **Browse models** lists models → pick one →
      **Test connection** reports "connection works"
- [ ] Same for OpenAI
- [ ] Same for Anthropic
- [ ] Deliberately break a key (change one character) → **Test connection** says the provider
      rejected the key, not a generic failure
- [ ] Set a model id that does not exist → the error names the model, not the key
- [ ] **Use <provider>** sets it active; the header shows the provider name; reopening the
      panel still shows it
- [ ] With a job captured, click **Analyze this job** → the profile card shows a summary plus
      chips for must-have skills, tools, and ATS keywords
- [ ] Click a chip → it disappears, and it stays gone after closing and reopening the panel
- [ ] Analyze a job with no provider configured → the error tells you to open Settings

## M3 — Resume input, tailoring, review

Needs a real Overleaf project and a configured model. Automated already: the LaTeX
validators against broken fixtures, the diff model, and every branch of the tailoring
retry logic (format failure, validation failure, truncation).

- [ ] With an Overleaf project open on your resume's `.tex` in the **Code Editor**, step 2
      lists the tab; clicking it shows the filename and a character count that matches the
      real document (check the end of the file is present, not just the start)
- [ ] Switch the Overleaf tab to the **Visual Editor** (or open the PDF-only view) and read
      again → the error tells you to switch to the Code Editor rather than failing generically
- [ ] Open Overleaf *after* the extension was loaded, without reloading the tab → reading
      still works (the content scripts are injected on demand)
- [ ] Paste tab: pasting a fragment with no `\documentclass` keeps the button disabled and
      explains why; pasting a full file works
- [ ] Upload tab: uploading a real `.tex` works; uploading a non-LaTeX text file is refused
- [ ] A resume using `\input{}` shows the multi-file warning naming the included files
- [ ] Step 3: **Generate** shows "Reading the job posting…" then "Rewriting your resume…"
- [ ] Close the panel mid-generation, reopen → the result is there (or it is still running)
- [ ] Step 4: the change summary describes real edits, and the diff shows those same edits —
      spot-check that at least one summary bullet matches a diff line
- [ ] **Read the diff for invented content.** Every company, date, degree and metric in the
      new version must appear in the old version. This is the check the whole design leans on
- [ ] Copy LaTeX puts the full file on the clipboard; Download .tex saves a file that opens
- [ ] Regenerate with feedback ("keep the education section where it was") visibly changes
      the next revision
- [ ] Paste the result into Overleaf by hand and recompile — it builds without LaTeX errors

## M4 — Apply, history, hardening

The write path touches your real document. **Do this first on a throwaway Overleaf
project**, not on your actual resume.

- [ ] Generate against a scratch project, click **Apply to Overleaf** → the editor content
      becomes the revised LaTeX
- [ ] Reload the Overleaf project page → the change is still there (it synced to the server,
      it was not just a local DOM edit)
- [ ] Press Ctrl+Z **once** in Overleaf → the whole document reverts to the original
- [ ] Recompile in Overleaf → the PDF builds
- [ ] Stale-document guard: generate, then type something into the Overleaf document, then
      click Apply → it refuses and explains the document changed. Click **Re-read the document
      and re-diff** → the diff now compares against the edited document, and Apply works
- [ ] Apply a second time without regenerating → the button reads "Applied" and is disabled
- [ ] Now repeat the apply on your real resume project
- [ ] History: the run appears with the job title, and is marked applied
- [ ] Open a history entry → the diff and change summary are intact; Copy LaTeX works
- [ ] Generate more than 20 times (or edit storage) → only the newest 20 are kept
- [ ] Interrupted-run recovery: start a generation, then reload the extension from
      `chrome://extensions` mid-run → reopening the panel shows "the last generation was
      interrupted", not a spinner that never resolves
- [ ] Press Generate twice quickly → the second press is refused with "already being generated"

## M5 — Claude Code bridge

Already verified on this machine, outside Chrome: the installer wrote the host, launcher,
manifest and registry key; driving the installed `.bat` with real native-messaging framing
returned a correct `ping` (host 0.1.0, `claude.exe` found) and a correct `complete`
(system prompt honoured, text extracted). Unknown request types are rejected cleanly and
two framed messages in one write are both handled. What remains needs Chrome itself.

- [ ] Settings → Claude Code → **Connect** → Chrome asks for the native messaging
      permission → after approving, the status reads *connected* with a host version
- [ ] **Use Claude Code** makes it the active provider; the header shows `claude-code`
- [ ] Analyze a job with Claude Code active → a profile comes back
- [ ] Generate a full resume revision with Claude Code active → the diff looks sane
- [ ] Deny the permission prompt → the error says the permission is needed, and Skillo
      stays usable on the HTTP providers
- [ ] Uninstall the host (`.\install.ps1 -Uninstall`), restart Chrome, press Re-check →
      status returns to *not connected* with the installer instructions, and nothing hangs
- [ ] Reinstall, then temporarily rename `claude.exe` and press Re-check → the status says
      the bridge is running but cannot find `claude`, distinct from *not connected*
- [ ] macOS or Linux, if you use one: `./install.sh` then the same connect flow

## M6 — Polish and docs

- [ ] The toolbar icon shows the Skillo check mark, not Chrome's default puzzle piece
- [ ] Fresh-profile walkthrough: in a brand-new Chrome profile, follow only `README.md`
      from a clean checkout and get all the way to an applied resume without needing
      anything that is not written down
- [ ] Every error you can provoke names what to do next, not just what failed
- [ ] Keyboard only: tab through the panel — focus is always visible, and every step can
      be completed without a mouse

---

# v2

## V1 — Cosmetics

Automated already: name string in the built manifest, and the 16px icon decoded to
confirm the two bars are separated by a clear 2px band.

- [ ] `chrome://extensions` shows the name as **Skillo - Resume Tailor** with a plain
      hyphen
- [ ] The toolbar icon is the new two-bar mark and is legible in the toolbar at its real
      size
- [ ] Every screen still reads well at the panel's narrowest (drag the side panel edge in
      as far as Chrome allows, around 360px): nothing clips, wraps badly, or overflows
      horizontally — check job card, settings, resume list, diff, history
- [ ] The bolder pass reads as intentional rather than heavy — headings and buttons carry
      weight, body text is still comfortable to read

## V2 — Fit level and page limit

Automated already: prompt assembly (one level block each, no-fabrication rule byte-identical
across all five, budget numbers in the text), budget maths including the fallback,
validator thresholds for both calibrated and estimated budgets, and the page-count reader
against PDF.js-shaped DOM including the virtualized and gutter-confusion cases.

- [ ] Fit level and page controls appear on step 3, default to **medium** and **2 pages**
- [ ] Arrow keys move both level bars while focused; the caption under the fit bar changes
      with it
- [ ] Generate at **lowest**, then regenerate the same job at **very high** — the two
      diffs must differ in the described direction (lowest mostly reorders; very high
      rewrites and cuts). This is the check that the level actually reaches the model
- [ ] **At very high, re-read the diff for invented content.** Nothing may appear that is
      not in the original or your notes. If it does, that is a bug, not a setting
- [ ] Set the page limit to 1 on a 2-page resume → the revision is visibly shorter
- [ ] Turn on **Fill the last page** → the result does not end with a mostly-empty page
- [ ] Your chosen fit level and page limit are remembered on the next run
- [ ] After Apply, press **Check compiled page count** — with the Overleaf PDF pane open
      and compiled, it reports the real number
- [ ] Force an overflow (set limit 1 on a long resume, apply, recompile) → it offers
      **Regenerate shorter**, and the regeneration is actually shorter
- [ ] Close the Overleaf PDF pane and check again → it says it could not read the count
      rather than reporting a wrong one

## V3 — Match score

Automated already: parsing, clamping out-of-range and string scores, dropping non-string
gaps, the retry, and that both resumes are sent labelled A and B.

- [ ] After generating, the Review step opens with `original → revised` out of 10 and a
      one-line rationale
- [ ] The remaining-gaps list names things genuinely missing from your resume — sanity
      check a couple against the job posting
- [ ] Generate at **lowest** and again at **very high** for the same job — the revised
      score should not go *down* at the higher setting
- [ ] Score inflation check: generate against a job you are clearly unqualified for. The
      revised score should stay low. If every job scores 8+, the scoring prompt is
      flattering and needs tuning — note it rather than adjusting the number
- [ ] The score is stored with the run and still shows when reopening it from history
- [ ] Break scoring deliberately (revoke the API key right after the diff appears, or use
      a model that refuses) → the revision still appears, just without a score

## V4 — Section editor

Automated already: byte-identical round-trip on three structurally different templates
(`\section`, `rSection` environments, a custom `\cvsection` macro), reorder/remove/rename/
add/body-edit operations, the null cases (no document environment, fewer than two
sections, mixed conventions, unbalanced title), and the write-guard interplay — including
that a locally restructured working copy still applies, and that a hash of the working
copy would wrongly block it.

- [ ] With your real resume loaded, expand **Sections** — the list matches the real
      sections in the right order
- [ ] Drag a card to a new position → the order changes
- [ ] Reorder using only the ▲/▼ buttons, no mouse → same result
- [ ] Rename a section → the new name is what appears in the generated LaTeX later
- [ ] Expand a section, edit its body, collapse → the edit sticks
- [ ] Remove a section → **undo** restores it in its original position
- [ ] **Add section**, then **reset to as-loaded** → back exactly as it was
- [ ] Edit sections after generating → the old revision is cleared, because the diff
      baseline moved
- [ ] Generate after reordering → the output follows the new order
- [ ] Apply after reordering, with the Overleaf document untouched → it applies. This is
      the case the hash split exists for
- [ ] Reorder locally, then also edit the document in Overleaf, then apply → refused with
      the stale-document warning
- [ ] Load a resume whose template Skillo cannot slice (or a fragment) → the Sections
      block simply does not appear, and everything else still works

## V5 — Distribution

Already verified on this machine, outside Chrome: the generated
`skillo-bridge-setup.bat` installs from a clean state (host, launcher, manifest, registry
key), the embedded host is byte-identical to `bridge/host.mjs` (SHA-256 match), driving the
installed launcher with real native-messaging framing returns a correct ping and a real
completion, and `--uninstall` followed by a reinstall both work. The store build was
confirmed to carry no `key`, and to include the installers in both the unpacked package and
`zip:store`.

- [ ] Settings → Claude Code shows the three numbered steps with a **Download** link
- [ ] Clicking Download saves the installer (Chrome may warn about a `.bat` — that is
      expected for any downloaded script)
- [ ] Run the downloaded installer, restart Chrome, reopen Settings → the status flips to
      **connected on its own**, without pressing anything
- [ ] Generate a full resume revision with Claude Code active
- [ ] Run `--uninstall`, restart Chrome, reopen Settings → back to the three steps
- [ ] macOS or Linux, if you have one: the `.sh` installer does the same job
- [ ] `npm run zip:store` produces a zip; upload it to the Web Store dashboard
- [ ] **Record the assigned extension ID** in `scripts/build-bridge-installers.mjs`
      (`STORE_EXTENSION_ID`), then `npm run bridge` and re-upload — until then, store users
      must pass their ID to the installer by hand
- [ ] Note in PLAN.md section 12 whether the store accepted a manifest containing `key`
      (this build strips it either way)

---

# v3

## W1 — Score band, ATS coverage, sync, collapsibles, headers

Automated already: 27 tests for keyword matching (`CI/CD` ≡ `CI-CD` ≡ `CICD`, `Node.js` ≡
`NodeJS`, `C++`/`C#` kept distinct from `C`, `Go` not matching inside `Google`, multi-word
across a line break), LaTeX-to-text extraction including comments and preamble exclusion,
weighting, and the storage split — including an assertion that an API key never appears
anywhere in sync storage, and that a pre-split settings blob migrates without the user
re-pasting keys.

- [ ] Review shows **Match** first, then **ATS keywords**, both collapsed, each showing its
      headline figure and a hint of what is hidden (`18 gaps`, `3 missing`)
- [ ] Expanding one and reopening the panel keeps it expanded — and it stays expanded in a
      second Chrome profile signed into the same Google account
- [ ] The match score shows a band word (`low`, `moderate`, …) next to the number
- [ ] ATS missing terms are ones genuinely absent from your resume — spot-check three
- [ ] ATS coverage goes **up** after tailoring
- [ ] Sections on step 2 are **open by default**
- [ ] Every clickable thing shows a pointer cursor; disabled buttons show not-allowed; the
      section drag handle shows grab
- [ ] Section headings ("Soft skills", "ATS keywords", "What changed") read as headings —
      dark, sentence case, scannable — not as tiny grey captions
- [ ] **Keys did not have to be re-pasted** after this update (the migration ran)
- [ ] On a second machine signed into the same Google account: provider, model, fit level,
      page limit and fill toggle all arrive; the API key field is empty and asks once
