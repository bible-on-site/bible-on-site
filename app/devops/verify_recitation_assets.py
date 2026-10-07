"""Reject native release artifacts with missing, stale, or base-bundled mobile audio."""

import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import zipfile


def verify(package, catalog_path, platform):
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    with zipfile.ZipFile(package) as archive:
        names = archive.namelist()
        catalogs = [n for n in names if n.endswith("/recitation-catalog.json")]
        if len(catalogs) != 1 or json.loads(archive.read(catalogs[0])) != catalog:
            raise ValueError("Native release lacks its matching recitation catalog")
        if platform == "Android":
            for book in catalog["books"]:
                pack = f'recitation_{book["seferId"]}'
                name = f"{pack}/assets/{pack}.zip"
                if name not in names or hashlib.sha256(archive.read(name)).hexdigest() != book["sha256"]:
                    raise ValueError(f"Missing or mismatched PAD book module: {pack}")
                if f"{pack}/manifest/AndroidManifest.xml" not in names:
                    raise ValueError(f"Missing PAD manifest: {pack}")
            if any(n.startswith("base/") and Path(n).name.startswith("recitation_") and n.endswith(".zip") for n in names):
                raise ValueError("On-demand recordings were included in the Android base installation")
        elif platform == "iOS":
            metadata = [plistlib.loads(archive.read(n)) for n in names if n.endswith("/OnDemandResources.plist")]
            if len(metadata) != 1:
                raise ValueError("Missing Apple ODR manifest")
            tags = metadata[0].get("NSBundleResourceRequestTags", {})
            resources = metadata[0].get("NSBundleResourceRequestAssetPacks", {})
            payloads = {}
            for name in names:
                if name.endswith(".assetpack/Info.plist"):
                    info = plistlib.loads(archive.read(name))
                    payloads[info["CFBundleIdentifier"]] = (name.rsplit("/", 1)[0] + "/Assets.car", info.get("Tags", []))
            for book in catalog["books"]:
                pack = f'recitation_{book["seferId"]}'
                if pack not in tags:
                    raise ValueError(f"Missing Apple ODR book tag: {pack}")
                identifiers = tags[pack].get("NSAssetPacks", [])
                if not identifiers:
                    raise ValueError(f"Apple ODR tag has no resource references: {pack}")
                for identifier in identifiers:
                    path, declared_tags = payloads.get(identifier, ("", []))
                    if ("Assets.car" not in resources.get(identifier, []) or pack not in declared_tags
                            or path not in names or archive.getinfo(path).file_size == 0):
                        raise ValueError(f"Missing compiled ODR audio payload: {pack}")
    print(f'Verified {len(catalog["books"])} {platform} recitation packs in {package.name}')


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--platform", choices=["Android", "iOS"], required=True)
    args = parser.parse_args()
    verify(args.package, args.catalog, args.platform)
