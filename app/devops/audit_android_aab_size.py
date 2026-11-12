"""Audit a built Android App Bundle for packaging defects and size regressions.

Issue #3309: Google Play reported a 293 MB update for a release whose fresh
install downloads ~41 MB. The postmortem showed the on-demand modules were
declared correctly and did not leak into the base module — but the delivered
search index still duplicated ~250 MB of note text the notes database already
stores compressed, and no release gate watched the numbers.

This check is the regression guard: it inspects the exact archive Play
receives and fails when the base module carries optional payloads, when the
perushim pack slips off on-demand delivery, when the search index regresses
to the duplicated-text layout, or when module sizes cross their budgets. It
also emits a machine-readable module-size breakdown so every packaged run
leaves the evidence a size complaint needs next time.

No bundletool dependency: the AAB is a zip; delivery mode is probed from the
compiled manifest's embedded element names.
"""

import argparse
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import zipfile

SEARCH_INDEX = "sefaria-dump-5784-sivan-4.hebrew_search.sqlite"
PERUSHIM_PACK = "perushim_notes"
RECITATION_PREFIX = "recitation_"

# Payloads the base module legitimately ships: bundled scripture plus the
# perushim catalog. Everything else blob-heavy belongs to optional packs.
BASE_PAYLOAD_ALLOWLIST = frozenset({
    "sefaria-dump-5784-sivan-4.tanah_view.sqlite",
    "sefaria-dump-5784-sivan-4.perushim_catalog.sqlite",
})
PAYLOAD_SUFFIXES = (".sqlite", ".zip", ".ogg", ".mp3", ".aac", ".wav")

# app-v5.1.19 baseline: the base module compresses to ~43.4 MB and the
# device-specific fresh-install download measured ~41.4 MB (bundletool
# get-size, arm64/xxxhdpi). Budget leaves ~25% headroom.
BASE_MODULE_MAX_COMPRESSED = 55 * 1024 * 1024

# The current index layout stores note identity, not text (~80 MB on disk
# for the 340K-note corpus). A delivered index back at the pre-#3309 ~333 MB
# scale means the text duplication regressed.
SEARCH_INDEX_MAX_UNCOMPRESSED = 160 * 1024 * 1024

# Delivery modes embedded in a compiled PAD manifest as element names.
_ON_DEMAND_TOKENS = ("on-demand".encode(), "on-demand".encode("utf-16-le"))
_OTHER_DELIVERY_TOKENS = tuple(
    mode.encode(codec) for mode in ("install-time", "fast-follow") for codec in ("utf-8", "utf-16-le")
)


def _manifest_is_on_demand(manifest: bytes) -> bool:
    """Compiled manifests keep element names verbatim in the string table."""
    return any(token in manifest for token in _ON_DEMAND_TOKENS) and not any(
        token in manifest for token in _OTHER_DELIVERY_TOKENS)


def _module_of(entry_name: str) -> str:
    return entry_name.split("/", 1)[0]


def _audit_search_index(archive: zipfile.ZipFile, info: zipfile.ZipInfo) -> dict:
    """Open the packaged index in place and verify the slim documents layout."""
    finding = {"uncompressedBytes": info.file_size}
    if info.file_size > SEARCH_INDEX_MAX_UNCOMPRESSED:
        raise ValueError(
            f"{SEARCH_INDEX} is {info.file_size / (1024 * 1024):.0f} MB uncompressed — "
            f"above the {SEARCH_INDEX_MAX_UNCOMPRESSED / (1024 * 1024):.0f} MB budget. "
            "The index must store note identity, not duplicate the note text "
            "the notes database already holds compressed (#3309)."
        )
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as handle:
        handle.write(archive.read(info))
        path = Path(handle.name)
    try:
        with closing(sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)) as index:
            columns = {row[1] for row in index.execute("PRAGMA table_info(notes_documents)")}
            documents = index.execute("SELECT COUNT(*) FROM notes_documents").fetchone()[0]
    finally:
        path.unlink(missing_ok=True)
    finding["notesDocumentColumns"] = sorted(columns)
    finding["notesDocumentRows"] = documents
    if "Text" in columns:
        raise ValueError(
            f"{SEARCH_INDEX} still stores the note text inside notes_documents — "
            "the pack was built from a pre-#3309 artifact. Regenerate the indexed "
            "perushim artifact (or wait for the master baseline refresh) before packaging."
        )
    if "NoteIdx" not in columns or documents == 0:
        raise ValueError(
            f"{SEARCH_INDEX} is not a usable slim index "
            f"(columns: {sorted(columns)}, rows: {documents})"
        )
    return finding


