# Issue #2723 — Tanahpedia note-list letters match the inline footnote style

## Defect (before)

On `/pedia/משה-רבנו` the generated letter labelling each note in
`ol.footnotes` (`li::before`, `content: attr(data-marker)`) rendered as an
absolutely positioned body-size gray run — `position: absolute`,
`color: #5f6368`, inherited `0.95rem` size, no baseline raise — while the
inline reference `<sup>` is `11px`, `color: #1a73e8`,
`vertical-align: super`. `vertical-align` is ignored on out-of-flow boxes,
so the note marker could never look raised, and its color/size had drifted
from the approved inline look.

## After

The marker is an in-flow `inline-block` inside a hanging-indent gutter
(`padding-inline-start` + matching negative `text-indent`), sized by the
shared `--footnote-marker-size` token, colored by `--footnote-marker-color`,
`vertical-align: super` — resolved computed style is now identical to the
inline reference in light and dark themes, and the first `<p>` of a note
flows inline so the marker shares the note's first line.

## Shots (`shots/`)

| File | Region |
| ---- | ------ |
| `before-notes.png` / `after-notes.png` | top of `ol.footnotes` on `/pedia/משה-רבנו` |
| `before-notes-multiletter.png` / `after-notes-multiletter.png` | `fn:15`/`fn:16` — multi-letter markers טו/טז |

"before" was reproduced locally by injecting the pre-#2723 declarations
over the shipped stylesheet (`position:absolute`, `inset-inline-start:0`,
gray, inherited size) so both columns render the identical DOM.

## Green run

`bun run test:e2e tests/e2e/tanahpedia-footnotes.test.ts` — 10/10 on the
e2e-seeded DB: computed-style parity (color/size/`vertical-align`/`position`),
dark-theme parity, a pixel-level check that the marker's accent ink paints
above the note text's topmost row, plus the ordinary-`<ol>` guard.
