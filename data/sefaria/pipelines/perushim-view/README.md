# perushim-view

A Rust CLI tool that generates perushim (commentaries) data from a MongoDB Sefaria dump. Produces three entities — **parshan** (commentator), **perush** (commentary work), and **note** (commentary text per pasuk) — in multiple output formats.

## Entities

| Entity | Description | Web delivery | App delivery |
|--------|-------------|-------------|--------------|
| **parshan** | Commentator (person) | JSON | Bundled SQLite |
| **perush** | Commentary work (book) | JSON | Bundled SQLite |
| **note** | Commentary phrase per pasuk | MySQL | PAD / on-demand SQLite |

## Usage

```bash
cargo run -p perushim-view -- --help
```

### Generate JSON (parshanim + perushim for web)

```bash
cargo make generate-perushim-view-json
```

### Generate SQLite (catalog bundled + notes for PAD)

```bash
cargo make generate-perushim-view-sqlite
```

### Generate MySQL (notes for web backend)

```bash
cargo make generate-perushim-view-mysql
```

The SQL import preserves the destination database's author and work IDs by
matching exact names. Incoming JSON/SQLite IDs are local catalog identities;
they are remapped when importing notes into an existing web database. New
database identities are allocated above the existing maxima.

Catalogs and notes first load into temporary staging tables. An explicit
transaction locks the existing catalogs, validates the identity maps, and
replaces changed work/chapter notes. Published works and chapters absent from
the incoming snapshot remain available. Derived note and commentary metrics
for changed chapters are invalidated when those tables exist; metrics for
unchanged chapters are retained. Ambiguous names and invalid references abort
the import instead of attaching text to another work.

Website builds clone the production commentary catalogs and notes before
replaying the same import. This keeps prerendered work IDs and retained
chapters consistent with the destination database.

Full local bootstraps reset commentary fixtures and derived metrics before
loading fixed-ID seeds. Data-only imports retain the additive schema. Test
fixtures that read canonical DDL must accept `CREATE TABLE IF NOT EXISTS`.

The Lambda closes a failed import connection, rolling back its transaction.
Rolling back a completed publication uses the pre-import RDS recovery point
and the matching web/native release snapshots.

### Debug with MongoDB Compass

```bash
cargo make generate-perushim-compass-stages
```

## Database Schema

### Catalog (`perushim_catalog_structure.sql`) — small, bundled

- **`parshan`** — Commentator metadata: id, name (Hebrew)
- **`perush`** — Commentary work: id, name, parshan reference, dates

### Notes (`perushim_notes_structure.sql`) — compressed, PAD / on-demand

Schema v2 (`_metadata.schema_version = '2'`) stores notes as one zlib-compressed
blob per perek — roughly a quarter of the v1 row-based size:

- **`note_blob`** — One row per perek: `(perek_id, data)`. The `data` blob is the
  PNB1 format in `src/commands/note_blob.rs`, decoded by the app in
  `PerushNoteBlob.cs`. Records inside are ordered by (pasuk, perush_id, note_idx).
- **`perek_perush`** — One row per (perek, perush) pair, for the picker's
  "which perushim exist here" lookup.

Re-generating the committed `.sqlite.gz` fallback without a MongoDB dump:
`--format convert-notes --input <v1.sqlite> --output <v2.sqlite>` reads a v1
row-based notes DB, emits v2, and verifies every decoded record against the source.

### Search index (`hebrew_search.sqlite`) — prebuilt FTS5, same pack

`--format sqlite` also emits a ready-to-query FTS5 search index next to the
notes DB (verses + notes documents, `search_metadata` fingerprints binding it
to the exact generation it was built from). The app adopts it instead of
re-importing ~372K notes on-device. Its `.gz` is **not** committed. The index
travels via CI artifacts into the same PAD/ODR pack.

Rebuilding only the index without MongoDB:
`--format search-index --input <v2 notes.sqlite> --output <index.sqlite>`
(`--tanah-view` overrides the bundled verses source; `cargo make generate-search-index`).

Text normalization lives in `search_text.rs` — a port of the app's
`SearchText.PlainText`/`Normalize`. Bump `NORM_VERSION` together with
`SearchText.NormalizationVersion` so pipeline and app fingerprints stay comparable.

