#!/usr/bin/env python3
"""Build the desktop icon set from icon.svg.

icon.svg (1024 grid) is the only maintained source. The script rasterises it at
exact pixel sizes with a headless Chromium browser, then packs the platform
containers and validates both:

  icon.png   1024x1024 RGBA
  icon.ico   16 / 24 / 32 / 48 / 64 / 128 / 256 (PNG entries)
  icon.icns  icp4..icp6 and ic07..ic14 (16 / 32 / 64 / 128 / 256 / 512 / 1024)

Usage:
  python make-icons.py
  python make-icons.py --preview DIR   # also write exact-size PNG proofs

Requirements: Pillow, and Microsoft Edge / Google Chrome / Chromium.
Override browser discovery with ICON_RENDERER=/path/to/browser.
"""

from __future__ import annotations

import argparse
import io
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "icon.svg"

ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
ICNS_CHUNKS = (
    (b"icp4", 16),
    (b"icp5", 32),
    (b"icp6", 64),
    (b"ic07", 128),
    (b"ic08", 256),
    (b"ic09", 512),
    (b"ic10", 1024),
    (b"ic11", 32),
    (b"ic12", 64),
    (b"ic13", 256),
    (b"ic14", 512),
)
RENDER_SIZES = sorted({size for _, size in ICNS_CHUNKS} | set(ICO_SIZES) | {1024})
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def browser_candidates():
    override = os.environ.get("ICON_RENDERER")
    if override:
        yield override
    if sys.platform == "win32":
        for root in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles")):
            if root:
                yield str(Path(root) / "Microsoft/Edge/Application/msedge.exe")
                yield str(Path(root) / "Google/Chrome/Application/chrome.exe")
    elif sys.platform == "darwin":
        yield "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        yield "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
        yield "/Applications/Chromium.app/Contents/MacOS/Chromium"
    for name in ("chromium", "chromium-browser", "google-chrome", "microsoft-edge"):
        found = shutil.which(name)
        if found:
            yield found


def rasterise(svg: str, size: int, browser: str, workdir: Path) -> Image.Image:
    sized = re.sub(r'\bwidth="\d+"', f'width="{size}"', svg, count=1)
    sized = re.sub(r'\bheight="\d+"', f'height="{size}"', sized, count=1)
    svg_path = workdir / f"source-{size}.svg"
    svg_path.write_text(sized, encoding="utf-8")
    shot = workdir / f"render-{size}.png"
    profile = workdir / f"profile-{size}"
    command = [
        browser,
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--default-background-color=00000000",
        f"--window-size={size},{size}",
        f"--user-data-dir={profile}",
        f"--screenshot={shot}",
        svg_path.as_uri(),
    ]
    subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    deadline = time.time() + 30
    while time.time() < deadline:
        if shot.exists() and shot.stat().st_size:
            try:
                image = Image.open(shot).convert("RGBA")
            except OSError:
                time.sleep(0.2)
                continue
            if image.size != (size, size):
                raise RuntimeError(f"renderer returned {image.size} for requested {size}x{size}")
            return image
        time.sleep(0.2)
    raise RuntimeError(f"no screenshot produced for {size}x{size} with {browser}")


def pick_browser(svg: str, workdir: Path) -> str:
    tried = []
    for candidate in browser_candidates():
        if not candidate or not Path(candidate).exists():
            continue
        tried.append(candidate)
        try:
            rasterise(svg, 16, candidate, workdir)
            return candidate
        except (RuntimeError, subprocess.SubprocessError, OSError):
            continue
    raise SystemExit(
        "No working Chromium renderer found. Tried: "
        + (", ".join(tried) if tried else "none")
        + ". Set ICON_RENDERER to the browser executable."
    )


def pack_icns(images: dict[int, Image.Image]) -> bytes:
    encoded = {}
    for size in {size for _, size in ICNS_CHUNKS}:
        buffer = io.BytesIO()
        images[size].save(buffer, format="PNG", optimize=True)
        encoded[size] = buffer.getvalue()
    body = bytearray()
    for ostype, size in ICNS_CHUNKS:
        payload = encoded[size]
        body += ostype + struct.pack(">I", len(payload) + 8) + payload
    return b"icns" + struct.pack(">I", len(body) + 8) + bytes(body)


