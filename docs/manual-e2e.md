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
