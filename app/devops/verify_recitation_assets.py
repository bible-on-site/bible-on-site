"""Reject native release artifacts with missing, stale, or base-bundled mobile audio."""

import argparse
import hashlib
import json
from pathlib import Path
import zipfile


def digest(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def verify(package, catalog_path, platform, asset_pack_dir=None, archive_dir=None):
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    with zipfile.ZipFile(package) as archive:
        names = archive.namelist()
        catalogs = [n for n in names if Path(n).name == "recitation-catalog.json"]
        if len(catalogs) != 1 or json.loads(archive.read(catalogs[0])) != catalog:
            raise ValueError("Native release lacks its matching recitation catalog")
        if platform == "Android":
            verify_android(archive, catalog, names)
        elif platform == "iOS":
            verify_apple(archive, catalog, names, asset_pack_dir, archive_dir)
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
    if any(n.startswith("base/") and Path(n).name.startswith("recitation_") and n.endswith(".zip") for n in names):
        raise ValueError("On-demand recordings were included in the Android base installation")


def verify_apple(archive, catalog, names, asset_pack_dir, archive_dir):
    """iOS packs ship as Apple-hosted .aar archives beside the IPA, never inside it."""
    if any(Path(n).name == "OnDemandResources.plist" for n in names):
        raise ValueError("IPA still contains an On-Demand Resources manifest")
    if any(".assetpack/" in n or n.startswith("Payload/OnDemandResources/") for n in names):
        raise ValueError("IPA still contains ODR asset packs")
    if any(Path(n).name.startswith("recitation_") and n.endswith(".zip") for n in names):
        raise ValueError("On-demand recordings were included in the iOS base installation")
    appex = [n for n in names if "/Extensions/AssetPackDownloader.appex/" in n
             and Path(n).name not in ("Info.plist",)]
    if not appex:
        raise ValueError("IPA lacks the managed asset-pack downloader extension")
    if asset_pack_dir is None or archive_dir is None:
        raise ValueError("iOS verification requires --asset-pack-dir and --archive-dir")
    for book in catalog["books"]:
        pack = f'recitation_{book["seferId"]}'
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


def verify_windows(archive, catalog, names):
    for book in catalog["books"]:
        filename = f'recitation_{book["seferId"]}.zip'
        entries = [name for name in names if Path(name).name == filename]
        if len(entries) != 1 or hashlib.sha256(archive.read(entries[0])).hexdigest() != book["sha256"]:
            raise ValueError(f"Missing or mismatched Windows book archive: {filename}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--platform", choices=["Android", "iOS", "Windows"], required=True)
    parser.add_argument("--asset-pack-dir", type=Path,
                        help="iOS: Platforms/iOS/AssetPacks source directory (manifests + payloads)")
    parser.add_argument("--archive-dir", type=Path,
                        help="iOS: directory holding the .aar archives produced by xcrun ba-package")
    args = parser.parse_args()
    verify(args.package, args.catalog, args.platform, args.asset_pack_dir, args.archive_dir)
