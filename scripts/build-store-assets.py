"""
Builds the Chrome Web Store listing images.

Store art is a release artifact, not a build input, so this is deliberately a
separate one-off script rather than part of `npm run build`. It needs Pillow:

    pip install Pillow
    python scripts/build-store-assets.py

Always produced (from icon20.png, no other input needed):
    store/promo-small-440x280.png     the tile shown in search results
    store/promo-marquee-1400x560.png  the wide tile, only used if featured

Produced when you have put captures in store/raw/ (see CAPTIONS below):
    store/screenshot-1-*.png ...      1280x800, the listing's required images

Colours are sampled from the icon master so the listing matches the product.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / "icon20.png"
OUT = ROOT / "store"
RAW = OUT / "raw"

NAVY = (19, 32, 51)
TEAL = (50, 183, 154)
PAPER = (244, 246, 248)
WHITE = (255, 255, 255)

# Each capture in store/raw/ is matched by name; the text is what the reviewer
# and the shopper actually read, so it says what the shot shows, not "feature 1".
CAPTIONS = {
    "job": (
        "Reads the job posting",
        "Paste a LinkedIn link. Skillo pulls the posting and breaks it into the\n"
        "skills, tools and keywords the employer is actually screening for.",
    ),
    "tailor": (
        "You choose how far it goes",
        "Five levels, from a light reorder to a rewrite for this one job — and a\n"
        "page limit it has to respect. It never invents experience at any level.",
    ),
    "review": (
        "See the score before you send",
        "A match score out of 10, ATS keyword coverage, and every edit listed so\n"
        "you can check it against the diff.",
    ),
    "apply": (
        "Writes straight back to Overleaf",
        "One click puts the revision in your project. Ctrl+Z in Overleaf undoes it\n"
        "in a single step if you change your mind.",
    ),
    "settings": (
        "Your key, your model",
        "OpenRouter, OpenAI, Anthropic, or Claude Code running locally. Keys stay\n"
        "on your machine and are never synced.",
    ),
}


def font(size, bold=True):
    """Segoe UI is what the extension itself uses; fall back on other platforms."""
    candidates = (
        ["C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/segoeui.ttf"]
        if bold
        else ["C:/Windows/Fonts/segoeui.ttf"]
    )
    candidates += [
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def rounded_icon(size, radius_fraction=0.18):
    """The icon master with its corners rounded, at any size."""
    master = Image.open(MASTER).convert("RGBA")
    mask = Image.new("L", master.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, master.size[0] - 1, master.size[1] - 1],
        radius=int(master.size[0] * radius_fraction),
        fill=255,
    )
    master.putalpha(mask)
    return master.resize((size, size), Image.LANCZOS)


def drop_shadow(image, blur=18, offset=(0, 10), opacity=70):
    """A soft shadow layer sized to hold the blur, plus where to paste it."""
    pad = blur * 3
    shadow = Image.new("RGBA", (image.width + pad * 2, image.height + pad * 2), (0, 0, 0, 0))
    block = Image.new("RGBA", image.size, (0, 0, 0, opacity))
    shadow.paste(block, (pad + offset[0], pad + offset[1]), image)
    return shadow.filter(ImageFilter.GaussianBlur(blur)), pad


def promo(width, height, icon_size, title_size, sub_size, gap, sub_lines, bars, path):
    """The promo tiles: mark, name, and one line saying what it does."""
    tile = Image.new("RGBA", (width, height), NAVY + (255,))
    draw = ImageDraw.Draw(tile)

    icon = rounded_icon(icon_size)
    icon_x = int(width * 0.075)
    tile.paste(icon, (icon_x, (height - icon_size) // 2), icon)

    title_font = font(title_size)
    sub_font = font(sub_size, bold=False)
    text_x = icon_x + icon_size + gap
    right_edge = width - int(width * 0.055)

    title = "Skillo"
    t_h = draw.textbbox((0, 0), title, font=title_font)[3]
    line_h = draw.textbbox((0, 0), "Hg", font=sub_font)[3] + sub_size // 4
    block_h = t_h + sub_size // 2 + line_h * len(sub_lines)
    top = (height - block_h) // 2

    draw.text((text_x, top), title, font=title_font, fill=WHITE)
    for i, line in enumerate(sub_lines):
        draw.text((text_x, top + t_h + sub_size // 2 + i * line_h), line, font=sub_font, fill=TEAL)

    # A teal rule bleeding off the right edge, echoing the icon's bullets. Only
    # on the wide tile; on the small one there is no room that the text is not
    # already using.
    if bars:
        bar_h = max(3, height // 90)
        widest = max(draw.textbbox((0, 0), line, font=sub_font)[2] for line in sub_lines)
        bar_left = max(text_x + widest + gap, width - width // 6)
        for i in range(3):
            y = height // 2 - bar_h * 4 + i * bar_h * 4
            draw.rounded_rectangle(
                [bar_left, y, width + 10, y + bar_h], radius=bar_h // 2, fill=TEAL + (110,)
            )

    for line in sub_lines:
        if text_x + draw.textbbox((0, 0), line, font=sub_font)[2] > right_edge:
            raise SystemExit(f"tagline '{line}' does not fit in {width}x{height}")

    tile.convert("RGB").save(path)
    print(f"wrote {path.relative_to(ROOT)}  ({width}x{height})")


def screenshot(capture_path, headline, body, index, path):
    """Caption on the left, the panel capture on the right, on brand paper."""
    canvas = Image.new("RGBA", (1280, 800), PAPER + (255,))
    draw = ImageDraw.Draw(canvas)

    capture = Image.open(capture_path).convert("RGBA")
    # The side panel is tall and narrow; fit it to the canvas height.
    max_h = 680
    scale = min(max_h / capture.height, 560 / capture.width)
    capture = capture.resize(
        (max(1, int(capture.width * scale)), max(1, int(capture.height * scale))),
        Image.LANCZOS,
    )

    rounded = Image.new("L", capture.size, 0)
    ImageDraw.Draw(rounded).rounded_rectangle(
        [0, 0, capture.width - 1, capture.height - 1], radius=14, fill=255
    )
    capture.putalpha(rounded)

    shot_x = 1280 - capture.width - 90
    shot_y = (800 - capture.height) // 2
    shadow, pad = drop_shadow(capture)
    canvas.alpha_composite(shadow, (shot_x - pad, shot_y - pad))
    canvas.alpha_composite(capture, (shot_x, shot_y))

    head_font = font(52)
    body_font = font(24, bold=False)
    label_font = font(20)

    draw.text((90, 250), f"{index:02d}", font=label_font, fill=TEAL)
    draw.text((90, 290), headline, font=head_font, fill=NAVY)
    draw.multiline_text((90, 380), body, font=body_font, fill=(90, 100, 115), spacing=10)

    canvas.convert("RGB").save(path)
    print(f"wrote {path.relative_to(ROOT)}  (1280x800)")


def main():
    OUT.mkdir(exist_ok=True)
    RAW.mkdir(exist_ok=True)

    promo(
        440, 280, 118, 46, 17, 26,
        ["Tailor your Overleaf", "resume to the job"], False,
        OUT / "promo-small-440x280.png",
    )
    promo(
        1400, 560, 300, 150, 46, 90,
        ["Tailor your Overleaf resume to the job"], True,
        OUT / "promo-marquee-1400x560.png",
    )
    rounded_icon(128).convert("RGB").save(OUT / "icon-128.png")
    print(f"wrote {(OUT / 'icon-128.png').relative_to(ROOT)}  (128x128)")

    found = 0
    for index, (name, (headline, body)) in enumerate(CAPTIONS.items(), start=1):
        matches = sorted(RAW.glob(f"{name}.*"))
        if not matches:
            continue
        screenshot(matches[0], headline, body, index, OUT / f"screenshot-{index}-{name}.png")
        found += 1

    if found == 0:
        print(
            "\nNo captures found in store/raw/. Save a PNG of the side panel as"
            "\n  " + ", ".join(f"{n}.png" for n in CAPTIONS) + "\nthen run this again."
        )


if __name__ == "__main__":
    main()
