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

3. **iOS ODR and debug fallback** — iOS uses Apple On-Demand Resources. Android debug APKs can bundle the notes database as an app asset.

4. **Download on-demand** — When notes are not available:
   - Show "להוריד פירושים" button in perushim panel and in Settings.
   - Fetch the matching notes pack through PAD/ODR, or copy a bundled debug asset.
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

### Excluded Titles

The match stage excludes titles for several reasons (see `stage_match_index.rs` for details):
- **Tanakh books** — The 39 base biblical texts (not commentaries)
- **Haskalah/Reform** — Works with Haskalah (Jewish Enlightenment) connections
- **Modern English** — Modern English-language works (not traditional Hebrew perushim)
- **Not perushim** — Works that are not verse-by-verse commentaries
- **Unclear** — Titles excluded for reasons that need clarification (marked with TODO)
