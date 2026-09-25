#!/usr/bin/env python3
"""Package TV Tools (app/ plus service/) into a webOS IPK, the same layout
ares-package produces.

Writes dist/<app-id>_<version>_all.ipk. Pure Python so macOS tar/ar quirks
(AppleDouble ._ files, BSD ar headers) can't end up in the package.
"""
from __future__ import annotations

import gzip
import io
import json
import sys
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP_DIR = ROOT / "app"
SVC_DIR = ROOT / "service"
DIST = ROOT / "dist"

appinfo = json.loads((APP_DIR / "appinfo.json").read_text())
APP_ID = appinfo["id"]
VERSION = appinfo["version"]
SVC_ID = json.loads((SVC_DIR / "services.json").read_text())["id"]
MTIME = int(time.time())


def tar_gz(entries: list[tuple[str, bytes | None, int]]) -> bytes:
    """entries: (path, data or None for a directory, mode)."""
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.GNU_FORMAT) as tar:
        for name, data, mode in entries:
            info = tarfile.TarInfo(name)
            info.mtime = MTIME
            info.uid = info.gid = 0
            info.uname = info.gname = "root"
            info.mode = mode
            if data is None:
                info.type = tarfile.DIRTYPE
                tar.addfile(info)
            else:
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
    return gzip.compress(raw.getvalue(), mtime=MTIME)


def tree(src: Path, dest: str) -> list[tuple[str, bytes | None, int]]:
    out = [(f"./{dest}/", None, 0o755)]
    for p in sorted(src.rglob("*")):
        if p.name.startswith(".") or p.name == "__pycache__":
            continue
        rel = f"./{dest}/{p.relative_to(src).as_posix()}"
        if p.is_dir():
            out.append((rel + "/", None, 0o755))
        else:
            mode = 0o755 if p.suffix == ".sh" else 0o644
            out.append((rel, p.read_bytes(), mode))
    return out


def dirs(*paths: str) -> list[tuple[str, bytes | None, int]]:
    return [(f"./{p}/", None, 0o755) for p in paths]


def ar(members: list[tuple[str, bytes]]) -> bytes:
    out = bytearray(b"!<arch>\n")
    for name, data in members:
        header = (
            f"{name:<16}{MTIME:<12}{0:<6}{0:<6}{0o100644:<8o}{len(data):<10}`\n"
        ).encode()
        assert len(header) == 60
        out += header + data
        if len(data) % 2:
            out += b"\n"
    return bytes(out)


def main() -> None:
    packageinfo = {
        "app": APP_ID,
        "id": APP_ID,
        "loc_name": appinfo["title"],
        "package_format_version": 2,
        "vendor": appinfo["vendor"],
        "version": VERSION,
    }
    packageinfo["services"] = [SVC_ID]
    data_entries = (
        dirs("usr", "usr/palm", "usr/palm/applications", "usr/palm/services",
             "usr/palm/packages", f"usr/palm/packages/{APP_ID}")
        + tree(APP_DIR, f"usr/palm/applications/{APP_ID}")
        + tree(SVC_DIR, f"usr/palm/services/{SVC_ID}")
        + [(f"./usr/palm/packages/{APP_ID}/packageinfo.json",
            json.dumps(packageinfo, indent=2).encode(), 0o644)]
    )
    data = tar_gz(data_entries)
    installed_kb = sum(len(d) for _, d, _ in data_entries if d) // 1024 + 1

    control = (
        f"Package: {APP_ID}\n"
        f"Version: {VERSION}\n"
        "Section: misc\n"
        "Priority: optional\n"
        "Architecture: all\n"
        f"Installed-Size: {installed_kb}\n"
        f"Maintainer: {appinfo['vendor']}\n"
        f"Description: {appinfo['title']}\n"
        "webOS-Package-Format-Version: 2\n"
        "webOS-Packager-Version: x.y.x\n"
    ).encode()
    control_tgz = tar_gz([("./", None, 0o755), ("./control", control, 0o644)])

    DIST.mkdir(exist_ok=True)
    out = DIST / f"{APP_ID}_{VERSION}_all.ipk"
    out.write_bytes(ar([
        ("debian-binary", b"2.0\n"),
        ("control.tar.gz", control_tgz),
        ("data.tar.gz", data),
    ]))
    print(out)


if __name__ == "__main__":
    main()
