# Publishing Skillo to the Chrome Web Store

Everything in the repo is ready. What is left is four captures, one upload, and
a listing form. Work through this in order.

---

## 0. What is already done

| | |
|---|---|
| Icons | `public/icon/{16,32,48,128}.png`, built from `icon20.png` |
| Store art | `store/promo-small-440x280.png`, `store/promo-marquee-1400x560.png`, `store/icon-128.png` |
| Privacy policy | <https://ali-dadashzadeh.ir/Skillo/privacy.html> — verified live |
| Homepage | <https://ali-dadashzadeh.ir/Skillo/> — verified live |
| Source | <https://github.com/mehrshaad/Skillo> — public |
| Store package | `npm run zip:store` → `.output/skillo-0.1.0-chrome-store.zip`, 198 KB, `key` stripped |

---

## 1. Capture the screenshots

At least one is required; five is the maximum and four is the sweet spot. Take
them **now**, from the current build, so the store does not show an older UI.

1. `npm run build`, then load `.output/chrome-mv3` at `chrome://extensions`
   (Developer mode → Load unpacked). Reload if it is already loaded — the icon
   changed.
2. Set the browser zoom to 100% and use a light theme.
3. Run one real job through it so the panel has genuine content. A half-filled
   panel photographs badly, and reviewers notice placeholder text.
4. Capture just the side panel, no browser chrome, with Win+Shift+S.
5. Save the PNGs into `store/raw/` with these exact names:

   | File | What should be on screen |
   |---|---|
   | `job.png` | The job step after a posting has been analysed — skills and keywords visible |
   | `tailor.png` | The tailor step — fit level, page limit, notes |
   | `review.png` | The review step — match score and ATS expanded, "What changed" showing edits |
   | `apply.png` | After applying, with the Overleaf note and the page-count check |
   | `settings.png` | Settings with a provider connected (**blank the API key field first**) |

6. Build the framed 1280×800 versions:

   ```
   pip install Pillow
   python scripts/build-store-assets.py
   ```

   This writes `store/screenshot-N-*.png` with the caption on the left and your
   capture on the right. Skip any file you did not capture and it is left out.

**Before uploading, look at each one for:** your real name, employer names, an
API key, a resume you would not want public. The screenshots are public
forever.

---

## 2. Build the package

```
npm test && npm run compile && npm run zip:store
```

Upload `.output/skillo-0.1.0-chrome-store.zip`. Do not upload the plain
`npm run zip` output — that one still carries the `key` field, which pins the
extension ID and can be rejected.

---

## 3. Create the item

1. <https://chrome.google.com/webstore/devconsole> → **Add new item**.
2. Drop in the zip. Wait for it to parse.
3. It lands in Draft. Nothing is public until you press Submit at the end.

---

## 4. Store listing tab

**Name**

```
Skillo - Resume Tailor
```

**Summary** (132 characters max)

```
Tailor your Overleaf LaTeX resume to a job posting using your own LLM API key or local Claude Code.
```

**Description**

```
Skillo rewrites your Overleaf LaTeX resume for a specific job, using an AI model you supply and pay for.

Paste a LinkedIn job link. Skillo reads the posting, breaks out the skills, tools and keywords the employer is screening for, and rewrites your resume against them — then writes the result straight back into your Overleaf project.

HOW IT WORKS
1. Give it a job link. Skillo pulls the posting and analyses what the role actually asks for.
2. Point it at your Overleaf project. It reads the LaTeX source of the open document.
3. Choose how far to go — five levels, from a light reorder to a rewrite for this one job — and a page limit it has to respect.
4. Read the diff, the match score out of 10, the ATS keyword coverage, and the list of every edit.
5. Apply. The revision goes into your Overleaf project, and Ctrl+Z there undoes it in one step.

IT WILL NOT INVENT EXPERIENCE
At every setting, Skillo is instructed never to add an employer, title, date, degree, certification, project, metric or skill that is not already in your resume or in the notes you write. It reorders, rephrases, condenses and cuts. What it cannot honestly claim, it lists as a remaining gap instead of writing around it.

YOU BRING THE MODEL
Skillo has no server and no account. Use an OpenRouter, OpenAI or Anthropic API key, or run Claude Code locally through the optional bridge. Requests go from your browser straight to the provider you chose. Your key is stored on your own machine and is deliberately never synced between devices.

WHAT IT NEEDS ACCESS TO
LinkedIn, to read the job posting. Overleaf, to read and write the document you have open. The API endpoint of whichever provider you configured. Nothing else.

Open source: https://github.com/mehrshaad/Skillo
```

