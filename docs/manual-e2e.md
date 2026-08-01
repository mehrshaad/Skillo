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

*(to be filled in when the milestone lands)*

## M4 — Apply, history, hardening

*(to be filled in when the milestone lands)*

## M5 — Claude Code bridge

*(to be filled in when the milestone lands)*

## M6 — Polish and docs

*(to be filled in when the milestone lands)*
