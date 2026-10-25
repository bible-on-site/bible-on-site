# Evidence — #2397 Homepage counters: distinct section transitions, illustration count and meaningful links

Implementation shipped in #2565; this directory holds the acceptance
captures the issue requires.

## What each file shows

| File | Viewport | Content |
| --- | --- | --- |
| `before-issue-screenshot.png` | desktop | The defect as reported: counters band sharing the app section's white surface, no visible counters-to-app boundary (user capture attached to the issue). |
| `after-desktop-sequence.png` | desktop 1440px | One capture of the full chain ספרי התנ"ך → מספרים על הפרק → יישומון → תנאי שימוש: blue bookshelf → wave → **muted `#f8fafc` counters band** → wave → **white app band** → wave → blue terms band. |
| `after-desktop-boundary.png` | desktop | Tight crop on the counters→app wave divider — the boundary #2503 had flattened. |
| `after-desktop-counters.png` | desktop | The six counters: רבנים (fixed word עשרות, linked to `/929/authors`), מאמרים, ערכים בתנכפדיה (`/pedia`), איורים, פרקים מוקלטים, שנים שהתוכנית רצה (`/calendar`). |
| `after-mobile-{sequence,boundary,counters}.png` | mobile 390px | The same chain/crop on a mobile viewport — RTL layout, boundaries stay distinct. |

## How to regenerate

`capture-evidence.mjs` shoots the deployed site (or a local/dev base URL)
with Playwright — after the count-up animation settles:

```bash
cd web/bible-on-site
EVIDENCE_OUT="$(cd ../../evidence/issue-2397 && pwd -W)" \
  node ../../evidence/issue-2397/capture-evidence.mjs
# or against another environment:
EVIDENCE_BASE_URL=http://localhost:3001 node ../../evidence/issue-2397/capture-evidence.mjs
```

Captures above were taken against `https://xn--febl3a.co.il` after the
#2565 deploy, so they show real production totals.