## On-Demand Delivery for Mobile App

Since note text data is very large, it should **not** be bundled with the mobile app:

1. **Bundle catalog only** — The `perushim_catalog.sqlite` (parshan + perush tables) is small (~50–100 KB) and bundled in `Resources/Raw/`.

2. **Package notes as Play Asset Delivery (PAD)** — Use on-demand asset pack. Google hosts the notes for free. Pipeline outputs to `app/BibleOnSite/Platforms/Android/AssetPacks/perushim_notes/`.

3. **Other platforms and fallback** — Managed delivery is used where available. Android debug APKs can bundle notes. Other runtimes download notes and the search index from their matching `app-v<version>` GitHub release, preserving older versions' matching packs.

4. **Download on-demand** — When notes are not available:
   - Show "להוריד פירושים" button in perushim panel and in Settings.
   - Fetch the matching notes/search pack through managed delivery or the versioned release, or copy a bundled debug asset.
   - Save to `FileSystem.AppDataDirectory` and open as read-only SQLite.

The bundled catalog is refreshed on app startup. Notes include the complete
`perush_catalog` ID-to-name mapping in `_metadata`; clients verify it before
resolving IDs against their catalog. Legacy packs require an identical nonzero
catalog/notes build timestamp. A mismatch offers the download action even when
an older local file exists. See the [attribution RCA](../../../../docs/app/commentary-attribution.md).

JSON generation also refreshes the client-safe `perush-names.ts` citation projection.

## Aggregation Pipeline

The aggregation pipeline in [aggregation.rs](src/aggregation.rs) runs against the `index` collection and contains 9 stages that transform Sefaria data into the perushim view format.

### Pipeline Stages

1. **Match Index** — Filter `index` collection for Tanakh commentaries, excluding base texts and excluded titles
2. **Lookup Texts** — Join with `texts` collection for version data
3. **Normalize Authors** — Transform author identifiers for person collection lookup
4. **Lookup Person** — Resolve author details from the `person` collection
5. **Project Initial** — Extract Hebrew title, authors, filtered versions, schema
6. **Project Name** — Parse perush name and sefer name from Hebrew title
7. **Match Versions** — Filter out entries with no Hebrew versions
8. **Project Final** — Map sefer names to canonical numbers, finalize fields
9. **Sort** — Order by commentator name and sefer number

### Midrashim and verse mapping

Sefaria categorizes midrashim under `Midrash`, so the original `Tanakh`
filter excluded them before extraction. The pipeline explicitly includes the
works below and dispatches them to schema-specific resolvers. It does not
interpret a parashah, siman, or midrash chapter number as a biblical chapter.

| Work | Mapping |
|------|---------|
| מדרש תנחומא | Manually reviewed dictionary for each source paragraph |
| מכילתא דרבי ישמעאל | Biblical coordinates in the 5784 dump; explicit verse-indexed `Chapter` alternative structure in the newer tractate layout |
| מדרש משלי | Manually reviewed homily-to-verse dictionary for the Buber edition |
| מדרש תנאים על דברים | Verified default node with chapter/verse/paragraph arrays |
| מכילתא דרבי שמעון בן יוחאי | Verified chapter/verse arrays in both default and Additions nodes |

All resolvers check biblical verse bounds using
[`verse_counts.json`](src/data/verse_counts.json), derived from the checked-in
Tanakh view. Notes sharing a verse receive consecutive indices, including when
several source units or nodes map to that verse. Newly included midrashim are
extracted after the existing commentaries. CLI generation then preserves the
committed JSON/SQLite catalog's IDs by work/author name and appends new IDs. The
MySQL import independently preserves the web database's existing identities.
Existing works absent from the current public dump retain their metadata and bundled notes;
this keeps their commentary URLs available when Sefaria no longer exports an
edition. Published chapters absent from a fresh extraction retain their bundled
notes too; refreshed chapters use only their fresh notes. Empty new works are
not added to the catalog. The bundled notes' catalog
identity must match the committed web catalog before any fallback is accepted.
Mapping errors stop generation before JSON, SQLite, or MySQL output is written.