def validate_ico(data: bytes) -> list[tuple[int, int]]:
    reserved, kind, count = struct.unpack_from("<HHH", data, 0)
    if reserved != 0 or kind != 1:
        raise ValueError("not an ICO container")
    entries = []
    for index in range(count):
        width, height, _colors, _reserved, _planes, _bpp, length, offset = struct.unpack_from(
            "<BBBBHHII", data, 6 + index * 16
        )
        width = width or 256
        height = height or 256
        payload = data[offset : offset + length]
        if payload[:8] != PNG_SIGNATURE and payload[:4] != b"\x00\x00\x01\x00":
            raise ValueError(f"ICO entry {index} has an unknown payload")
        entries.append((width, height))
    return sorted(entries)


def validate_icns(data: bytes) -> list[tuple[str, int, int]]:
    if data[:4] != b"icns":
        raise ValueError("not an ICNS container")
    declared = struct.unpack_from(">I", data, 4)[0]
    if declared != len(data):
        raise ValueError("ICNS length header does not match file size")
    chunks = []
    offset = 8
    while offset < len(data):
        ostype = data[offset : offset + 4]
        length = struct.unpack_from(">I", data, offset + 4)[0]
        payload = data[offset + 8 : offset + length]
        if payload[:8] != PNG_SIGNATURE:
            raise ValueError(f"ICNS chunk {ostype!r} is not PNG encoded")
        width, height = struct.unpack_from(">II", payload, 16)
        chunks.append((ostype.decode("ascii"), width, height))
        if length < 8:
            raise ValueError("ICNS chunk has an invalid length")
        offset += length
    return chunks


def main() -> None:
    parser = argparse.ArgumentParser(description="Build icon.png / icon.ico / icon.icns from icon.svg")
    parser.add_argument("--preview", metavar="DIR", help="also write exact-size PNG proofs to DIR")
    args = parser.parse_args()

    svg = SOURCE.read_text(encoding="utf-8")
    workdir = Path(tempfile.mkdtemp(prefix="aichat-icon-"))
    try:
        browser = pick_browser(svg, workdir)
        images = {}
        for size in RENDER_SIZES:
            images[size] = rasterise(svg, size, browser, workdir)

        png_path = HERE / "icon.png"
        images[1024].save(png_path, format="PNG", optimize=True)

        ico_path = HERE / "icon.ico"
        images[256].save(
            ico_path,
            format="ICO",
            sizes=[(size, size) for size in ICO_SIZES],
            append_images=[images[size] for size in ICO_SIZES if size != 256],
        )

        icns_path = HERE / "icon.icns"
        icns_bytes = pack_icns(images)
        icns_path.write_bytes(icns_bytes)

        ico_data = ico_path.read_bytes()
        ico_entries = validate_ico(ico_data)
        expected_ico = [(size, size) for size in ICO_SIZES]
        if ico_entries != expected_ico:
            raise ValueError(f"ICO sizes {ico_entries} do not match {expected_ico}")
        icns_chunks = validate_icns(icns_path.read_bytes())
        if len(icns_chunks) != len(ICNS_CHUNKS):
            raise ValueError(f"ICNS has {len(icns_chunks)} chunks, expected {len(ICNS_CHUNKS)}")
        for ostype, width, height in icns_chunks:
            match = next((size for code, size in ICNS_CHUNKS if code.decode("ascii") == ostype), None)
            if (width, height) != (match, match):
                raise ValueError(f"ICNS chunk {ostype} is {width}x{height}, expected {match}")

        if args.preview:
            target = Path(args.preview)
            target.mkdir(parents=True, exist_ok=True)
            for size in RENDER_SIZES:
                images[size].save(target / f"icon-{size}.png")

        print(f"source   {SOURCE}")
        print(f"renderer {browser}")
        print(f"png      {png_path}  {images[1024].size[0]}x{images[1024].size[1]}")
        print(f"ico      {ico_path}  {len(ico_data)} bytes  sizes={' '.join(str(w) for w, _ in ico_entries)}")
        print(f"icns     {icns_path}  {len(icns_bytes)} bytes  chunks={' '.join(t for t, _, _ in icns_chunks)}")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    main()
