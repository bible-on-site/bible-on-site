"""Reject native release artifacts with missing, stale, or base-bundled mobile audio."""

import argparse
import hashlib
from io import BytesIO
import json
from pathlib import Path
import shutil
import subprocess  # nosec B404: only ever invokes the fixed argv 'aa extract' below.
import tempfile
import zipfile


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def verify(package, catalog_path, platform, asset_pack_dir=None, archive_dir=None,
           payload_dir=None, extract=None):
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    with zipfile.ZipFile(package) as archive:
        names = archive.namelist()
        catalogs = [n for n in names if Path(n).name == "recitation-catalog.json"]
        if len(catalogs) != 1 or json.loads(archive.read(catalogs[0])) != catalog:
            raise ValueError("Native release lacks its matching recitation catalog")
        if platform == "Android":
            verify_android(archive, catalog, names)
        elif platform == "iOS":
            verify_apple(archive, catalog, names, asset_pack_dir, archive_dir, payload_dir, extract)
        elif platform == "Windows":
            verify_windows(archive, catalog, names)
    print(f'Verified {len(catalog["books"])} {platform} recitation packs in {package.name}')


def verify_android(archive, catalog, names):
    for book in catalog["books"]:
        pack = f'recitation_{book["seferId"]}'
        name = f"{pack}/assets/{pack}.zip"
        if name not in names or hashlib.sha256(archive.read(name)).hexdigest() != book["sha256"]:
            raise ValueError(f"Missing or mismatched PAD book module: {pack}")
        if f"{pack}/manifest/AndroidManifest.xml" not in names:
            raise ValueError(f"Missing PAD manifest: {pack}")
        verify_book_audio(archive.read(name), catalog, book)
    if any(n.startswith("base/") and Path(n).name.startswith("recitation_") and n.endswith(".zip") for n in names):
        raise ValueError("On-demand recordings were included in the Android base installation")


def aa_payload(archive_path, payload_name, work_dir):
    """Extract one payload file from an Apple Archive (.aar) with the `aa` tool."""
    # `xcrun ba-package` emits Apple Archives; hashing the archived bytes —
    # rather than only the source file — proves the artifact Apple will serve
    # matches the catalog. Consume the result before work_dir is cleaned.
    aa = shutil.which("aa")
    if aa is None:
        raise ValueError("Apple Archive tool 'aa' is required to inspect .aar contents")
    # Compressed Apple Archives (including ba-package's pbze envelope) do not
    # carry the uncompressed AA01/YAA1 header. Let Apple's decoder validate the
    # container; decoding errors remain fatal and the extracted bytes are hashed.
    result = subprocess.run(  # nosec B603: fixed argv (aa extract -i/-d), no shell.  # nosemgrep
        [aa, "extract", "-i", str(archive_path), "-d", str(work_dir)],
        capture_output=True, text=True)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise ValueError(f"aa extract failed for {archive_path.name}: {detail}")
    matches = [path for path in work_dir.rglob(payload_name) if path.is_file()]
    if len(matches) != 1:
        raise ValueError(
            f"{archive_path.name}: expected exactly one '{payload_name}' entry, found {len(matches)}")
    return matches[0]


def verify_apple(archive, catalog, names, asset_pack_dir, archive_dir, payload_dir, extract=None):
    """Apple-hosted .aar packs ship beside the IPA, never inside it."""
    if any(Path(n).name == "OnDemandResources.plist" for n in names):
        raise ValueError("IPA still contains an On-Demand Resources manifest")
    if any(".assetpack/" in n or n.startswith("Payload/OnDemandResources/") for n in names):
        raise ValueError("IPA still contains ODR asset packs")
    if any(Path(n).name.startswith("recitation") and n.endswith(".zip") for n in names):
        raise ValueError("On-demand recordings were included in the iOS base installation")
    appex = [n for n in names if "/Extensions/AssetPackDownloader.appex/" in n
             and Path(n).name not in ("Info.plist",)]
    if not appex:
        raise ValueError("IPA lacks the managed asset-pack downloader extension")
    if asset_pack_dir is None or archive_dir is None or payload_dir is None:
        raise ValueError("iOS verification requires --asset-pack-dir, --archive-dir and --payload-dir")
    extract = extract or aa_payload
    for book in catalog["books"]:
        # App Store Connect accepts only alphanumerics and hyphens in asset-pack IDs.
        pack = f'recitation-{book["seferId"]}'
        archive_path = archive_dir / f"{pack}.aar"
        if not archive_path.is_file() or archive_path.stat().st_size == 0:
            raise ValueError(f"Missing asset-pack archive: {archive_path}")
        manifest_path = asset_pack_dir / pack / "Manifest.json"
        if not manifest_path.is_file():
            raise ValueError(f"Missing asset-pack manifest: {manifest_path}")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("assetPackID") != pack or "onDemand" not in manifest.get("downloadPolicy", {}):
            raise ValueError(f"Malformed asset-pack manifest: {pack}")
        if not {"iOS", "macOS"}.issubset(manifest.get("platforms", [])):
            raise ValueError(f"Asset-pack manifest does not target iOS+macOS: {pack}")
        selectors = manifest.get("fileSelectors", [])
        if len(selectors) != 1 or "file" not in selectors[0]:
            raise ValueError(f"Asset-pack manifest selects no payload file: {pack}")
        payload = manifest_path.parent / selectors[0]["file"]
        if not payload.is_file() or digest(payload) != book["sha256"]:
            raise ValueError(f"Missing or mismatched asset-pack payload: {pack}")
        payload_name = Path(selectors[0]["file"]).name
        with tempfile.TemporaryDirectory() as work:
            archived = extract(archive_path, payload_name, Path(work))
            if digest(archived) != book["sha256"]:
                raise ValueError(f"Missing or mismatched archived payload in {archive_path}")
            verify_book_audio(archived.read_bytes(), catalog, book)
        # Same bytes staged for the app-v* release; iOS < 26 runtimes fetch them
        # over HTTPS into the extraction cache (PadDeliveryService fallback).
        staged = payload_dir / payload_name
        if not staged.is_file() or digest(staged) != book["sha256"]:
            raise ValueError(f"Missing or mismatched release payload: {staged}")
    verify_perushim_pack(asset_pack_dir, archive_dir, payload_dir)


