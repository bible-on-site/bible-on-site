"""Build lossless, release-coupled recitation book packs for PAD / ODR / desktop."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
from urllib.request import urlopen
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "data/recitation"))
from audit import audit
from audit_native import audit_native, NATIVE
from publish import DATABASE, chapters_in, extract, publish

CATALOG = "recitation-catalog.json"


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def recording(track, cache, recordings=None):
    """Only the build fetches S3; immutable byte hashes are checked before packaging."""
    destination = cache / (track["audioSha256"] + ".mp3")
    if destination.is_file() and digest(destination) == track["audioSha256"]:
        return destination
    temporary = destination.with_suffix(".download")
    try:
        if recordings is not None:
            shutil.copyfile(recordings / f'{track["perekId"]}_record.mp3', temporary)
        else:
            with urlopen(track["audioUrl"], timeout=120) as source, temporary.open("wb") as target:  # nosec B310: URLs are from the validated release database.
                shutil.copyfileobj(source, target)
        if digest(temporary) != track["audioSha256"]:
            raise ValueError(f'{track["perekId"]}: recording checksum mismatch')
        temporary.replace(destination)
        return destination
    finally:
        temporary.unlink(missing_ok=True)


def book_archive(destination, tracks, cache):
    temporary = destination.with_suffix(".download")
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED) as archive:
            for sha in sorted({track["audioSha256"] for track in tracks}):
                # Fixed timestamps make a repeated build byte-identical, without re-encoding MP3.
                entry = zipfile.ZipInfo(sha + ".mp3", (1980, 1, 1, 0, 0, 0))
                entry.external_attr = 0o100644 << 16
                with archive.open(entry, "w") as target, (cache / (sha + ".mp3")).open("rb") as source:
                    shutil.copyfileobj(source, target)
        if temporary.stat().st_size > 512_000_000:
            raise ValueError(f"{destination.name}: book exceeds the supported ODR tag limit")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def prepare_assets(app, platform, cache, recordings=None, intermediate=None, database=DATABASE, native=NATIVE):
    cache.mkdir(parents=True, exist_ok=True)
    # Never mutate the canonical file or a live GPU checkpoint to make app assets.
    with tempfile.TemporaryDirectory() as temporary:
        snapshot = Path(temporary) / "perakim.json"
        shutil.copyfile(database, snapshot)
        publish(intermediate or ROOT / "data/recitation/recitation.sqlite", snapshot)
        audit(intermediate or ROOT / "data/recitation/recitation.sqlite", snapshot)
        audit_native(snapshot, native)
        chapters = chapters_in(json.loads(snapshot.read_text(encoding="utf-8")))
        tracks = [extract(pid, chapter) for pid, chapter in sorted(chapters.items()) if "recitation" in chapter]
    for track in tracks:
        if track["alignmentStatus"] != "ready":
            track["words"] = []  # Held candidates stay in the alignment work cache.
    with closing(sqlite3.connect(native.resolve().as_uri() + "?mode=ro", uri=True)) as connection:
        mapping = {pid: sid for sid, first, last in connection.execute("SELECT id,perek_id_from,perek_id_to FROM tanah_sefer")
                   for pid in range(first, last + 1)}
    if not tracks or any(t["perekId"] not in mapping for t in tracks):
        raise ValueError("Recitation inventory does not match the native books")
    with ThreadPoolExecutor(max_workers=4) as pool:
        unique_audio = {track["audioSha256"]: track for track in tracks}
        list(pool.map(lambda track: recording(track, cache, recordings), unique_audio.values()))
    books = []
    for sid in sorted({mapping[t["perekId"]] for t in tracks}):
        selected = [t for t in tracks if mapping[t["perekId"]] == sid]
        pack = f"recitation_{sid}"
        path = cache / (pack + ".zip")
        book_archive(path, selected, cache)
        books.append({"seferId": sid, "sha256": digest(path), "sizeBytes": path.stat().st_size,
                      "perekIds": [t["perekId"] for t in selected]})
        if platform == "Android":
            directory = app / "Platforms/Android/AssetPacks" / pack
        elif platform == "iOS":
            catalog = app / "Platforms/iOS/Assets/Recitation.xcassets"
            catalog.mkdir(parents=True, exist_ok=True)
            (catalog / "Contents.json").write_text(json.dumps({"info": {"author": "xcode", "version": 1}}), encoding="utf-8")
            directory = catalog / (pack + ".dataset")
        else:
            directory = app / "Platforms/Windows/Recitation"
        directory.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, directory / path.name)
        if platform == "iOS":
            contents = {"data": [{"filename": path.name, "universal-type-identifier": "public.zip-archive"}],
                        "info": {"author": "xcode", "version": 1}, "properties": {"on-demand-resource-tags": [pack]}}
            (directory / "Contents.json").write_text(json.dumps(contents, indent=2) + "\n", encoding="utf-8")
    raw = app / "Resources/Raw"
    raw.mkdir(parents=True, exist_ok=True)
    catalog = {"version": 1, "package": {"version": 1, "tracks": tracks}, "books": books}
    (raw / CATALOG).write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {len(tracks)} original recordings in {len(books)} {platform} book packs")
    return catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-directory", type=Path, default=ROOT / "app/BibleOnSite")
    parser.add_argument("--platform", choices=["Android", "iOS", "Windows"], required=True)
    parser.add_argument("--cache", type=Path, default=ROOT / ".cache/recitation-assets")
    parser.add_argument("--recordings", type=Path)
    args = parser.parse_args()
    prepare_assets(args.app_directory, args.platform, args.cache, args.recordings)


if __name__ == "__main__":
    main()
