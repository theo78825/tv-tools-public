#!/usr/bin/env python3
"""Write the Homebrew Channel manifest for a built IPK, next to it.

    tools/manifest.py dist/io.github.theo78825.tvtools_1.0.0_all.ipk

Does what webosbrew-toolbox-gen-manifest does. Upload the IPK and the
<app-id>.manifest.json together to one GitHub release: ipkUrl is relative, so
releases/latest/download/<app-id>.manifest.json always finds the newest IPK.
The hash and size describe one exact IPK, so run this for every release.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

REPO = "https://github.com/theo78825/tv-tools-public"
RAW = "https://raw.githubusercontent.com/theo78825/tv-tools-public/main"
ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    ipk = Path(sys.argv[1])
    info = json.loads((ROOT / "app" / "appinfo.json").read_text())
    app_id = info["id"]
    data = ipk.read_bytes()
    manifest = {
        "id": info["id"],
        "version": info["version"],
        "type": info["type"],
        "title": info["title"],
        "iconUri": f"{RAW}/app/largeIcon.png",
        "sourceUrl": REPO,
        "rootRequired": True,
        "ipkUrl": ipk.name,
        "ipkSize": len(data),
        "ipkHash": {"sha256": hashlib.sha256(data).hexdigest()},
    }
    out = ipk.parent / f"{app_id}.manifest.json"
    out.write_text(json.dumps(manifest, indent=2) + "\n")
    print(out)


if __name__ == "__main__":
    main()