def audit(package: Path) -> dict:
    """Collect the module breakdown and reject a bloated or mispackaged bundle."""
    if not package.is_file():
        raise ValueError(f"AAB not found: {package}")
    report: dict = {"package": package.name, "modules": {}}
    with zipfile.ZipFile(package) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            module = report["modules"].setdefault(
                _module_of(info.filename),
                {"files": 0, "compressedBytes": 0, "uncompressedBytes": 0})
            module["files"] += 1
            module["compressedBytes"] += info.compress_size
            module["uncompressedBytes"] += info.file_size

        base = report["modules"].get("base")
        if base is None:
            raise ValueError("AAB has no base module")
        if base["compressedBytes"] > BASE_MODULE_MAX_COMPRESSED:
            raise ValueError(
                f"base module compresses to {base['compressedBytes'] / (1024 * 1024):.1f} MB — "
                f"above the {BASE_MODULE_MAX_COMPRESSED / (1024 * 1024):.0f} MB budget "
                "(v5.1.19 baseline: ~43.4 MB). Every install pays this size."
            )

        leaks = sorted(
            info.filename for info in archive.infolist()
            if info.filename.startswith("base/")
            and Path(info.filename).name.lower().endswith(PAYLOAD_SUFFIXES)
            and Path(info.filename).name not in BASE_PAYLOAD_ALLOWLIST)
        if leaks:
            raise ValueError(
                "Optional payloads leaked into the base module: " + ", ".join(leaks))

        packs = [name for name in report["modules"]
                 if name == PERUSHIM_PACK or name.startswith(RECITATION_PREFIX)]
        if PERUSHIM_PACK not in packs:
            raise ValueError(f"AAB is missing the {PERUSHIM_PACK} asset pack")
        if not any(name.startswith(RECITATION_PREFIX) for name in packs):
            raise ValueError("AAB contains no recitation_* asset packs")
        for pack in packs:
            manifest_name = f"{pack}/manifest/AndroidManifest.xml"
            if manifest_name not in archive.namelist():
                raise ValueError(f"asset pack {pack} lacks a manifest")
            if not _manifest_is_on_demand(archive.read(manifest_name)):
                raise ValueError(
                    f"asset pack {pack} is not declared on-demand — its download "
                    "would count toward the listed app size"
                )

        index_entry = next(
            (info for info in archive.infolist()
             if info.filename == f"{PERUSHIM_PACK}/assets/{SEARCH_INDEX}"),
            None)
        if index_entry is not None:
            report["searchIndex"] = _audit_search_index(archive, index_entry)
    return report


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--package", required=True, type=Path,
                        help="Path to the .aab produced by the Release build")
    parser.add_argument("--json-out", type=Path,
                        help="Write the machine-readable module breakdown here")
    args = parser.parse_args(argv)
    try:
        report = audit(args.package)
    except (ValueError, zipfile.BadZipFile, sqlite3.Error) as exc:
        print(f"::error::{exc}")
        return 1
    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    for name, module in sorted(report["modules"].items(),
                               key=lambda item: -item[1]["compressedBytes"]):
        mb = 1024 * 1024
        print(f"{name}: {module['compressedBytes'] / mb:.1f} MB compressed, "
              f"{module['uncompressedBytes'] / mb:.1f} MB uncompressed, "
              f"{module['files']} files")
    if args.json_out:
        print(f"Module size breakdown written to {args.json_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
