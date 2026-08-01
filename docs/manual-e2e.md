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

*(to be filled in when the milestone lands)*

## M2 — Providers and settings

*(to be filled in when the milestone lands)*

## M3 — Resume input, tailoring, review

*(to be filled in when the milestone lands)*

## M4 — Apply, history, hardening

*(to be filled in when the milestone lands)*

## M5 — Claude Code bridge

*(to be filled in when the milestone lands)*

## M6 — Polish and docs

*(to be filled in when the milestone lands)*
