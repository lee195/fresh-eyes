# Fresh Eyes

A browser extension that reacts to your web app the way a non-technical user would —
their comments, in their own voice, pinned to the elements that caused them, ending in
a verdict: did this person get through, or did they close the tab?

You stop being able to see your own product. You know what "workspace" means, you know
which grey box is clickable, you know what happens after you press the button. Fresh
Eyes tells you what happens to someone who doesn't, at the moment you're building the
thing rather than months later in a usability session.

It isn't a lint report. Other tools already say *contrast ratio 3.1:1, missing label*.
This one says:

> **2.** *"I don't want to type my card number before I know what this costs."*
> ✕ closes the page · uneasy · unclear cost

---

## Try it in five minutes

```bash
npm install && npm run build
```

Load `dist/` as an unpacked extension (`chrome://extensions` → Developer mode → Load
unpacked). Then:

1. Click the Fresh Eyes toolbar button on your app. The panel opens.
2. **Settings** → point it at a model endpoint. For a free local one, run
   `ollama serve` and keep the defaults (`http://localhost:11434/v1`, no key).
   Press **Grant access and test**.
3. Back in the panel: pick a person, say what they're trying to do, press
   **See what they think**. Four people ship with it; **Settings → The people**
   is where you replace them with your own.

Try it on the two fixtures first — they're served from the extension itself at
`dist/fixtures/hostile.html` and `dist/fixtures/friendly.html`, or from any static
server. `hostile.html` should end in *gave up*; `friendly.html` should not.

## What it reads

Not your HTML. A **perceivable page model** — only what a person could see or act on:
role, accessible name, visible text, position, whether it's above the fold, font size,
contrast, and whether it's styled clickable but can't be reached. Roughly 1–3k tokens
for a real page.

Alongside it, the things a user *feels* rather than reads: how long they waited, whether
the page jumped, whether something threw an error, how long the longest paragraph is.

**Form values are never captured.** Labels, types, placeholders and validation state go;
what you typed does not, and password fields are excluded entirely. Text that reaches the
page anyway — an email on a confirmation screen, a token in a debug panel — is redacted
before anything leaves the browser.

## Where it sends it

Wherever you configure, and nowhere else. The extension ships with **no host access at
all**: no `content_scripts`, no site permissions. It reads a page only when you press the
button (`activeTab`), and it can reach your model endpoint only after you grant that one
origin by name.

Analysis is limited to an **origin allowlist**, which starts as localhost and nothing
else. The panel always shows the destination host next to the run button.

Being on the allowlist is permission to *analyse* an origin. Reading the tab is separate:
`activeTab` lasts until the tab navigates, so after you reload your app the panel no longer
knows its address until you press the toolbar button again. If that gets tiresome, **Keep
access** in Settings asks for a lasting host permission for that one origin — optional, per
origin, and revoked again when you remove the entry from the list.

API keys live in `chrome.storage.local` — never `sync`, never rendered back to the UI,
never included in an export. A local Ollama endpoint needs no key at all.

## Why the output looks the way it does

**The action is the product.** `hesitates` → `opens_new_tab_to_search` → `abandons_task`
is a closed vocabulary, not free text. That's what makes two runs comparable, lets you
filter by cause, and lets the panel draw the line under which *nothing was ever seen*.

**Nothing ungrounded is shown.** A vision model asked to play a confused user will
confidently invent the UI a confused user would struggle with — a cookie banner that
isn't there, a "Continue" button that doesn't exist. Those reactions read *better* than
the real ones. So every reaction must name an element we captured and quote text that is
actually on the page; anything else is dropped, not repaired, and the count of drops is
shown. One hallucinated usability problem costs the tool its credibility permanently.

**Nothing is written to your page.** The pins live in a closed shadow root on a single
fixed element. Your app's markup is never given an attribute, a class, or an id — element
identity is held in a `WeakMap`. A tool that perturbs what it measures is worse than no
tool.

## The people

Four personas ship in code — a retired teacher, a warehouse worker on a phone, a
florist buying with her own money, an office manager who has been phished once.
They span the axes that actually change a verdict rather than a demographic
spread: vocabulary, how much friction the motivation absorbs, phone or desk, and
what makes the tab close.

They are a starting point and they are meant to be replaced. **Settings → The
people** adds, edits, duplicates and deletes them. The fields are the ones the
prompt uses, and the one that moves a run most is *words they do not know* —
it's what turns your own copy into the thing that stops someone.

Defaults stay in code; storage holds only the difference from them. An edit to a
shipped person is stored under the same id and **Reset** removes it, so a
default can always come back, and a later release that improves the shipped
wording still reaches anyone who never touched it. Ids are permanent across a
rename, so old sessions keep naming the right person and the analysis cache
still lines up — editing a persona is a real change to the inputs, so the next
run is a real run rather than a cached one.

## Development

```bash
npm run build          # dist/ for Chrome
npm run build:firefox  # dist/ for Firefox
npm test               # vitest
npm run typecheck
npm run icons          # regenerate the PNGs from scripts/make-icons.mjs
```

Three build passes, because the pieces have genuinely different needs: the Vue pages get
ordinary ESM and code splitting (`vite.config.ts`), while the service worker and content
script must each be one self-contained IIFE (`vite.script.config.ts`, run once per entry).

### Layout

| Path | What lives there |
|---|---|
| `src/content/capture.ts` | The page model, the felt signals, the redaction |
| `src/content/pins.ts` | The shadow-root marker overlay |
| `src/shared/personas/` | The four shipped people, and the store the dev's own live in |
| `src/shared/prompt.ts` | Persona + page → the text a model answers |
| `src/shared/schema.ts` | The JSON contract, and a parser that doesn't trust it |
| `src/shared/grounding.ts` | Drops reactions about UI that wasn't there |
| `src/shared/backends/` | `ModelBackend` interface, registry, two implementations |
| `src/background/run.ts` | One run, end to end |
| `fixtures/` | The two pages that double as a regression eval |

### The fixtures are the eval

`hostile.html` and `friendly.html` describe the same task done badly and well. After any
prompt change, run both: a change that makes the friendly page fail is a regression, and
that's very hard to catch otherwise in a tool whose output is generated.

The signals alone already separate them cleanly:

| | hostile | friendly |
|---|---|---|
| Dead clicks | 1 | 0 |
| Smallest text | 10px | 14px |
| Worst contrast | 1.7:1 | 6.2:1 |
| Longest paragraph | 638 chars | 64 chars |
| Named controls | 0 of 6 | 4 of 4 |

## Not built yet

- **Journey recording** — walking a signup flow across several pages. The data model is
  already shaped for it (`Session.captures[]`, `Reaction.captureId`), so it needs a
  recorder and a sequence-aware prompt, not a rewrite.
- **Session history** — a run is shown and then lost. `Session` is already the
  complete record of one; what is missing is somewhere to keep it and a list to
  pick from.
- **Sharing personas** — a team writes these once and would want them in the
  repo. Export and import on top of `validatePersona` is the short version of
  that; a personas file the extension reads is the longer one.
