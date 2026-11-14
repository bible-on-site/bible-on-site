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

### Debug with MongoDB Compass

```bash
cargo make generate-perushim-compass-stages
```

## Database Schema

### Catalog (`perushim_catalog_structure.sql`) — small, bundled

- **`parshan`** — Commentator metadata: id, name (Hebrew)
- **`perush`** — Commentary work: id, name, parshan reference, dates

### Notes (`perushim_notes_structure.sql`) — large, PAD / on-demand

- **`note`** — One row per commentary phrase per pasuk: `(perush_id, perek_id, pasuk, note_idx, note_content)`. Matches the legacy `tanah_note` schema pattern.

## On-Demand Delivery for Mobile App

Since note text data is very large, it should **not** be bundled with the mobile app:

1. **Bundle catalog only** — The `perushim_catalog.sqlite` (parshan + perush tables) is small (~50–100 KB) and bundled in `Resources/Raw/`.

2. **Package notes as Play Asset Delivery (PAD)** — Use on-demand asset pack. Google hosts the notes for free. Pipeline outputs to `app/BibleOnSite/Platforms/Android/AssetPacks/perushim_notes/`.

3. **HTTP fallback** — When PAD is not available (sideloaded APK, emulator, or non-Android), app downloads from S3 when user taps "להוריד פירושים".

4. **Download on-demand** — When notes are not available (PAD not yet fetched or HTTP fallback):
   - Show "להוריד פירושים" button in perushim panel and in Settings.
   - If using S3: download from `bible-on-site-assets.s3.il-central-1.amazonaws.com/perushim/...`
   - Save to `FileSystem.AppDataDirectory` and open as read-only SQLite.

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
| מדרש לקח טוב | Verified book/chapter/verse/midrash arrays |
| מדרש שכל טוב | Verified book/chapter/verse/paragraph arrays |
| מדרש משלי | Verified chapter/verse text |
| מדרש תנאים על דברים | Verified default node with chapter/verse/paragraph arrays |
| מכילתא דרבי שמעון בן יוחאי | Verified chapter/verse arrays in both default and Additions nodes |

All resolvers check biblical verse bounds using
[`verse_counts.json`](src/data/verse_counts.json), derived from the checked-in
Tanakh view. Notes sharing a verse receive consecutive indices, including when
several source units or nodes map to that verse. Newly included midrashim are
extracted after the existing commentaries to preserve existing catalog IDs.
Mapping errors stop generation before JSON, SQLite, or MySQL output is written.

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
of references when an indivisible paragraph explains several verses, or `null`
for an explicitly reviewed unit without a biblical subject. A source siman
stored as one string has one paragraph entry. Original text is retained intact.

The anchors describe the passage's exegetical subjects. Proems and continuations
can share a siman's subject; incidental quotations are not treated as subjects.
Some source units cross chapters and some explain verses outside the parashah
or outside the Torah. Those passages have their actual subjects mapped rather
than being forced into a parashah's first verse. Only three slots are omitted:
Bereshit 13:1 (a standalone dream anecdote without a biblical lemma), Masei 13:2
and V'Zot HaBerachah 7:2 (book-ending colophons).

[`tanchuma_manifest.json`](src/data/tanchuma_manifest.json) records edition,
source revision, reading order, paragraph counts and per-parashah fingerprints.
Fingerprints use FNV-1a over the original UTF-8 strings with typed string/array
delimiters, so text or segmentation changes require manual review. To update an
edition, review the affected paragraph subjects and dictionary entries, update
the manifest, then run the full pipeline integration test. Never refresh a
fingerprint merely to suppress a source-change error. Tsel and Buber editions
must receive their own reviewed mappings before inclusion.

#### Mekhilta and remaining gaps

The newer Mekhilta layout requires both `startingAddress` and
`skipped_addresses` when reading verse-indexed references. Inclusive paragraph
ranges are expanded exactly. Two missing source paragraphs have explicit,
guarded assignments in [`mekhilta.rs`](src/data/mekhilta.rs): Vayassa 4:22 to
Exodus 16:15 and Nezikin 16:28 to Exodus 22:14. Every nonempty selected paragraph
must be covered. In the pinned dump, ordinary fullest-version selection keeps
805 Wikisource paragraphs at 309 verses; this is not a merge of all editions.

מדרש אגדה is deliberately excluded: its apparent verse structure contains
mixed numbering and erroneous coordinates. See
[the coordinate-audit follow-up](https://github.com/bible-on-site/bible-on-site/issues/3366).
Other literary midrashim such as רבה and פרקי דרבי אליעזר are not automatically
included. Their chapter numbers need separate, reviewed verse maps.

Run the focused checks with `cargo test -p perushim-view`. With the Sefaria
MongoDB dump available, run `cargo test -p perushim-view --features integration`
(set `MONGO_HOST`, `MONGO_PORT` and `DUMP_NAME` for a non-default local database).
The integration tests execute the actual aggregation and verify mapped notes.

### Excluded Titles

The match stage excludes titles for several reasons (see `stage_match_index.rs` for details):
- **Tanakh books** — The 39 base biblical texts (not commentaries)
- **Haskalah/Reform** — Works with Haskalah (Jewish Enlightenment) connections
- **Modern English** — Modern English-language works (not traditional Hebrew perushim)
- **Not perushim** — Works that are not verse-by-verse commentaries
- **Unclear** — Titles excluded for reasons that need clarification (marked with TODO)
