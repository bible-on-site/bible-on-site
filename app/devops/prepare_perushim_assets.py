"""Validate and install the catalog/notes pair produced by one data generation."""

import argparse
from contextlib import closing
import json
from pathlib import Path
import shutil
import sqlite3
import sys

CATALOG = "sefaria-dump-5784-sivan-4.perushim_catalog.sqlite"
NOTES = "sefaria-dump-5784-sivan-4.perushim_notes.sqlite"
SEARCH_INDEX = "sefaria-dump-5784-sivan-4.hebrew_search.sqlite"
NOTES_DIRECTORIES = {
    "Android": "Platforms/Android/AssetPacks/perushim_notes",
    "iOS": "Platforms/iOS/Assets/PerushimNotes.xcassets/perushim_notes.dataset",
}
SEARCH_INDEX_DIRECTORIES = {
    "Android": "Platforms/Android/AssetPacks/perushim_notes",
    "iOS": "Platforms/iOS/Assets/PerushimNotes.xcassets/perushim_search.dataset",
}


def validate_pair(source: Path) -> int:
    """Reject stale, corrupt, or independently generated inputs before copying."""
    for name in (CATALOG, NOTES):
        if not (source / name).is_file():
            raise ValueError(f"Missing {name}; regenerate the paired Perushim SQLite artifact")

    with closing(sqlite3.connect((source / CATALOG).resolve().as_uri() + "?mode=ro", uri=True)) as catalog:
        mapping = {str(key): name for key, name in catalog.execute("SELECT id, name FROM perush")}
        catalog_metadata = dict(catalog.execute("SELECT key, value FROM _metadata"))
    with closing(sqlite3.connect((source / NOTES).resolve().as_uri() + "?mode=ro", uri=True)) as notes:
        notes_metadata = dict(notes.execute("SELECT key, value FROM _metadata"))
        if notes_metadata.get("schema_version") != "2":
            raise ValueError("Notes are not schema v2; regenerate the paired Perushim SQLite artifact")
        snapshot = notes_metadata.get("perush_catalog")
        if snapshot is None:
            raise ValueError("Notes lack perush_catalog; regenerate the paired Perushim SQLite artifact")
        if not mapping or json.loads(snapshot) != mapping:
            raise ValueError("Notes ID-to-name mapping does not match the catalog")
        notes_timestamp = int(notes_metadata.get("build_timestamp", "0"))
        catalog_timestamp = int(catalog_metadata.get("build_timestamp", "0"))
        if notes_timestamp <= 0 or notes_timestamp != catalog_timestamp:
            raise ValueError("Catalog and notes must come from the same generation")
        unknown_ids = {str(row[0]) for row in notes.execute("SELECT DISTINCT perush_id FROM perek_perush")} - mapping.keys()
        if unknown_ids:
            raise ValueError(f"Notes contain IDs absent from the catalog: {sorted(unknown_ids)}")
        if notes.execute("SELECT COUNT(*) FROM note_blob").fetchone()[0] != \
                notes.execute("SELECT COUNT(DISTINCT perek_id) FROM perek_perush").fetchone()[0]:
            raise ValueError("note_blob must carry every perek present in perek_perush")
        validate_search_index(source / SEARCH_INDEX, notes_timestamp)
    return len(mapping)


def validate_search_index(index_path: Path, notes_timestamp: int) -> None:
    """Reject a delivered index that is missing, malformed, or from another
    generation. The file is optional for older artifacts — the app falls back
    to on-device indexing when the pack does not carry it."""
    if not index_path.is_file():
        print(f"No delivered search index at {index_path}; the app will build it on-device")
        return
    with closing(sqlite3.connect(index_path.resolve().as_uri() + "?mode=ro", uri=True)) as index:
        try:
            fingerprints = dict(index.execute("SELECT name, fingerprint FROM search_metadata"))
        except sqlite3.Error as error:
            raise ValueError("Search index lacks search_metadata fingerprints") from error
        expected_notes = f"v4:{notes_timestamp}:n"
        if not str(fingerprints.get("notes", "")).startswith(expected_notes):
            raise ValueError("Search index was built for a different notes generation")
        if not str(fingerprints.get("verses", "")).startswith("v4:"):
            raise ValueError("Search index lacks a verses fingerprint")
        tables = {row[0] for row in index.execute(
            "SELECT name FROM sqlite_master WHERE name IN "
            "('verses','verses_documents','notes','notes_documents')")}
        if len(tables) != 4:
            raise ValueError("Search index is missing FTS/documents tables")


def prepare_assets(source: Path, app_directory: Path, platform: str) -> int:
    destination = NOTES_DIRECTORIES[platform]
    count = validate_pair(source)
    catalog_directory = app_directory / "Resources/Raw"
    notes_directory = app_directory / destination
    catalog_directory.mkdir(parents=True, exist_ok=True)
    notes_directory.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source / CATALOG, catalog_directory / CATALOG)
    shutil.copy2(source / NOTES, notes_directory / NOTES)
    if (source / SEARCH_INDEX).is_file():
        index_directory = app_directory / SEARCH_INDEX_DIRECTORIES[platform]
        index_directory.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / SEARCH_INDEX, index_directory / SEARCH_INDEX)
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--app-directory", type=Path, required=True)
    parser.add_argument("--platform", choices=NOTES_DIRECTORIES, required=True)
    args = parser.parse_args()
    try:
        count = prepare_assets(args.source, args.app_directory, args.platform)
    except (OSError, sqlite3.Error, ValueError) as error:
        print(f"Perushim asset preparation failed: {error}", file=sys.stderr)
        return 1
    print(f"Prepared matching catalog and notes ({count} commentary mappings) for {args.platform}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
