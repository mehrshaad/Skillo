# Skillo

A Chrome side panel that tailors your Overleaf LaTeX resume to a specific job posting.

Paste a LinkedIn job link. Skillo reads the posting, works out what the employer
actually wants, reads your resume out of the Overleaf tab you already have open,
and rewrites it for that job. You review a diff before anything is written back.

It uses **your** model — an OpenRouter, OpenAI or Anthropic API key, or the
Claude Code already installed on your machine. There is no Skillo server, and
nothing is stored anywhere but your own browser.

## What it will not do

Skillo may reorder, rephrase, condense and cut. It is instructed never to invent
an employer, a date, a degree, a certification or a metric that is not already in
your resume or in the notes you write yourself. The diff exists so you can check
that for yourself, and nothing reaches Overleaf until you press Apply.

Treat the review step as load-bearing, not a formality.

## Install

Requires Chrome 116 or newer.

```bash
npm install
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, choose **Load
unpacked**, and select the `.output/chrome-mv3` folder. Click the Skillo icon to
open the side panel.

The extension id is pinned to `hfbincjmdcgfhffnpanjdfcccpejdkei` so the Claude
Code bridge keeps working across reloads.

## Set up a model

Open **Settings** from the panel header and pick one:

| Provider | What you need | Where to get it |
|---|---|---|
| OpenRouter | An API key. One key reaches Claude, GPT, Gemini and open models. | <https://openrouter.ai/keys> |
| OpenAI | An API key. | <https://platform.openai.com/api-keys> |
| Anthropic | An API key. | <https://console.anthropic.com/settings/keys> |
| Claude Code | Claude Code installed locally, plus a one-time bridge install (download one file, double-click it). No API key. | see [`bridge/README.md`](bridge/README.md) |

Paste the key, press **Browse models** to pull the live model list from that
provider, pick one, then **Test connection**. Press **Use \<provider\>** to make
it active. You can configure several and switch between them.

Model choice matters here. A whole resume is rewritten in one pass, so a
stronger model produces noticeably better results than a cheap one.

## Using it

1. **Job** — paste a LinkedIn job link and press *Get job details*, or open the
   posting in a tab and press *Use current tab*. If LinkedIn will not hand the
   posting over, paste the description into the box instead; that path always
   works. Then press *Analyze this job* and prune any keyword chips that do not
   apply to you.
2. **Resume** — with your resume project open in Overleaf's **Code Editor**,
   pick the tab from the list. You can also paste LaTeX or upload a `.tex` file.
   Optionally open **Sections** to reorder, rename, edit or remove sections
   before anything is rewritten — drag the cards, or use the arrow buttons.
3. **Tailor** — choose how much to change (*lowest* to *very high*, default
   *medium*), how many pages to fit (default 2), and whether the last page
   should end full. Add notes if you like ("lean on my Python work", "I led the
   migration"), then *Generate*. Notes are treated as facts about you, so the
   rewrite may use them.
4. **Review** — you get a match score, `before → after` out of 10, with the
   requirements the revision still does not evidence listed under it. Read the
   change summary and the diff, then *Apply to Overleaf*, or copy or download
   the LaTeX. If it is not right, *Regenerate with feedback* and say what to
   change.

**How much to change** never changes what is true. At *very high* Skillo
restructures and rewrites hard for the job; it still may not invent an
employer, a date, a degree or a metric. That rule is identical at all five
settings.

Applying replaces the document in a single edit, so **Ctrl+Z once in Overleaf
undoes it completely**. Recompile there to check the PDF.

Every run is kept under **history** in the panel header — the job, the diff and
the LaTeX, for the last 20 runs.

Privacy policy: <https://ali-dadashzadeh.ir/Skillo/privacy.html>

## Where your data goes

- **API keys** live in Chrome's local extension storage on this machine, in
  plain text. They are never synced to your Google account and never sent
  anywhere except the provider you chose.
- **Your resume and the job description** are sent to whichever model provider
  you selected, when you press Generate. With the Claude Code bridge they go to
  your local Claude Code install instead of a third party.
- **Everything else** — job postings, generated revisions, history — stays in
  your browser. There is no Skillo backend to send it to.

Job postings are read through your own browser, one at a time, when you ask for
one. That is the same access you have by opening the page yourself. Skillo does
not crawl LinkedIn or collect postings in bulk.

## Known limits

- **LinkedIn only**, for now. Any other site works through manual paste. The
  intake layer is structured so another site is a new extractor module.
- **One file.** Skillo tailors the document open in the editor. If your resume
  is split with `\input{}`, it says so and leaves the other files alone.
- **Overleaf free accounts** have no API, so Skillo drives the editor in the
  page. That relies on Overleaf internals: if Overleaf changes them, reading and
  writing will fail with an explanation, and paste-in/copy-out still works.
- **Signed-in LinkedIn pages** render with obfuscated markup and no description
  in the DOM, so tab-based extraction there is best-effort and flagged as such.
  The unauthenticated fetch path is the reliable one.

## Development

```bash
npm run dev        # load .output/chrome-mv3-dev, reloads on change
npm test           # unit tests
npm run compile    # typecheck
npm run build      # production build (also regenerates the bridge installers)
npm run bridge     # regenerate just the bridge installers
npm run icons      # regenerate the icons
```

`docs/manual-e2e.md` lists the checks that need a real browser, real accounts or
real keys, per milestone. `PLAN.md` records the design, every decision made
along the way, and the findings that changed those decisions during the build.

Layout worth knowing:

```
src/lib/jobIntake/     everything that knows about LinkedIn
src/lib/overleaf/      + src/entrypoints/overleaf*.ts — everything that knows about Overleaf
src/lib/providers/     one interface, four backends
src/lib/pipeline/      prompts, output parsing, LaTeX validation
bridge/                the local Claude Code host and its installers
```

If you find yourself writing a LinkedIn selector outside `jobIntake/`, an
Overleaf detail outside the Overleaf adapter, or LaTeX section parsing outside
`latexSections.ts`, put it back.

## Publishing to the Chrome Web Store

```bash
npm run zip:store   # → .output/skillo-<version>-chrome-store.zip
```

The store build drops the pinned `key` from the manifest, because the Web Store
assigns its own extension ID. Everything else is identical, including the bridge
installers that ship inside the package.

**After the first upload**, take the ID the store assigned and put it in
`STORE_EXTENSION_ID` in `scripts/build-bridge-installers.mjs`, then re-run
`npm run bridge` and re-upload. Until that is done, store users have to pass
their extension ID to the installer by hand — the Settings screen tells them how,
but it is a rough edge worth closing on the second upload.

Permissions to justify on the dashboard, and the honest reason for each:

| Permission | Why |
|---|---|
| `storage` | API keys, settings and run history, all local |
| `sidePanel` | the entire UI |
| `tabs` | find the user's open Overleaf and LinkedIn tabs |
| `scripting` | inject the Overleaf reader into a tab opened before install |
| `offscreen` | parse fetched job HTML (service workers have no DOM parser) |
| `nativeMessaging` (optional) | only requested if the user chooses the local Claude Code bridge |
| `*.linkedin.com` | read the job posting the user pasted |
| `www.overleaf.com` | read and write the user's resume document |
| `openrouter.ai`, `api.openai.com`, `api.anthropic.com` | call whichever model provider the user configured |

## License

MIT — see [LICENSE](LICENSE).
