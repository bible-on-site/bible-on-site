# Shared reading-unit contract (version 1)

A *reading division* presents the canonical pesukim corpus sliced into
ordered *reading units*. Each division owns a navigation label, a route
root, and a deterministic mapping from canonical scripture coordinates
to units. Divisions **map** scripture — they never copy, renumber, or
replace canonical pesukim.

| Division  | Root      | Unit within a sefer            | Status       |
| --------- | --------- | ------------------------------ | ------------ |
| על הפרק   | `/929`    | Perek                          | Existing     |
| מסורה על הפרק | `/מסורה` | Masoretic parasha (ptuha/stuma) | Implemented |
| פרשה על הפרק  | `/פרשה`  | Synagogue Torah parasha + Haftarah | Follow-up (#2108) |

## Contract types

Canonical website source: `web/bible-on-site/src/lib/reading/contract.ts`
(`READING_CONTRACT_VERSION = 1`).

- **`ScriptureCoordinate`** — `{ perekId, pasuk, segmentIndex? }`.
  `perekId` is the global canonical perek id (1–929), `pasuk` is 1-based
  inside that perek, and `segmentIndex` is an optional 0-based index into
  the pasuk's segment list for intra-pasuk bounds (Masoretic breaks may
  sit mid-pasuk). Omitted means the whole-pasuk edge: a start without it
  begins at segment 0, an end without it finishes on the last segment.
- **`ScriptureRange`** — inclusive `{ start, end }` coordinates. A range
  may cover part of a pasuk, whole pesukim, whole perakim, or a span
  crossing perek boundaries within one sefer.
- **`AuxiliaryReading`** — `{ id, label, ranges }`: an ordered list of
  ranges attached to a unit (e.g. a Haftarah). Order is preserved;
  intentional repeats and jumps between perakim/sefarim are kept — no
  filling skipped text, no collapsing repeats.
- **`ReadingUnit`** — `{ division, unitId, slug, seferName, order,
  heading, ranges, auxiliaryReadings?, closingBreak? }`. `unitId` is a
  stable contiguous id within the division; `slug` is the decimal
  `unitId`; `order` is 1-based within the parent sefer; `heading` is the
  display scripture-reference span. `closingBreak` records the
  ptuha/stuma marker that ends a Masoretic unit (`null` for a sefer's
  final unit, closed by the sefer end).
- **`ReadingDivision`** — `{ id, version, rootPath, menuLabel }`: the
  instance configuration behind which shared reader components run.

## Range resolution

`web/bible-on-site/src/lib/reading/ranges.ts` resolves ranges against
the canonical corpus:

- Coordinates compare by `perekId`, then `pasuk`, then segment position.
- `rangePerekSlices` / `rangesPerekSlices` / `unitPerekSlices` decompose
  a unit into per-perek clips (`{ perekId, startPasuk, endPasuk,
  startSegmentIndex?, endSegmentIndex? }`) — the presentation input for
  rendering and for anchoring (`pasuk-{perekId}-{pasuk}` ids keep
  canonical coordinates even when a unit crosses perakim).
- `unitPerekIds` returns the distinct overlapping canonical perek ids —
  the input for commentary, article, and entity-ref queries.
- `rangeContainsCoordinate` / `getMasoraUnitContaining` implement the
  canonical-position → containing-unit direction. A bare
  `{ perekId, pasuk }` position resolves to the unit in which the pasuk
  *begins* (segment-0 semantics); a position exactly on a break marker
  belongs to the unit the marker closes.
- `unitEquivalentPerekId` returns the canonical perek id when a unit
  spans exactly one whole perek — used for SEO canonical consolidation.
- Ordered multi-ranges keep declared order and permit intentional
  repeats; verse-addressed commentary remains pasuk-granular (a clipped
  boundary pasuk is included whole).

## מסורה derivation

`web/bible-on-site/src/data/masora/masora-units.ts` derives the division
deterministically from the canonical `sefarim` corpus:

