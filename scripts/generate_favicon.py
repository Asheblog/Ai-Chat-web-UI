"""Generate AIChat favicon assets: ICO, PNGs, and SVG source.

Design: blue rounded-square background, white chat bubble with "AI" mark.
Deterministic, no remote resources, no runtime deps beyond Pillow.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Tuple

from PIL import Image, ImageDraw, ImageFont

# --- Design tokens ---
PRIMARY = (37, 99, 235)  # #2563EB
WHITE = (255, 255, 255)

# Output directory (frontend public/)
OUT_DIR = Path(__file__).resolve().parent.parent / "packages" / "frontend" / "public"

# Sizes to generate as standalone PNGs
PNG_SIZES: dict[str, Tuple[int, int]] = {
    "favicon-16x16.png": (16, 16),
    "favicon-32x32.png": (32, 32),
    "apple-touch-icon.png": (180, 180),
    "icon-192.png": (192, 192),
    "icon-512.png": (512, 512),
}

def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Load the best available bold sans-serif font at *size* px."""
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        "/usr/share/fonts/truetype/ubuntu/UbuntuSans-Bold.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    # Absolute fallback -- tiny but always available
    return ImageFont.load_default()


def draw_icon(size: int) -> Image.Image:
    """Return a RGBA Pillow image of the AIChat icon at *size*x*size*."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    S = size  # shorthand

    # -- Blue rounded-square background --
    # Keep corner radius conservative so small sizes still have enough fill.
    pad = max(1, int(S * 0.07))
    radius = max(1, int(S * 0.16))
    draw.rounded_rectangle(
        [pad, pad, S - pad, S - pad],
        radius=radius,
        fill=PRIMARY,
    )

    # -- White speech bubble --
    bubble_w = int(S * 0.54)
    bubble_h = int(S * 0.40)
    bubble_cx = S // 2
    bubble_cy = int(S * 0.44)

    bx0 = bubble_cx - bubble_w // 2
    by0 = bubble_cy - bubble_h // 2
    bx1 = bubble_cx + bubble_w // 2
    by1 = bubble_cy + bubble_h // 2

    bubble_r = max(1, int(bubble_h * 0.35))
    draw.rounded_rectangle([bx0, by0, bx1, by1], radius=bubble_r, fill=WHITE)

    # Bubble tail (small triangle pointing down-right from bottom edge)
    tail_base_left = bx1 - int(bubble_w * 0.28)
    tail_base_right = bx1 - int(bubble_w * 0.03)
    tail_tip_x = tail_base_right + int(bubble_w * 0.08)
    tail_tip_y = by1 + int(bubble_h * 0.22)
    draw.polygon(
        [(tail_base_left, by1), (tail_base_right, by1), (tail_tip_x, tail_tip_y)],
        fill=WHITE,
    )

    # -- "AI" lettering (only at 48 px and above -- unreadable below) --
    if S >= 48:
        font_size = int(S * 0.22)
        font = _load_font(font_size)
        text = "AI"
        bbox = draw.textbbox((0, 0), text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = bubble_cx - tw // 2
        ty = bubble_cy - th // 2 - int(S * 0.015)
        draw.text((tx, ty), text, fill=PRIMARY, font=font)

    return img


SVG_SIZE = 512  # viewBox size for the SVG source icon


def _svg_coords() -> dict:
    """Return SVG coordinates computed with the same proportions as draw_icon."""
    S = SVG_SIZE
    pad = max(1, int(S * 0.07))
    radius = max(1, int(S * 0.16))

    bubble_w = int(S * 0.54)
    bubble_h = int(S * 0.40)
    bubble_cx = S // 2
    bubble_cy = int(S * 0.44)

    bx0 = bubble_cx - bubble_w // 2
    by0 = bubble_cy - bubble_h // 2
    bx1 = bubble_cx + bubble_w // 2
    by1 = bubble_cy + bubble_h // 2

    bubble_r = max(1, int(bubble_h * 0.35))

    tail_base_left = bx1 - int(bubble_w * 0.28)
    tail_base_right = bx1 - int(bubble_w * 0.03)
    tail_tip_x = tail_base_right + int(bubble_w * 0.08)
    tail_tip_y = by1 + int(bubble_h * 0.22)

    font_size = int(S * 0.22)

    return {
        "bg_x": pad, "bg_y": pad,
        "bg_w": S - 2 * pad, "bg_h": S - 2 * pad, "bg_r": radius,
        "b_x": bx0, "b_y": by0, "b_w": bubble_w, "b_h": bubble_h, "b_r": bubble_r,
        "tail_p1": f"{tail_base_left},{by1}",
        "tail_p2": f"{tail_base_right},{by1}",
        "tail_p3": f"{tail_tip_x},{tail_tip_y}",
        "text_x": bubble_cx, "text_y": bubble_cy,
        "font_size": font_size,
    }


def write_svg(path: str) -> None:
    """Write site-icon.svg using the same design proportions as draw_icon."""
    c = _svg_coords()
    svg = f"""\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SVG_SIZE} {SVG_SIZE}">
  <rect x="{c['bg_x']}" y="{c['bg_y']}" width="{c['bg_w']}" height="{c['bg_h']}" rx="{c['bg_r']}" ry="{c['bg_r']}" fill="#2563EB"/>
  <rect x="{c['b_x']}" y="{c['b_y']}" width="{c['b_w']}" height="{c['b_h']}" rx="{c['b_r']}" ry="{c['b_r']}" fill="#FFFFFF"/>
  <polygon points="{c['tail_p1']} {c['tail_p2']} {c['tail_p3']}" fill="#FFFFFF"/>
  <text x="{c['text_x']}" y="{c['text_y']}" font-family="'DejaVu Sans', 'Liberation Sans', Arial, sans-serif" font-size="{c['font_size']}" font-weight="bold" fill="#2563EB" text-anchor="middle" dominant-baseline="central">AI</text>