**Category**: Productivity → Workflow & Planning
**Language**: English

**Graphics**

| Field | File |
|---|---|
| Store icon | taken from the package's `icon/128.png` — nothing to upload |
| Screenshots | `store/screenshot-*.png` |
| Small promo tile | `store/promo-small-440x280.png` |
| Marquee tile | `store/promo-marquee-1400x560.png` (only used if Google features you) |

**Additional fields**

- Homepage URL: `https://ali-dadashzadeh.ir/Skillo/`
- Support URL: `https://github.com/mehrshaad/Skillo/issues`

---

## 5. Privacy tab

This is where reviews get rejected. Answer all of it.

**Single purpose**

```
Skillo tailors a user's existing LaTeX resume in Overleaf to a specific job posting, using an AI model the user configures with their own API key.
```

**Permission justifications** — paste one per permission:

| Permission | Justification |
|---|---|
| `storage` | Stores the user's own settings, their API key, and the history of previous runs on their machine. Nothing is sent anywhere. |
| `sidePanel` | The entire user interface is a Chrome side panel that opens next to Overleaf. |
| `scripting` | Injects the content scripts that read the job posting from LinkedIn and read and write the LaTeX document in the user's open Overleaf project. |
| `tabs` | Finds the user's open Overleaf and LinkedIn tabs so the panel can act on the right document, and opens a background tab to load a job posting when the direct fetch is blocked. |
| `offscreen` | Parses fetched LinkedIn HTML with DOMParser, which is not available in a service worker. |
| `nativeMessaging` (optional) | Only requested if the user chooses to run Claude Code locally instead of a hosted API. It connects to a native messaging host the user installs themselves. |
| Host: `*.linkedin.com` | Reads the job posting the user asked to tailor against. |
| Host: `www.overleaf.com` | Reads the LaTeX source of the user's open project and writes the revision back. |
| Host: `openrouter.ai`, `api.openai.com`, `api.anthropic.com` | Sends the tailoring request to whichever provider the user configured, using the user's own API key. |

**Remote code**: **No, I am not using remote code.** Everything executed is in
the package. The model returns LaTeX text, which is data the user reviews — it
is never executed.

**Data usage** — tick these:

- **Personally identifiable information** — yes. A resume contains a name and
  contact details, and it is sent to the API provider the user configured.
- **Website content** — yes. The job posting and the LaTeX document.

Leave health, financial, authentication, personal communications, location and
web history unticked. Skillo touches none of them.

Then tick all three certifications — Skillo satisfies each one:

- Not sold or transferred to third parties outside approved use cases
- Not used or transferred for anything unrelated to the single purpose
- Not used for creditworthiness or lending

Privacy policy URL:

```
https://ali-dadashzadeh.ir/Skillo/privacy.html
```

---

## 6. Distribution tab

- Visibility: **Public** (or Unlisted first, if you want to test the install
  flow before anyone can find it)
- Regions: all
- Not for children

---

## 7. Submit

Press **Submit for review**. First reviews usually land within a few days but
can take longer, and anything touching a native messaging host tends to get a
closer look. If it is rejected, the reason names the exact policy — fix and
resubmit; resubmissions are normally faster.

---

## 8. After it is approved — do not skip this

The store assigns its own extension ID, different from the unpacked one. The
Claude Code bridge whitelists IDs explicitly, so **the bridge will not work for
store users until you do this**:

1. Copy the extension ID from the developer dashboard.
2. Put it in `scripts/build-bridge-installers.mjs`:

   ```js
   const STORE_EXTENSION_ID = 'the-id-from-the-dashboard';
   ```

3. Bump `version` in `package.json` (0.1.0 → 0.1.1).
4. `npm run zip:store` and upload the new zip as an update.

Until then the installer allowlists only the unpacked ID — the script prints a
reminder when the constant is still empty.