def verify_perushim_pack(asset_pack_dir, archive_dir, payload_dir):
    """The notes pack carries both payloads the managed-delivery contract requires."""
    pack = "perushim-notes"
    manifest_path = asset_pack_dir / pack / "Manifest.json"
    if not manifest_path.is_file():
        raise ValueError(f"Missing asset-pack manifest: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("assetPackID") != pack or "onDemand" not in manifest.get("downloadPolicy", {}):
        raise ValueError(f"Malformed asset-pack manifest: {pack}")
    if not {"iOS", "macOS"}.issubset(manifest.get("platforms", [])):
        raise ValueError(f"Asset-pack manifest does not target iOS+macOS: {pack}")
    expected = {"sefaria-dump-5784-sivan-4.perushim_notes.sqlite",
                "sefaria-dump-5784-sivan-4.hebrew_search.sqlite"}
    selector_names = {Path(selector.get("file", "")).name
                      for selector in manifest.get("fileSelectors", [])}
    if selector_names != expected:
        raise ValueError(
            f"Asset-pack manifest must select the notes and search-index payloads: {sorted(selector_names)}")
    for name in sorted(selector_names):
        if not (manifest_path.parent / name).is_file():
            raise ValueError(f"Missing asset-pack payload: {pack}/{name}")
        if not (payload_dir / name).is_file():
            raise ValueError(f"Missing release payload: {name}")
    archive_path = archive_dir / f"{pack}.aar"
    if not archive_path.is_file() or archive_path.stat().st_size == 0:
        raise ValueError(f"Missing asset-pack archive: {archive_path}")



def verify_windows(archive, catalog, names):
    for book in catalog["books"]:
        filename = f'recitation_{book["seferId"]}.zip'
        entries = [name for name in names if Path(name).name == filename]
        if len(entries) != 1 or hashlib.sha256(archive.read(entries[0])).hexdigest() != book["sha256"]:
            raise ValueError(f"Missing or mismatched Windows book archive: {filename}")
        verify_book_audio(archive.read(entries[0]), catalog, book)


def verify_book_audio(payload, catalog, book):
    """The signed pack must contain the selected audio, not merely a matching ZIP."""
    tracks = [track for track in catalog["package"]["tracks"] if track["perekId"] in book["perekIds"]]
    if {track["perekId"] for track in tracks} != set(book["perekIds"]):
        raise ValueError("Book references missing catalog recordings")
    expected = {}
    for track in tracks:
        playback = track.get("playback")
        if playback:
            if (playback["format"] != "ogg-opus" or playback["bitrate"] != 24000
                    or playback["sourceSha256"] != track["audioSha256"]):
                raise ValueError("Playback lost its original source identity")
            sha, extension = playback["sha256"], ".ogg"
        else:
            sha, extension = track["audioSha256"], ".mp3"
        expected[sha + extension] = (sha, playback)
    with zipfile.ZipFile(BytesIO(payload)) as audio:
        if len(audio.namelist()) != len(expected) or set(audio.namelist()) != set(expected):
            raise ValueError("Unexpected or missing audio in signed book pack")
        for filename, (sha, playback) in expected.items():
            content = audio.read(filename)
            if (hashlib.sha256(content).hexdigest() != sha
                    or (playback and (len(content) != playback["sizeBytes"] or not content.startswith(b"OggS")))):
                raise ValueError("Signed book audio checksum or format mismatch")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--platform", choices=["Android", "iOS", "Windows"], required=True)
    parser.add_argument("--asset-pack-dir", type=Path,
                        help="iOS: Platforms/iOS/AssetPacks source directory (manifests + payloads)")
    parser.add_argument("--archive-dir", type=Path,
                        help="iOS: directory holding the .aar archives produced by xcrun ba-package")
    parser.add_argument("--payload-dir", type=Path,
                        help="iOS: directory of raw payloads staged for release-asset delivery below iOS 26")
    args = parser.parse_args()
    verify(args.package, args.catalog, args.platform, args.asset_pack_dir,
           args.archive_dir, args.payload_dir)
