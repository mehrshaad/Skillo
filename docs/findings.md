# Platform findings

Things about LinkedIn, Overleaf, Chrome and the Claude CLI that were established by
probing the real systems, usually after an assumption turned out to be wrong. They are
recorded because the code depends on them and none of them are documented anywhere else.

If you change code near one of these, re-verify it rather than trusting this file — these
are observations of other people's products, and they move.

---

## LinkedIn

**No JSON-LD.** Checked on live postings through both the `jobs-guest` API and the public
page: zero `application/ld+json` blocks. The JSON-LD parser still exists because it is the
most stable shape when a site does emit it, but nothing may depend on it. The real primary
path is the `topcard__*` / `description__job-criteria-*` classes.

**Signed-out beats signed-in.** A credential-less fetch returns clean semantic markup. The
same URL loaded in a signed-in browser returns a React shell with hashed class names
(`_26d811e2 f059b78b`), no data attributes, no embedded job JSON, and no description in the
DOM at all. So background fetches deliberately set `credentials: 'omit'` — sending cookies
makes the result *worse*. This is load-bearing, not incidental.

**Requests from the extension are fine.** An extension `Origin` header does not change the
response (description byte-identical at 4927 chars across header combinations). A bogus job
id returns a clean 404.

## Overleaf

**The editor handle works.** `.cm-content → cmView.view` resolves on a real project,
`view.dispatch` is callable, and `view.state.doc.toString()` returns the document. Verified
against production. Replacing the whole document in one transaction syncs like a manual edit
and undoes in a single Ctrl+Z.

**Page count comes from PDF.js page elements.** There is no "N of M" text indicator in the
toolbar. The preview renders one `.page` element per page inside `.pdfViewer`, each carrying
`data-page-number`. Take the **highest** number rather than counting elements, because
canvases are virtualized while placeholder elements persist.

**Page fill cannot be measured.** This one cost several attempts:

- `.textLayer` does not exist at all — span count is zero on every page.
- The canvas fallback only works on pages the viewer has rendered, and with a two-page
  document only **one** canvas exists at a time.
- Scrolling the last page into view does not help. Setting `scrollTop` on
  `.pdfjs-viewer-inner` genuinely moves the viewport, and five seconds later the last page
  still has no canvas.
- Loading the PDF directly through the exposed `pdfjsLib` was rejected on a different
  ground: the compiled-PDF URL carries authentication in its query string.

So Skillo cannot read fill — **but the user can see it**, so they report it with a slider
("this came out to about 1.3 pages"). A reported fraction is strictly better than anything
Skillo could measure for itself: an integer page count only *bounds* the capacity, whereas
a fraction pins it at `bodyChars / pages`. One drag calibrates every future run on that
template, and the median of several readings absorbs a careless one.

**Page capacity is learned from page counts instead.** An integer page count is a step
function of content, so each compile bounds the capacity `C` of one page:

```
(P-1) · C  <  B  ≤  P · C      B = body characters, P = pages
⇒  C ≥ B / P      and, when P > 1,      C < B / (P-1)
```

Budgets are built from the lower bound, which cannot overflow by construction. Observations
accumulate per template (keyed by a hash of the preamble, since the preamble sets density)
and arrive free: every document read gives one, every post-apply page check gives another.
Before anything is learned, the fallback is **3600 characters per page**, measured from a
real two-page article-class resume (7288 body characters over 2 pages).

## Model providers

**Never send `temperature`.** Current Anthropic models reject `temperature`, `top_p` and
`top_k` with a 400, and a user can point OpenRouter at an Anthropic model, so no
per-provider conditional is safe. It is absent from the request type entirely, with a test
asserting it is never sent.

**Model lists are fetched, not hardcoded.** All three providers expose a models endpoint, so
no model id is baked into the source and nothing goes stale.

## Claude CLI (verified against v2.1.220)

```
claude -p --tools "" --output-format json --system-prompt <text>
```

with the prompt on stdin. `--tools ""` disables every tool, which is exactly the
no-file-access sandbox wanted. The reply text is `result` in the returned JSON, with
`is_error` alongside. On Windows the binary is `claude.exe` in `%USERPROFILE%\.local\bin`.

Chrome cannot execute a `.mjs` on Windows, so the installer writes a `.bat` launcher with
the resolved Node path baked in and points the host manifest at that.

## Chrome and WXT

- `browser` comes from `wxt/browser`; there is no `@types/chrome` and the global `chrome`
  namespace is not typed.
- `publicDir` resolves from the **project root**, not `srcDir`. Icons under `src/public/`
  are silently ignored — no error, just no `icons` key in the manifest.
- Injectable script paths must match the generated `.wxt/types/paths.d.ts` union, and
  `runtime.getURL` needs a literal path — a template string widens to `string` and fails to
  typecheck.
- **MV3 injects declarative content scripts at navigation time only.** A tab already open
  when the extension is installed, updated, reloaded or re-enabled has no content script in
  it, and `tabs.sendMessage` rejects with `Could not establish connection. Receiving end
  does not exist.` This is not an error state to report — `sendToTab` matches that wording,
  injects via `scripting.executeScript`, and retries once. It caused the reported bug where
  "Use current tab" failed on a LinkedIn tab that predated the extension.
- When injecting the Overleaf pair, the **MAIN-world script goes first**: the ISOLATED
  bridge posts to it, so its listener should exist before anything can call.
- `wxt build --mode store` writes to `.output/chrome-mv3-store/`, not the default directory.
  Reading the default one after a store build shows the *dev* manifest.
- Tailwind v4's Preflight dropped `cursor: pointer` on buttons. One global rule restores it.
- `storage.sync` caps items at 8 KB and totals at 100 KB, which is why settings sync and
  history does not.
- `.gitattributes` must pin LF on `*.sh` and `bridge/host.mjs`, or they are checked out with
  CRLF and fail at the shebang off Windows.

## Windows installer

The bridge installer is a batch/PowerShell polyglot: line one is batch that re-runs the rest
of the same file through PowerShell. This avoids batch escaping and the ~32k limit on
`-EncodedCommand`, which the embedded host would approach. Two bugs found by running it
rather than reading it:

- `[scriptblock]::Create((...) -replace 'a','b')` passes **two** arguments, because
  PowerShell reads the comma as an argument separator. The expression needs its own
  parentheses.
- The `.bat` must be written with CRLF endings.

## Chrome Web Store

The store assigns its own extension id, so `--mode store` drops the pinned `key`. The bridge
installer allowlists both the dev id and the store id, and the store id must be filled into
`STORE_EXTENSION_ID` in `scripts/build-bridge-installers.mjs` after the first upload —
until then store users have to pass their id to the installer by hand.
