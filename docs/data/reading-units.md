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
| פרשה על הפרק  | `/פרשה`  | Synagogue Torah parasha + Haftarah | Implemented (#2108) |

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

## פרשה derivation

The weekly synagogue parashiot are **curated data**, not derived from
corpus markers. The shared source table
`web/bible-on-site/src/data/parasha/parasha-division.json` is consumed
verbatim by the website (`src/data/parasha/parasha-units.ts`) and by the
SQLite exporter (`reading_units.rs::derive_parasha_units`), so all
consumers resolve identical units:

- Exactly the five Torah sefarim carry primary units: **54 parashiot**
  with positional decimal `unitId`s/`slug`s and per-sefer `order`.
  Joined pairs (ויקהל–פקודי, תזריע–מצורע, אחרי מות–קדושים, בהר–בחוקותי,
  מטות–מסעי, נצבים–וילך) stay **separate unit identities** — the
  `joinedReadings` table records the combination for display, never
  merges the units.
- Each unit's `heading` is the parasha name; `closingBreak` is always
  `null` (parasha boundaries are calendar data, not corpus markers).
- The primary `ranges` list holds the single contiguous Torah range;
  printed `(sefer, perek, pasuk)` references resolve to canonical
  `perekId`s through each sefer's `perekFrom`, with additionals
  (מלכים ב etc.) offsetting into their canonical perek span. Impossible
  endpoints fail resolution at module load / export time.
- Every Haftarah custom is an ordered `AuxiliaryReading`:
  `id = haftara-{customs-joined}` (e.g. `haftara-sefaradi-temani`),
  `label` is the conjunctive Hebrew form ("ספרדים ותימנים",
  "ספרדים, אשכנזים ותימנים"). Customs are **never flattened** into one
  reading; each variant keeps its own ordered ranges — including
  multi-range readings, perek/sefer jumps, and intentional repeats.
- `occasions` and `joinedReadings` in the JSON are reference data for
  the landing page, not reading units — they are not exported to the
  reading-unit tables.

## Range-based queries

`web/bible-on-site/src/lib/reading/queries.ts` exposes the shared SQL
helpers:

- `slicesForRanges` — commentary slices per perek.
- `noteSliceCondition` — pasuk-bounded `WHERE` clauses:
  `(n.perek_id = ? AND n.pasuk >= ? AND n.pasuk <= ?)`. Boundary pesukim
  are included whole (pasuk granularity).
- `coveringSourceSliceCondition` — the same pasuk-bounded clauses on the
  `cs` alias, matching `tanah_article_covering_source` rows for the
  verified-coverage article lookup.
- `coveringSourceSliceRank` — a scalar `MIN(slice_order)` rank over a
  per-slice ordinal derived table, so multi-range article results keep
  the supplied reading order (each article takes its first matching
  slice) ahead of priority.
- `primaryPerekSliceRank` — the same rank restricted to primary-perek
  matches; it references neither `coverage_verified` nor the
  covering-source table, so `getArticleSummariesForRanges` can fall back
  to it while the website ships ahead of the schema migration (the
  website build runs independently of Data CD).
- `slicePerekIds` — distinct perek ids for the legacy article fallback:
  articles whose verse coverage was never mapped
  (`coverage_verified = FALSE`) still match ranges through their primary
  perek association (`IN (...)`), without claiming pasuk precision.

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
JSON consumers and SQLite consumers resolve identical mappings. For
מסורה it re-derives units from corpus markers; for פרשה it resolves the
shared `parasha-division.json` against the corpus. A corpus carrying no
Torah sefer at all (fixture or partial export) still gets the `parasha`
division row but no units; any corpus with Torah sefarim resolves the
full 54-unit mapping strictly.

## Routing and SEO policy

- Each division gets a distinct menu label, root landing
  (sefer → first-unit browsing), and stable unit links
  (`{rootPath}/{unitId}`). על הפרק remains the first regular navigation
  item per #2102.
- Hebrew route roots live in ASCII route directories behind
  `rewrites()` in `next.config.mjs` — non-ASCII route directories are
  unreliable in dev and break prerender. `/מסורה` and `/פרשה` (raw and
  percent-encoded) rewrite to `/masora` and `/parasha`, the same
  pattern the `/929/{sefer.name}` book routes use. Public URLs, links,
  canonicals, and the sitemap all keep the Hebrew root.
- `/מסורה` and `/פרשה` unit pages are statically generated
  (`generateStaticParams`, `dynamicParams = false` — units are a closed
  list).
- Canonical/indexing policy (Google canonicalization guidance): a unit
  spanning exactly one whole perek consolidates — its canonical points
  at the equivalent `/929/{perekId}` page. Every other unit is a
  deliberate alternate slicing of the same corpus: `noindex, follow`
  with a self-referential canonical, so crawlers discover links without
  indexing a parallel copy or falsely canonicalizing multi-perek spans
  onto one perek.
- The sitemap lists only the `/מסורה` and `/פרשה` landings — never the
  thousands of non-indexed unit pages.

## Native app consumption

The native app ships the same export in
`app/BibleOnSite/Resources/Raw/sefaria-dump-5784-sivan-4.tanah_view.sqlite`
and resolves it through the identical mapping:

- `Services/MasoraDataService.cs` loads units plus their primary ranges
  (`auxiliary_ordinal IS NULL`) from the three tables above and answers
  stable-id, adjacency, and containing-unit lookups at whole-pasuk
  precision.
- `Helpers/MasoraUnitText.cs` is the app-side port of `rangesPerekSlices` /
  segment clipping: a unit decomposes into per-perek slices, interior
  perakim render whole, and boundary pesukim keep their `segmentIndex`
  bounds (the closing `ptuha`/`stuma` marker is included in the unit's
  tail, matching `emit`'s inclusive end coordinate).
- `ViewModels/MasoraViewModel.cs` + `Pages/MasoraPage` render the clipped
  canonical pesukim from `tanah_pasuk_segment` — the unit maps ranges, it
  never duplicates scripture. Verse-addressed commentary and articles
  attach to every covered pasuk via the union of the unit's overlapping
  perakim.
- A packaged database predating these tables degrades to an unavailable
  empty state rather than crashing.

## Follow-up

- `/פרשה` division and ordered multi-range Haftarah auxiliary readings:
  #2108. The contract's `AuxiliaryReading` and the
  `tanah_reading_unit_range` auxiliary columns are designed for it.
- Native app consumption (reading-unit queries, menu entries, Haftarah
  rendering): the exported tables are the versioned contract; app-side
  readers land with the app portions of #2108 and #934.
