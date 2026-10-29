# Shared reading-unit contract (version 1)

A _reading division_ presents the canonical pesukim corpus sliced into
ordered _reading units_. Each division owns a navigation label, a route
root, and a deterministic mapping from canonical scripture coordinates
to units. Divisions **map** scripture — they never copy, renumber, or
replace canonical pesukim.

| Division      | Root     | Unit within a sefer                | Status              |
| ------------- | -------- | ---------------------------------- | ------------------- |
| על הפרק       | `/929`   | Perek                              | Existing            |
| מסורה על הפרק | `/מסורה` | Masoretic parasha (ptuha/stuma)    | Implemented         |
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
  stable contiguous id within the division; `slug` is the canonical URL
  segment — the decimal `unitId` for מסורה, the Hebrew parasha name
  (hyphen-joined, e.g. `לך-לך`) for פרשה (issue #2738); `order` is
  1-based within the parent sefer; `heading` is the
  unit's display identity inside the division's own hierarchy — for
  מסורה units the sefer name plus the parasha ordinal
  ("בראשית פרשה ח"), with no conventional perek/pasuk references.
  `closingBreak` records the ptuha/stuma marker that ends a Masoretic
  unit (`null` for a sefer's final unit, closed by the sefer end).
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
- The מסורה reader renders no conventional chapter apparatus (no perek
  dividers, no chapter pasuk numbers). Each rendered pasuk carries its
  1-based position inside the parasha — one continuous count across
  slices; segment-clipped boundary pesukim keep their position with a
  suffix (`(התחלה)` opening mid-verse, `(סיום)` closing mid-verse,
  `(קטע)` for a lone excerpt).
- `rangeContainsCoordinate` / `getMasoraUnitContaining` implement the
  canonical-position → containing-unit direction. A bare
  `{ perekId, pasuk }` position resolves to the unit in which the pasuk
  _begins_ (segment-0 semantics); a position exactly on a break marker
  belongs to the unit the marker closes.
- `unitEquivalentPerekId` returns the canonical perek id when a unit
  spans exactly one whole perek — used for SEO canonical consolidation.
- Ordered multi-ranges keep declared order and permit intentional
  repeats; verse-addressed commentary remains pasuk-granular (a clipped
  boundary pasuk is included whole).

## מסורה derivation

`web/bible-on-site/src/data/masora/masora-units.ts` derives the division
deterministically from the canonical `sefarim` corpus:
- Every `ptuha`/`stuma` segment is a boundary marker that _closes_ the
  preceding unit. The text before the marker belongs to one unit; the
  text after it opens the next (same-pasuk remainder, next pasuk, or
  first pasuk of the next perek — perakim ids are contiguous across a
  sefer's additionals).
- A sefer's last unit is closed by the sefer end (`closingBreak: null`).
- A marker after the final pasuk of a sefer is invalid corpus and throws.
- Current corpus: **3197 units** over 35 sefarim — 1181 ptuha-closed,
  1981 stuma-closed, 35 sefer-end units; 153 units cross perek
  boundaries; 97 markers sit mid-pasuk.

## סדרים cross-check (verification only)

The Masoretic סדרים division is a _different_ system from ptuha/stuma
parashot: the Tanach Yomi reference (`חלוקת ה"סדרים" של המסורה`,
prakim.pdf) marks seder heads that sit at parasha starts, on
parasha-final pesukim, and inside parashot.
`cargo make verify-masora-sedarim` classifies every one of the 297
listed heads (293 numbered + 4 parenthesized manuscript-only) against
the shipped units and runs integrity checks — see
`docs/data/masora-sedarim-verification.md` (issue #2187). The shipped
division stays ptuha/stuma-derived; adopting a סדרים division would be
a separate product change. Note the reference covers Neviim and
Ketuvim only — it lists no Torah sedarim.

## פרשה derivation

The weekly synagogue parashiot are **curated data**, not derived from
corpus markers. The shared source table
`web/bible-on-site/src/data/parasha/parasha-division.json` is consumed
verbatim by the website (`src/data/parasha/parasha-units.ts`) and by the
SQLite exporter (`reading_units.rs::derive_parasha_units`), so all
consumers resolve identical units:
- Exactly the five Torah sefarim carry primary units: **54 parashiot**
  with positional decimal `unitId`s and per-sefer `order`. Each unit's
  `slug` is the canonical Hebrew name (plain unpointed words joined by
  ASCII hyphens — `לך-לך`, `אחרי-מות`, `וזאת-הברכה`); the table's
  `aliases` hold researched lexical variants (Sefaria Terms API, per
  `nameAudit`) and every unit accepts the shared `פרשת {name}` prefix,
  while numeric ids and aliases permanent-redirect to the canonical
  slug (issue #2738).
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

## Aliyah boundary layer (#2519)

Aliyot are a **boundary layer over the פרשה division** — not a reading
division of their own. A _reading context_ (one standalone parasha, or a
named joined pair read together) selects a boundary set; a named _scheme_
(שבת — seven aliyot plus מפטיר, or weekday קריאת הציבור) selects the
split inside it. The layer maps the same canonical pesukim — Torah text
is never duplicated for boundaries.

Curated source: `web/bible-on-site/src/data/parasha/parasha-aliyot.json`,
imported by `devops/import-parasha-aliyot.mjs` from hebcal-leyning's
BSD-2-Clause boundary list and corroborated against Sefaria's
`get_aliyot` API — provenance, license pin, and the full coverage matrix
live in `docs/data/aliyah-sources.md`. Consumers:
- **Website** — `src/data/parasha/parasha-aliyot.ts` resolves every
  boundary to canonical `perekId`/`pasuk` at module load (impossible
  endpoints fail the build) and validates ordered non-overlapping
  coverage, allowing the intentional maftir tail-repeat. Named
  **variant layers** are derived from the per-aliyah `alternatives`:
  each (custom | alt-source) group substitutes its recorded ranges for
  the covered ordinals inside a full boundary list, re-validated for
  contiguous coverage; variants that move no boundary *start* are
  dropped as renderer-identical. The flat parasha page embeds all
  context/scheme/variant marker layers and swaps them client-side
  (`?reading=`/`?scheme=`/`?variant=`); the sefer book renders each
  unit's standalone Shabbat layer. Aliyah markers take the prominent
  separator treatment; perek labels demote to pasuk-number styling.
- **SQLite export** — `reading_units.rs::insert_parasha_aliyot` resolves
  the same JSON through the same canonical-resolution path and emits:
  - `tanah_parasha_aliyah_scheme` — `{ id, label, description,
    scheme_order }` (named schemes; future customs/variants coexist).
  - `tanah_parasha_reading` — `{ id, kind, sefer_id, applicability }`:
    the stable context identity (`standalone`/`joined`; `applicability`
    NULL = everywhere, e.g. חוקת-בלק carries `חוץ לארץ בלבד`).
  - `tanah_parasha_reading_unit` — `(reading_id, unit_position) →
    (division_id, unit_id)`: joined contexts keep their two constituent
    unit identities in reading order — never merged.
  - `tanah_parasha_aliyah` — `(reading_id, scheme_id, ordinal) →
    { role, label, start/end perek/pasuk }`: inclusive canonical
    bounds; `role='maftir'` marks the intentional repeated-tail reading.
  - `tanah_parasha_aliyah_alternative` — `(reading_id, scheme_id,
    ordinal, alternative) → { start/end perek/pasuk, custom, source }`:
    the documented variant range for each aliyah that carries one —
    `custom` names the minhag (NULL = unattributed recorded split),
    `source` the upstream that records it. Consumers derive named
    variant layers by substituting each (custom | source) group's
    ranges for its ordinals, the same derivation the website runs.
  - `tanah_parasha_aliyah_source` — the single provenance row (name,
    repository, license, upstream commit, retrieval date).
- **Native app** — the tables are the versioned contract for app-side
  aliyah markers; `ParashaDataService` keeps working unchanged (the
  layer is additive over `tanah_reading_unit`).

Context/scheme invariants: joined readings never concatenate standalone
halves; a context switch never mixes schemes or remaps ordinals; maftir
is a boundary role, never a Haftarah.

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

## Verse-level article coverage (#2189 / epic #2175 §3)

`tanah_article_covering_source` maps an article to each canonical
`{perek_id, pasuk}` it verifiably covers; an article has many rows and
they may span several perakim. `tanah_article.perek_id` stays the
primary perek association. The composite PK
`(article_id, perek_id, pasuk)` prevents duplicate mappings, the
`(perek_id, pasuk)` index serves verse/range lookups, and `pasuk >= 1`
is a CHECK. FKs: `article_id → tanah_article` (ON DELETE CASCADE) and
`perek_id → tanah_perek`.

**Verified vs unknown coverage** — `tanah_article.coverage_verified`:
- `FALSE` (default; every legacy article): detailed coverage was never
  mapped. Consumers match the article through its primary perek only —
  no verse precision is claimed.
- `TRUE`: the covering-source rows are the verified coverage and drive
  range lookups; the article surfaces only for slices overlapping those
  coordinates (and no longer through unrelated slices of its primary
  perek).

There is deliberately **no backfill** from `perek_id`: a primary perek
alone must not fabricate whole-perek coverage. Mappings are authored
through the admin article form (verified flag + per-row coordinates)
and live in the database — never in populators or fixture files
(`tanah_test_data.sql` carries demo rows for CI fixtures only).

**Pasuk existence** — `tanah_perek.pasuk_count` stores the canonical
number of pesukim per perek (corpus-derived; NULL = bound unknown, not
zero). MySQL has no per-row dynamic CHECK, so write paths validate
`pasuk <= pasuk_count` against it and reject writes when the bound was
never loaded. The column ships in `tanah_static_structure.sql` /
`tanah_perek_view`, is backfilled for existing databases by the
idempotent `tanah_perek_pasuk_count_upgrade.sql`, and filled by
`tanah_perek_pasuk_count_data.sql` (929 perakim, regenerated from the
checked-in corpus by `data/mysql/scripts/generate-perek-pasuk-counts.mjs`).
Regenerated `tanah view` MySQL output also emits the column.

**Write-path contract** (admin server `articles.ts` /
`covering-sources.ts`):
- `coveringSources` omitted on update → coverage untouched (older
  clients and unrelated edits can never wipe mappings).
- `coveringSources: []` → the persisted set is cleared and the flag is
  stored as unverified; verified+empty is rejected (verified coverage
  requires at least one row).
- `coverageVerified` alone toggles the flag on the persisted set; TRUE
  requires at least one stored covering row.
- Validation order: shape/integers + duplicates pre-flight, perek
  existence + pasuk bounds inside the transaction, then replace
  (DELETE + INSERT + flag) and the article write commit atomically —
  failures roll back everything.
- Deletes remove covering rows explicitly inside the transaction (the
  CASCADE is the backstop), and article/perek search invalidation is
  enqueued in the same transaction.
- A pre-upgrade database (no covering table / flag / pasuk_count)
  degrades to coverage-unknown reads and never writes coverage state.

**API exposure** — the GraphQL `Article` type adds `coverageVerified`
and a lazy `coveringSources { perekId pasuk }` field; `Perek` adds
`pasukCount`. The admin perek list badges verified articles.

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