Anchors identify the original passage being explained. Supporting quotations
from Nevi'im/Ketuvim, and comparisons to other passages, do not become targets.
A source unit explaining a set of pesukim is attached to the first verse of
that passage, with its full text retained. A unit that clearly moves to a
separate Torah passage can have another passage-start anchor.

#### Tanchuma dictionary

The selected edition is **Midrash Tanchuma -- Torat Emet**. Its 54 parashot,
767 simanim and 2,121 paragraph slots are mapped in
[`tanchuma_genesis_exodus.json`](src/data/tanchuma_genesis_exodus.json) and
[`tanchuma_leviticus_deuteronomy.json`](src/data/tanchuma_leviticus_deuteronomy.json).
The dictionary was manually authored from the
[June 2024 source snapshot](https://github.com/Sefaria/Sefaria-Export-Archive/tree/a155a11352fea18612328587e6897105a7f6b357/json/Midrash/Aggadah/Midrash%20Tanchuma/Hebrew),
with the compiler's headings in
[Sefaria's importer source](https://github.com/Sefaria/Sefaria-Data/tree/master/sources/Tanhuma)
used as additional review evidence. Compiler headings can contain incorrect
references, so they are not used as automatic assignments.

Each parashah key contains a siman list; each siman contains a paragraph list.
A paragraph entry is a canonical reference such as `"Genesis 1:1"`, an array
of passage starts when an indivisible paragraph explains separate Torah
passages, or `null` for an explicitly reviewed unit without an identifiable
Torah context. A source siman
stored as one string has one paragraph entry. Original text is retained intact.

Proems and continuations remain attached to their Torah context. For example,
Vayikra 8 explains the opening Leviticus 1:1-2 passage and the separate
bird-offering passage at 1:14. It therefore has anchors at 1:1 and 1:14; its
extended Jonah discussion remains supporting material. All Tanchuma targets
are in the Torah. Eleven slots are explicitly omitted: Bereshit 13:1-5 and
Toldot 14:1-3 are detached anecdotes and Nevi'im/Ketuvim appendices without a defensible Torah
context; Masei 5:1 is a standalone Joshua/Achan exposition; Masei 13:2 and
V'Zot HaBerachah 7:2 are book-ending colophons.
The remaining 2,110 paragraphs produce 2,258 Torah passage-start assignments.

[`tanchuma_manifest.json`](src/data/tanchuma_manifest.json) records edition,
source revision, reading order, paragraph counts and text fingerprints.
Fingerprints use FNV-1a over the original UTF-8 strings with typed string/array
delimiters, so text or segmentation changes require manual review. The November
2026 export was also reviewed: its 45 changed paragraphs retain the same subjects
and segmentation. The full November 14 dump adds ten reviewed one-letter source
citation corrections, also without changes to subjects or segmentation.
Exact fingerprints of the reviewed texts are accepted for
those paragraphs, including intermediate cached snapshots containing a mixture
of the independently reviewed transcription corrections. Unknown text changes
still stop generation. To update an
edition, review the affected paragraph subjects and dictionary entries, update
the manifest, then run the full pipeline integration test. Never refresh a
fingerprint merely to suppress a source-change error. Tsel and Buber editions
must receive their own reviewed mappings before inclusion.

#### Mishlei, Mekhilta and remaining gaps

Midrash Mishlei's schema labels its second address `Verse`, but the Buber text
uses packed homily numbers: source 11:2 explains Proverbs 11:21, and source 31:2
explains Proverbs 31:10-11 and is attached to 31:10. Its
[`mishlei_mapping.json`](src/data/mishlei_mapping.json) maps all 140 source slots
at their deepest text granularity, producing 138 passage-start assignments. The two
literal missing-chapter placeholders at source 3:1 and 18:1 are explicitly null.
Original homily text is preserved in full; supporting quotations do not create
additional targets.
[`mishlei_manifest.json`](src/data/mishlei_manifest.json) pins the Buber edition
and exact reviewed source texts; ten citation/text corrections between the
2024 export and current dump have been manually checked. Unknown changes fail
generation. Ordinary source links and packed homily positions are not used as
automatic verse assignments.

The newer Mekhilta layout requires both `startingAddress` and
`skipped_addresses` when reading verse-indexed references. Inclusive paragraph
ranges are expanded exactly. Two missing source paragraphs have explicit,
guarded assignments in [`mekhilta.rs`](src/data/mekhilta.rs): Vayassa 4:22 to
Exodus 16:15 and Nezikin 16:28 to Exodus 22:14. Every nonempty selected paragraph
must be covered. Shared source paragraphs are emitted once, at the first verse
of their mapped passage. In the current tractate layout this preserves all
2,043 paragraphs without repeating them at overlapping verse addresses.
In the pinned dump, ordinary fullest-version selection keeps
805 Wikisource paragraphs at 309 verses; this is not a merge of all editions.

מדרש אגדה is deliberately excluded: its apparent verse structure contains
mixed numbering and erroneous coordinates. See
[the coordinate-audit follow-up](https://github.com/bible-on-site/bible-on-site/issues/3366).
מדרש שכל טוב also needs a manual audit: supplementary paragraphs stored under
Genesis 15:21 and 19:35 explain other verses, including other chapters, despite
having valid coordinates. See [the supplementary-paragraph mapping follow-up](https://github.com/bible-on-site/bible-on-site/issues/3371).
לקח טוב also contains appended collections, including the next parashah's proem
under Leviticus 5:26, which needs its own Torah context. See
[the complete paragraph-audit follow-up](https://github.com/bible-on-site/bible-on-site/issues/3374).
Other literary midrashim such as רבה and פרקי דרבי אליעזר are not automatically
included. Their chapter numbers need separate, reviewed verse maps.

Run the focused checks with `cargo test -p perushim-view`. With the Sefaria
MongoDB dump available, run `cargo test -p perushim-view --features integration`
(set `MONGO_HOST`, `MONGO_PORT` and `DUMP_NAME` for a non-default local database).
The integration tests execute the actual aggregation and verify mapped notes.

Integration also requires a local MySQL 9.7.4 server and Python dependencies from
`tests/requirements-mysql.txt`. Set `MYSQL_IMPORT_TEST_DB_URL` to its connection
URL, with permission to create and drop disposable databases. The harness creates
its own UUID-named databases and exercises the actual generated SQL through both
Lambda parsing paths with simulated S3. Set `MYSQL_IMPORT_TEST_PYTHON` to select a
Python virtual environment. No AWS connection is used by these tests.

To refresh delivered assets, generate JSON, SQLite and MySQL into `.output`
from the last published baseline before replacing any committed files. A
discarded draft pack must not become a fallback for another draft. Publish the three web files (parshanim,
perushim and perush-names) together with the app catalog and notes gzip. Validate
the matching catalog/notes/search SQLite triple with
`app/devops/prepare_perushim_assets.py`; the search index ships through the CI
artifact and is not committed. Updating only one catalog before generating the
remaining outputs intentionally fails the baseline identity check.

### Verify a published update

Generation and publication are separate checks. Successful producer jobs and
uploaded baseline artifacts do not mean that a production update was deployed.

- Follow the normal master push CI through Cross Module CI and Release Data.
  A skipped release job does not import its generated pack.
- Match the data deployment to its source commit, CI run and attempt, and the
  immutable SQL artifact ID and digest. Confirm the production deployment result.
- Follow the matching website release through deployment, then check the serving
  version, published work IDs, canonical commentary pages and live sitemap.
- Follow native release and distribution status separately. Keep catalog, notes
  and search fingerprints aligned; web numeric work IDs belong to another
  namespace and must not be used to identify native notes.

### Excluded Titles

The match stage excludes titles for several reasons (see `stage_match_index.rs` for details):
- **Tanakh books** — The 39 base biblical texts (not commentaries)
- **Haskalah/Reform** — Works with Haskalah (Jewish Enlightenment) connections
- **Modern English** — Modern English-language works (not traditional Hebrew perushim)
- **Not perushim** — Works that are not verse-by-verse commentaries
- **Unclear** — Titles excluded for reasons that need clarification (marked with TODO)
