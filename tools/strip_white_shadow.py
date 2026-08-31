"""Remove baked pale/white halo shadows from obstacle sprites.
Keeps dark drop shadows and warm object surfaces.
"""
from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "assets" / "sprites"

TARGETS = [
    *SPRITES.glob("wall_concrete_*.png"),
    *SPRITES.glob("obstacles/obs_*.png"),
    *SPRITES.glob("auto/obj_*.png"),
    SPRITES / "crates.png",
    SPRITES / "tires.png",
    SPRITES / "tower.png",
    SPRITES / "sandbags.png",
    SPRITES / "barrels.png",
    SPRITES / "barrier.png",
    SPRITES / "container.png",
    SPRITES / "fence.png",
    SPRITES / "tent.png",
    SPRITES / "rock.png",
    SPRITES / "bush.png",
    SPRITES / "tree.png",
    SPRITES / "red_barrel.png",
    SPRITES / "jeep_small.png",
]


def neighbor_or(mask: np.ndarray) -> np.ndarray:
    out = np.zeros_like(mask, dtype=bool)
    out[1:, :] |= mask[:-1, :]
    out[:-1, :] |= mask[1:, :]
    out[:, 1:] |= mask[:, :-1]
    out[:, :-1] |= mask[:, 1:]
    return out


def dilate(mask: np.ndarray, n: int = 1) -> np.ndarray:
    out = mask.copy()
    for _ in range(n):
        out = out | neighbor_or(out)
    return out


def is_halo_color(r: int, g: int, b: int) -> bool:
    lum = (r + g + b) / 3.0
    if lum < 92:
        return False
    mx = max(r, g, b)
    mn = min(r, g, b)
    sat = (mx - mn) / mx if mx else 0.0
    # Cool bluish-white AI glow (main problem on walls)
    if lum > 110 and b > r + 2 and b >= g - 3:
        return True
    # Soft desaturated pale / under-glow
    if 95 <= lum <= 170 and sat < 0.24 and b >= r - 6:
        return True
    # Bright white rim
    if lum > 155 and sat < 0.18:
        return True
    return False


def strip_halo(arr: np.ndarray) -> int:
    h, w = arr.shape[:2]
    alpha = arr[:, :, 3]
    r = arr[:, :, 0].astype(np.int16)
    g = arr[:, :, 1].astype(np.int16)
    b = arr[:, :, 2].astype(np.int16)
    lum = (r + g + b) / 3.0

    transparent = alpha == 0
    near_t = neighbor_or(transparent)
    dark = (alpha > 0) & (lum < 80)
    near_dark = dilate(dark, 2)

    # Vectorized candidate mask
    mx = np.maximum(np.maximum(r, g), b).astype(np.float32)
    mn = np.minimum(np.minimum(r, g), b).astype(np.float32)
    sat = np.where(mx > 0, (mx - mn) / mx, 0.0)
    visible = alpha > 0

    cool = visible & (lum > 110) & (b > r + 2) & (b >= g - 3)
    soft = visible & (lum >= 95) & (lum <= 170) & (sat < 0.24) & (b >= r - 6)
    bright = visible & (lum > 155) & (sat < 0.18)
    # pale bloom hugging dark drop-shadows (white ring around black shadow)
    bloom = visible & near_t & near_dark & (lum >= 90) & (lum <= 155) & (sat < 0.30)

    candidates = (cool | soft | bright | bloom) & (lum >= 90)

    # Flood from transparent edge into candidates only
    remove = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()

    edge = candidates & near_t
    ys, xs = np.where(edge)
    for y, x in zip(ys.tolist(), xs.tolist()):
        remove[y, x] = True
        q.append((y, x))

    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and candidates[ny, nx] and not remove[ny, nx]:
                remove[ny, nx] = True
                q.append((ny, nx))

    n = int(remove.sum())
    if n:
        arr[remove, 3] = 0
    return n


def strip_file(path: Path) -> int:
    img = Image.open(path).convert("RGBA")
    arr = np.array(img)
    n = strip_halo(arr)
    if n:
        Image.fromarray(arr, "RGBA").save(path)
    return n


def main():
    total = 0
    files = 0
    for p in sorted({p.resolve() for p in TARGETS if p.exists()}):
        n = strip_file(p)
        if n:
            files += 1
            total += n
            print(f"{p.relative_to(ROOT)}: removed {n} px")
    print(f"Done. {files} files, {total} pixels cleared.")


if __name__ == "__main__":
    main()