</svg>
"""
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(svg)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    print("Generating AIChat favicon assets ...")

    # 1. Standalone PNGs
    for fname, wh in PNG_SIZES.items():
        img = draw_icon(wh[0])
        path = OUT_DIR / fname
        img.save(path, format="PNG")
        print(f"  {fname}  {img.size}")

    # 2. SVG source icon
    svg_path = OUT_DIR / "site-icon.svg"
    write_svg(str(svg_path))
    print(f"  site-icon.svg  viewBox=0 0 {SVG_SIZE} {SVG_SIZE}")

    # 3. Multi-resolution ICO
    # Render at 256 px and let Pillow scale down -- avoids duplicate entries
    # that append_images can create.  At 16/32 px the scaled-down "AI" text
    # becomes sub-pixel and invisible; at >=48 px it remains readable.
    img256 = draw_icon(256)
    ico_path = OUT_DIR / "favicon.ico"
    ico_png_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img256.save(ico_path, format="ICO", sizes=ico_png_sizes)
    print(f"  favicon.ico  sizes={ico_png_sizes}")

    # 4. Verify the ICO
    verify = Image.open(ico_path)
    embedded = sorted(verify.info.get("sizes", set()))
    expected = sorted(set(ico_png_sizes))
    if embedded == expected:
        print(f"  ICO verification OK -- embedded sizes: {embedded}")
    else:
        print(f"  ICO verification MISMATCH: expected {expected}, got {embedded}")
        sys.exit(1)

    # 5. Quick file(1)-style sanity check
    for fname in list(PNG_SIZES) + ["site-icon.svg", "favicon.ico"]:
        path = OUT_DIR / fname
        st = os.stat(path)
        print(f"  {fname}: {st.st_size} bytes")

    print("Done.")


if __name__ == "__main__":
    main()
