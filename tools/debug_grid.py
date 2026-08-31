from PIL import Image, ImageDraw
import numpy as np

sheet = Image.open("assets/raw/sheet.png").convert("RGBA")
player = Image.open("assets/raw/player-sheet.png").convert("RGBA")
print("sheet", sheet.size)
print("player", player.size)

arr = np.array(player)
print("player corner RGB", arr[10, 10, :3], "mid", arr[400, 500, :3])
lum = arr[:, :, :3].max(axis=2)
print("player % dark<50", float((lum < 50).mean()))

g = sheet.copy()
d = ImageDraw.Draw(g)
for x in range(0, g.width, 64):
    d.line([(x, 0), (x, g.height)], fill=(255, 0, 0, 80))
    d.text((x + 2, 2), str(x), fill=(255, 255, 0, 255))
for y in range(0, g.height, 64):
    d.line([(0, y), (g.width, y)], fill=(0, 255, 0, 80))
    d.text((2, y + 2), str(y), fill=(0, 255, 255, 255))
g.save("assets/raw/sheet_grid.png")

pg = player.copy()
d = ImageDraw.Draw(pg)
for x in range(0, pg.width, 64):
    d.line([(x, 0), (x, pg.height)], fill=(255, 0, 0, 80))
    d.text((x + 2, 2), str(x), fill=(255, 255, 0, 255))
for y in range(0, pg.height, 64):
    d.line([(0, y), (pg.width, y)], fill=(0, 255, 0, 80))
    d.text((2, y + 2), str(y), fill=(0, 255, 255, 255))
pg.save("assets/raw/player_grid.png")
print("wrote grids")
