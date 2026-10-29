# Issue #2767 — Site-wide contrast & link-underline accessibility preferences

Captures taken against the local test database (`tanah_test`) at
1280×800 (and one 320×568 pass) in Chromium. "Before" shots come from a
detached `origin/master` worktree served on a second port; "after" shots
come from this branch.

## What changed visually

- `01-before-menu` / `05-after-menu` — the התאמות נגישות popover gains
  two site-wide toggles (ניגודיות גבוהה, קו תחתון לקישורים) between the
  verse-font select and the reset button; the הצהרת נגישות link stays
  last.
- `02-before-pedia` / `06-after-pedia` — `/pedia/יהושע-בן-נון`: inline
  links inside DB-authored prose now carry a persistent underline
  (baseline SC 1.4.1 cue); footnote sup markers keep their own
  affordance.
- `03-before-929` / `07-after-929` — `/929/1` flat reader, default mode
  (unchanged apart from the token migration — visually identical).
- `04-before-statement` / `08-after-statement` — `/accessibility`:
  statement now documents both new controls and the updated review date.
- `09-after-929-hc-light` — `/929/1` under ניגודיות גבוהה (light):
  black-on-white palette, all text ≥7:1.
- `10-after-pedia-hc-light` — the same pedia entry under high contrast
  (implied underline on every link).
- `11-after-929-hc-dark` — `/929/1` under ניגודיות גבוהה with a dark
  system scheme: white-on-black palette.
- `12-after-pedia-links-on` — קו תחתון לקישורים enabled: every `a[href]`
  in the entry is underlined, including footnote markers.
- `13-after-menu-both-on` — the menu with both toggles enabled.
- `14-after-menu-320px` — the menu open on a 320px RTL viewport: bounded
  (`max-height` + scroll), fully inside the viewport, statement link
  reachable by scrolling.

## Measured contrast pairs (WCAG luminance formula)

| Pair | Ratio |
| --- | --- |
| white on `#1552ac` brand blue | **7.41:1** (docs previously claimed 8.6:1) |
| `#171717` on `#fff` body text | 17.95:1 |
| `#666` on `#fff` muted text | 5.77:1 |
| `#6f63b8` on `#fff` deepened accent | 5.07:1 (was `#9a92d1` 2.84:1) |
| `#4f46e5` on `#fff` pedia accent | 6.28:1 (was `#6366f1` ~4.35:1) |
| `#e8eaed` on `#0f1219` dark body | 15.54:1 |
| HC `#000`/`#fff` body | 21:1 |
| HC `#4d4d4d`/`#fff` muted | 8.45:1 |
| HC `#0d3a8c`/`#fff` link accent | 10.49:1 |
| HC dark `#b3b3b3`/`#000` muted | 9.99:1 |
| HC dark `#4da3ff`/`#000` link accent | 7.99:1 |

Full table and per-criterion scope: `docs/website/accessibility-requirements.md`.
