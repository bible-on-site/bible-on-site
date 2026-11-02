# Evidence — #2731 Dedications: expanded scopes across reading surfaces

This directory holds the acceptance captures for the dedication displays
added by this issue. Each surface was shot `before` (dedication link
tables truncated) and `after` (seeded rows) on the local dev server.

## Seeded data (local `tanah-dev`)

| Dedication | Subject | Scope | Expected line |
| --- | --- | --- | --- |
| 1 | משה אבן עזרא | Full sefer בראשית (id 1) | `מוקדש למשה אבן עזרא` |
| 2 | יצחק בן אברהם | Perek range 1–5, purpose "Falecimento" | `מוקדש ליצחק בן אברהם (Falecimento)` |
| 3 | שרה בת דוד | Tanahpedia entry משה-רבנו | `מוקדש לשרה בת דוד (Em louvor a Deus)` |
| 4 | אליעזר הכהן | Whole Masora feature | `מוקדש לאליעזר הכהן` |
| 5 | רחל אמו | Parasha unit 1 (בראשית) | `מוקדש לרחל אמו (Falecimento, Refuah Shleimah)` |
| 6 | עבר תוקף | Perek range 1–3, `expires_at` in the past | **excluded** (expiry proven) |

## What each file shows

| File | Viewport | Content |
| --- | --- | --- |
| `perek-929-1-{desktop,mobile}-{light,dark}-after.png` | 1440px / 390px | `/929/1` (בראשית א): sefer-scope dedication on the book cover (`מוקדש למשה אבן עזרא`, ancestor resolution) plus the perek-range line at the perek heading; mobile keeps the block centered with no clipping. The expired row (perek 1–3) does not render. |
| `perek-929-1-*-before.png` | same | Same pages without dedication rows — no block rendered. |
| `pedia-entry-desktop-{light,dark}-after.png` | 1440px | `/pedia/משה-רבנו`: canonical-entry dedication under the title. |
| `bookshelf-desktop-{light,dark}-after.png` | 1440px | `/bookshelf`: sefer dedication on the בראשית card. |
| `parasha-desktop-{light,dark}-after.png` | 1440px | `/parasha/1`: whole-parasha dedication once at the unit spread — not repeated per perek/verse. |
| `masora-desktop-{light,dark}-after.png` | 1440px | `/masora/1`: feature-level מסורה dedication, once for the reading context. |
| `*-before.png` | matching | Identical routes with the link tables truncated — nothing renders. |

## How to regenerate

`capture-evidence.mjs` shoots the local dev server with Playwright
(resolved from `web/bible-on-site`, no install needed here):

```bash
# dev server: skip docker-dependent predev (rustfs not needed for these pages)
cd web/bible-on-site && bunx dotenv -e .dev.env -- next dev -p 3001

# apply expanded schema + seed rows, then:
node evidence/issue-2731/capture-evidence.mjs after
# truncate the dedication link tables, POST /api/revalidate?tag=dedications, then:
node evidence/issue-2731/capture-evidence.mjs before
```

Captures were taken against `http://localhost:3001` with the upgraded
`tanah-dev` schema and the seeded rows above — not production.