- Every `ptuha`/`stuma` segment is a boundary marker that *closes* the
  preceding unit. The text before the marker belongs to one unit; the
  text after it opens the next (same-pasuk remainder, next pasuk, or
  first pasuk of the next perek — perakim ids are contiguous across a
  sefer's additionals).
- A sefer's last unit is closed by the sefer end (`closingBreak: null`).
- A marker after the final pasuk of a sefer is invalid corpus and throws.
- Current corpus: **3197 units** over 35 sefarim — 1181 ptuha-closed,
  1981 stuma-closed, 35 sefer-end units; 153 units cross perek
  boundaries; 97 markers sit mid-pasuk.

## Range-based queries

`web/bible-on-site/src/lib/reading/queries.ts` exposes the shared SQL
helpers:

- `slicesForRanges` — commentary slices per perek.
- `noteSliceCondition` — pasuk-bounded `WHERE` clauses:
  `(n.perek_id = ? AND n.pasuk >= ? AND n.pasuk <= ?)`. Boundary pesukim
  are included whole (pasuk granularity).
- `slicePerekIds` — distinct perek ids for article queries
  (`IN (...)`), which naturally deduplicates articles reached through
  several ranges.

Original perush/article source anchors are preserved — no synthetic
perek ids and no duplicated content per division.

## SQLite export parity

`data/sqlite/tanah_structure.sql` declares the native-side contract;
`data/sefaria/pipelines/tanah-view/src/reading_units.rs` derives the same
mapping and exports it in `cargo make generate-tanah-view-sqlite`:

- `tanah_reading_division` — `{ id, contract_version, root_path,
  menu_label }`.
- `tanah_reading_unit` — `{ division_id, unit_id, slug, sefer_id,
  unit_order, heading, closing_break }` (PK `division_id, unit_id`;
  `closing_break` is `ptuha`/`stuma`/NULL).
- `tanah_reading_unit_range` — `{ division_id, unit_id, range_index,
  auxiliary_ordinal, auxiliary_id, auxiliary_label, start_perek_id,
  start_pasuk, start_segment_index, end_perek_id, end_pasuk,
  end_segment_index }`. Primary ranges carry `auxiliary_*` NULL;
  auxiliary readings carry their ordinal, id, and label, with
  `range_index` ordering within each list.

`reading_units.rs` is a line-for-line port of the website derivation
(including the `toLetters` port for headings) and is parity-tested
against the checked-in dump the website itself consumes
(`web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json`)
— the same `Vec<Sefer>` the pipeline serializes into the JSON export, so
JSON consumers and SQLite consumers resolve identical mappings.

## Routing and SEO policy

- Each division gets a distinct menu label, root landing
  (sefer → first-unit browsing), and stable unit links
  (`{rootPath}/{unitId}`). על הפרק remains the first regular navigation
  item per #2102.
- Hebrew route roots live in ASCII route directories behind
  `rewrites()` in `next.config.mjs` — non-ASCII route directories are
  unreliable in dev and break prerender. `/מסורה` (raw and
  percent-encoded) rewrites to `/masora`, the same pattern the
  `/929/{sefer.name}` book routes use. Public URLs, links, canonicals,
  and the sitemap all keep the Hebrew root.
- `/מסורה` unit pages are statically generated (`generateStaticParams`,
  `dynamicParams = false` — units are a closed list).
- Canonical/indexing policy (Google canonicalization guidance): a unit
  spanning exactly one whole perek consolidates — its canonical points
  at the equivalent `/929/{perekId}` page. Every other unit is a
  deliberate alternate slicing of the same corpus: `noindex, follow`
  with a self-referential canonical, so crawlers discover links without
  indexing a parallel copy or falsely canonicalizing multi-perek spans
  onto one perek.
- The sitemap lists only the `/מסורה` landing — never the 3197
  non-indexed unit pages.

## Follow-up

- `/פרשה` division and ordered multi-range Haftarah auxiliary readings:
  #2108. The contract's `AuxiliaryReading` and the
  `tanah_reading_unit_range` auxiliary columns are designed for it.
- Native app consumption (reading-unit queries, menu entries): the
  exported tables are the versioned contract; app-side readers land with
  #934.
