#!/usr/bin/env python3
"""Draw the app icons (80x80 icon.png and 130x130 largeIcon.png).

TV Tools (app/) uses assets/avatar.png.

assets/avatar.png is theo78825's GitHub profile picture. To refresh it:
    curl -sSL "$(gh api user --jq .avatar_url)&s=460" -o assets/avatar.png
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
SRC = ROOT / "assets" / "avatar.png"
S = 1024  # work large, downsample for smooth edges


def draw() -> Image.Image:
    avatar = Image.open(SRC).convert("RGBA").resize((S, S), Image.LANCZOS)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=220, fill=255)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img.paste(avatar, (0, 0), mask)
    return img


def main() -> None:
    img = draw()
    for name, size in (("icon.png", 80), ("largeIcon.png", 130)):
        img.resize((size, size), Image.LANCZOS).save(APP / name)
        print("wrote", APP / name)


if __name__ == "__main__":
    main()
