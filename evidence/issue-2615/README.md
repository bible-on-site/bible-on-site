# Issue #2615 — Tanahpedia footnote markers: red/green + visual evidence

## Defect (before)

Production (`https://xn--febl3a.co.il/pedia/משה-רבנו`) serves the legacy
`#note-N`/`#noteref-N` markup generation:

- Notes list renders **two identifiers per note**: the browser's native
  decimal `list-style-type: decimal` marker **plus** the Hebrew letter baked
  into the item text — `1. א שמות ב י ↩` (55 items).
- Inline references are bare anchors — no `<sup>`, body-size font, body text
  color, no underline — indistinguishable from a stray letter.
- The `li`s carry **no `id` at all**, so every `#note-N` reference href is a
  dead fragment.

Measured on production DOM:

```json
{ "listStyleType": "decimal", "firstLiId": "", "firstLiText": "א שמות ב י ↩", "itemCount": 55 }
{ "text": "א", "inSup": false, "fontSize": "17.6px", "color": "rgb(23, 23, 23)", "underline": "none" }
```

## Red run

`verify.mjs` (same assertions as `tests/e2e/tanahpedia-footnotes.test.ts`)
against production: **1 passed / 2 failed** — `ol.footnotes` absent entirely,
so every marker/navigation check had nothing to run against. The canonical
structure simply did not exist.

## Green run

Same assertions against the fix (`next dev` on the worktree, dev DB seeded
from the same legacy migration): **47 passed / 0 failed**, covering:

- `ol.footnotes` with `list-style-type: none` (also inherited by `li`) — no
  native decimal counter.
- `li::before { content: attr(data-marker) }` renders exactly one Hebrew
  letter per note — including multi-letter `יא`, `טו`, `טז`, `נד` — and the
  letter never appears in the note's `textContent`.
- Generated `הערות` section label; no leftover `h2`/`hr` furniture.
- `sup#fnref:N > a.footnote-ref`: empty text, `data-marker`, `role="doc-noteref"`,
  `aria-label="הערה X"`, `href="#fn:N"`, `::before` paints the letter,
  `vertical-align: super`, font smaller than body.
- Reference → note → back navigation (`#fn:5` ↔ `#fnref:5`), keyboard
  Enter activation, `role="doc-backlink"`.
- Unique ids across the entry; יהושע בן נון renders exactly 10 notes.

## Screenshots (`shots/`)

| File | What |
| ---- | ---- |
| `before-notes.png` | Production notes list — duplicated `1.` + `א` markers |
| `before-inline.png` | Production inline reference — plain body-text letter |
| `before-notes-narrow.png` | Same list at 420px |
| `after-notes.png` | Fixed notes list — one generated Hebrew marker per note |
| `after-inline.png` | Fixed inline reference — compact generated superscript |
| `after-notes-narrow.png` | Fixed list at 420px |
| `after-notes-dark.png` / `after-inline-dark.png` | Dark color-scheme |

## Reproduce

```bash
# red (production, pre-fix markup)
node verify.mjs "https://xn--febl3a.co.il" before
node before-detail.mjs

# green (worktree dev server)
cd web/bible-on-site && node_modules/.bin/dotenv -e .dev.env -- node node_modules/next/dist/bin/next dev -p 3002
node verify.mjs "http://127.0.0.1:3002" after
node dark.mjs
```
