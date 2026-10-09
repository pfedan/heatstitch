"""Card pictures for the videos: the stage of a poster, cut to 4:3, small enough for a card.

The poster (`<key>.jpg`, 1920 x 1080) shows the whole app; on a card that is a strip of tiny panels
around a small design. The card picture keeps only the stage, where the design is, and is about a
tenth of the size. It lies with the site as `public/guide/videos/<key>.webp`; the guide and the
video page fall back to the poster on R2 where it is missing.

    python3 tools/screencast/karte.py <key>.jpg [...] --out public/guide/videos
"""

import argparse
import pathlib

import numpy as np
from PIL import Image

# Panels are light, the stage is dark. Below the stage sit the player and the hint line.
LIGHT = 200
HEADER, FOOTER = 48, 985
SIZE = (640, 480)


def stage(gray: np.ndarray) -> tuple[int, int]:
    """Left and right edge of the stage: between the light panels at the sides (Prüfen has none on the left)."""
    med = np.median(gray[HEADER + 20 : FOOTER - 20], axis=0)
    l, r = 0, gray.shape[1]
    while l < r and med[l] > LIGHT:
        l += 1
    while r > l and med[r - 1] > LIGHT:
        r -= 1
    # No dark stage at all (the printed sheet of part 10): the whole frame.
    return (0, gray.shape[1]) if r - l < gray.shape[1] // 4 else (l, r)


def card(poster: Image.Image) -> Image.Image:
    """A 4:3 cut of the stage, as large as fits, centred on the design (what is not the stage's background)."""
    rgb = np.asarray(poster.convert('RGB').resize((1920, 1080)), dtype=np.int16)
    gray = rgb.mean(axis=2)
    l, r = stage(gray)
    t, b = HEADER, FOOTER
    area = rgb[t:b, l:r].reshape(-1, 3)
    colors, counts = np.unique(area // 8, axis=0, return_counts=True)
    bg = colors[counts.argmax()] * 8 + 4
    ys, xs = np.nonzero(np.abs(rgb[t:b, l:r] - bg).sum(axis=2) > 90)
    cx = l + (xs.min() + xs.max()) / 2 if len(xs) else (l + r) / 2
    cy = t + (ys.min() + ys.max()) / 2 if len(ys) else (t + b) / 2
    w = min(r - l, (b - t) * 4 / 3)
    h = w * 3 / 4
    x0 = min(max(cx - w / 2, l), r - w)
    y0 = min(max(cy - h / 2, t), b - h)
    box = tuple(round(v) for v in (x0, y0, x0 + w, y0 + h))
    return Image.fromarray(rgb.astype(np.uint8)).crop(box).resize(SIZE, Image.LANCZOS)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('posters', nargs='+')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for p in map(pathlib.Path, args.posters):
        target = out / f'{p.stem}.webp'
        card(Image.open(p)).save(target, 'WEBP', quality=76, method=6)
        print(target, target.stat().st_size // 1024, 'KB')


if __name__ == '__main__':
    main()
