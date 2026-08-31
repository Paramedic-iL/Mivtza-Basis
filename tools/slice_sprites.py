"""Auto-extract sprites via connected components + fix player down."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "assets" / "raw"
OUT_PLAYER = ROOT / "assets" / "player"
OUT_SPRITES = ROOT / "assets" / "sprites"
OUT_AUTO = OUT_SPRITES / "auto"
OUT_AUTO.mkdir(parents=True, exist_ok=True)


def remove_dark_bg(img: Image.Image, thresh: int = 45) -> Image.Image:
    arr = np.array(img.convert("RGBA"))
    lum = arr[:, :, :3].max(axis=2)
    arr[lum < thresh, 3] = 0
    return Image.fromarray(arr, "RGBA")


def trim(img: Image.Image, pad: int = 2) -> Image.Image:
    arr = np.array(img)
    ys, xs = np.where(arr[:, :, 3] > 15)
    if len(xs) == 0:
        return img
    return img.crop(
        (
            max(0, int(xs.min()) - pad),
            max(0, int(ys.min()) - pad),
            min(arr.shape[1], int(xs.max()) + 1 + pad),
            min(arr.shape[0], int(ys.max()) + 1 + pad),
        )
    )


def connected_components(mask: np.ndarray, min_area: int = 200):
    h, w = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    boxes = []
    for y in range(h):
        for x in range(w):
            if not mask[y, x] or visited[y, x]:
                continue
            stack = [(x, y)]
            visited[y, x] = True
            xs, ys = [x], [y]
            while stack:
                cx, cy = stack.pop()
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        stack.append((nx, ny))
                        xs.append(nx)
                        ys.append(ny)
            area = len(xs)
            if area < min_area:
                continue
            boxes.append((min(xs), min(ys), max(xs) + 1, max(ys) + 1, area))
    return boxes


def extract_region(img: Image.Image, box, min_area=300, max_area=25000):
    region = img.crop(box)
    arr = np.array(region)
    mask = arr[:, :, 3] > 20
    return [
        (b[0] + box[0], b[1] + box[1], b[2] + box[0], b[3] + box[1], b[4])
        for b in connected_components(mask, min_area)
        if min_area <= b[4] <= max_area
    ]


def save_box(img: Image.Image, box, path: Path):
    piece = trim(img.crop(box[:4]))
    piece.save(path)
    return piece


def main():
    # --- Player ---
    player_sheet = remove_dark_bg(Image.open(RAW / "player-sheet.png"), 42)
    up = trim(player_sheet.crop((420, 120, 610, 310)))
    left = trim(player_sheet.crop((420, 390, 610, 580)))
    right = left.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    up.save(OUT_PLAYER / "up.png")
    left.save(OUT_PLAYER / "left.png")
    right.save(OUT_PLAYER / "right.png")

    # Down: take front-facing from main sheet player area via CC
    sheet = remove_dark_bg(Image.open(RAW / "sheet.png"), 48)
    sheet.save(OUT_SPRITES / "_sheet_clean.png")

    player_area = (10, 25, 220, 160)
    pboxes = extract_region(sheet, player_area, min_area=800, max_area=12000)
    # Prefer lower blobs (front face) — higher y
    pboxes.sort(key=lambda b: (-(b[1] + b[3]) / 2, -b[4]))
    if pboxes:
        down = save_box(sheet, pboxes[0], OUT_PLAYER / "down.png")
        print("down from sheet CC", down.size, "box", pboxes[0])
    else:
        # synthesize: use up flipped vertically as last resort
        down = up.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        down.save(OUT_PLAYER / "down.png")
        print("down fallback flip", down.size)

    # If down still contains multiple characters, split further
    down_img = Image.open(OUT_PLAYER / "down.png")
    darr = np.array(down_img)
    dboxes = connected_components(darr[:, :, 3] > 20, min_area=400)
    if len(dboxes) >= 2:
        # pick largest single
        dboxes.sort(key=lambda b: -b[4])
        down = save_box(down_img, dboxes[0], OUT_PLAYER / "down.png")
        print("down refined", down.size)

    # --- Auto dump all decent blobs for map building ---
    # Exclude top title strip a bit; work in content area
    all_boxes = extract_region(sheet, (0, 20, sheet.width, sheet.height), min_area=400, max_area=30000)
    # Filter out huge near-full-width text bars / tiny crumbs
    usable = []
    for b in all_boxes:
        w, h = b[2] - b[0], b[3] - b[1]
        if w < 18 or h < 18:
            continue
        if w > 280 or h > 220:
            continue
        aspect = w / max(h, 1)
        if aspect > 6 or aspect < 0.15:
            continue
        usable.append(b)

    usable.sort(key=lambda b: (b[1], b[0]))
    auto_paths = []
    for i, b in enumerate(usable):
        path = OUT_AUTO / f"obj_{i:03d}.png"
        save_box(sheet, b, path)
        auto_paths.append(f"assets/sprites/auto/obj_{i:03d}.png")
    print(f"auto objects: {len(auto_paths)}")

    # Also extract enemy-sized blobs from top character strip
    eboxes = extract_region(sheet, (100, 25, 650, 160), min_area=700, max_area=9000)
    eboxes.sort(key=lambda b: b[0])
    enemies = []
    for i, b in enumerate(eboxes[:8]):
        path = OUT_SPRITES / f"enemy_{i}.png"
        save_box(sheet, b, path)
        enemies.append(f"assets/sprites/enemy_{i}.png")
        print("enemy", i, path)

    # Named picks by searching auto objs near expected zones (best-effort)
    # Prefer glowing yellow for taser mag — scan auto for yellow-dominant small square
    named = {}
    for i, b in enumerate(usable):
        piece = Image.open(OUT_AUTO / f"obj_{i:03d}.png")
        a = np.array(piece)
        m = a[:, :, 3] > 20
        if not m.any():
            continue
        rgb = a[:, :, :3][m].astype(np.float32)
        mean = rgb.mean(axis=0)
        # yellow glow
        if mean[0] > 160 and mean[1] > 140 and mean[2] < 120 and piece.width < 90:
            named.setdefault("taser_magazine", f"assets/sprites/auto/obj_{i:03d}.png")
        # white+red medkit-ish
        if mean[0] > 150 and mean[1] > 140 and mean[2] > 140 and 30 < piece.width < 100:
            named.setdefault("medkit", f"assets/sprites/auto/obj_{i:03d}.png")
        # green rectangular container-ish
        if mean[1] > mean[0] and mean[1] > mean[2] and piece.width > 70 and piece.height > 40:
            named.setdefault("container", f"assets/sprites/auto/obj_{i:03d}.png")
        # grey wall-ish
        if abs(float(mean[0] - mean[1])) < 25 and abs(float(mean[1] - mean[2])) < 25 and mean.mean() < 140:
            if piece.width > 50 and piece.height < 90:
                named.setdefault("wall_h", f"assets/sprites/auto/obj_{i:03d}.png")
        # grass green square
        if mean[1] > 90 and mean[1] > mean[0] + 15 and 70 < piece.width < 140 and 70 < piece.height < 140:
            named.setdefault("ground_grass", f"assets/sprites/auto/obj_{i:03d}.png")

    # Copy named into stable filenames when found
    sprites = {}
    for name, src in named.items():
        im = Image.open(ROOT / src)
        dest = OUT_SPRITES / f"{name}.png"
        im.save(dest)
        sprites[name] = f"assets/sprites/{name}.png"
        print("named", name, im.size)

    # Keep previous manual key sprites if named missing — regenerate critical few with tighter boxes
    fallbacks = {
        "ground_grass": (580, 530, 690, 640),
        "mission_area": (440, 510, 560, 630),
        "icon_heart": (25, 565, 75, 615),
        "icon_stun": (90, 505, 140, 555),
        "icon_cuffs": (155, 505, 205, 555),
    }
    for name, box in fallbacks.items():
        if name in sprites:
            continue
        im = trim(sheet.crop(box))
        im.save(OUT_SPRITES / f"{name}.png")
        sprites[name] = f"assets/sprites/{name}.png"

    manifest = {
        "player": {
            "up": "assets/player/up.png",
            "down": "assets/player/down.png",
            "left": "assets/player/left.png",
            "right": "assets/player/right.png",
        },
        "sprites": sprites,
        "enemies": enemies,
        "mapObjects": auto_paths,
    }
    (ROOT / "assets" / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print("manifest written, objects", len(auto_paths), "named", list(sprites))


if __name__ == "__main__":
    main()
