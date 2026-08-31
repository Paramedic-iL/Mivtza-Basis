/* מבצע בסיס — vision polish (PC + mobile) */
(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const minimap = document.getElementById("minimap");
  const mctx = minimap.getContext("2d");

  let width = 0, height = 0;
  let score = 0, arrested = 0, gameOver = false, won = false;
  let enemies = [], enemyBullets = [], taserLines = [], decorations = [], flashes = [];
  const held = {};
  let hurtFlashUntil = 0;

  const SFX_V = "3";
  const audio = {
    unlocked: false,
    cache: {},
    load(name) {
      if (this.cache[name]) return this.cache[name];
      const a = new Audio("assets/sfx/" + name + "?v=" + SFX_V);
      a.preload = "auto";
      this.cache[name] = a;
      return a;
    },
    play(name, vol = 0.7) {
      try {
        const base = this.load(name);
        const a = base.cloneNode();
        a.volume = vol;
        const p = a.play();
        if (p && p.catch) p.catch(() => {});
      } catch (_) {}
    },
    playRandom(names, vol = 0.7) {
      if (!names.length) return;
      this.play(names[Math.floor(Math.random() * names.length)], vol);
    },
    unlock() {
      if (this.unlocked) return;
      this.unlocked = true;
      // warm a few buffers
      ["taser_buzz.wav", "reload.wav", "arrest.mp3"].forEach(n => this.load(n));
    }
  };
  const VOICE_TAUNT = ["surrender.mp3", "where_run.mp3", "sausage.mp3", "freeze.mp3", "hands_up.mp3", "gotcha.mp3"];
  const VOICE_ZAP = ["zap_1.mp3", "zap_2.mp3", "zap_3.mp3", "zap_4.mp3", "zap_5.mp3"];
  const VOICE_HIT = ["hit_aiy.mp3", "hit_oy.mp3", "hit_pagaat.mp3", "hit_ouch.mp3", "hit_aahh.mp3", "hit_lama.mp3"];
  const HURT_WAV = ["hurt_1.wav", "hurt_2.wav", "hurt_3.wav", "hurt_4.wav", "hurt_5.wav", "hurt_6.wav"];

  function flashHurt() {
    hurtFlashUntil = performance.now() + 320;
    const el = document.getElementById("hurtVignette");
    if (el) {
      el.classList.add("on");
      clearTimeout(flashHurt._t);
      flashHurt._t = setTimeout(() => el.classList.remove("on"), 320);
    }
  }

  const player = {
    x: 100, y: 350, radius: 18, footR: 11, speed: 2.1,
    health: 100, ammo: 5, maxAmmo: 5,
    ready: true, reloading: false, reloadStart: 0, reloadEnd: 0,
    facing: "down", moving: false
  };
  const pickup = { x: 0, y: 0, radius: 28, active: true };
  const healthBox = { x: 0, y: 0, radius: 28, active: true };

  // Walls are rebuilt each round — see generateWalls()
  let walls = [];

  // Map layout rules (son):
  // 1) Player can reach every walkable spot
  // 2) Each wall run = at least 2 adjacent blocks (no single gaps for bullets)
  // 3) Equal count of vertical and horizontal wall runs
  // 4) Decorations only after walls pass 1–3
  const WALL_UNIT_V = { w: 0.048, h: 0.11 }; // one vertical block
  const WALL_UNIT_H = { w: 0.12, h: 0.055 };  // one horizontal block

  function rectsOverlap(a, b, pad = 0.02) {
    return !(
      a.x + a.w + pad <= b.x ||
      b.x + b.w + pad <= a.x ||
      a.y + a.h + pad <= b.y ||
      b.y + b.h + pad <= a.y
    );
  }

  function buildWallRun(orient, blocks, x, y) {
    const n = Math.max(2, blocks);
    if (orient === "v") {
      return { x, y, w: WALL_UNIT_V.w, h: WALL_UNIT_V.h * n, orient: "v", blocks: n };
    }
    return { x, y, w: WALL_UNIT_H.w * n, h: WALL_UNIT_H.h, orient: "h", blocks: n };
  }

  function wallsCollide(list, candidate) {
    return list.some(w => rectsOverlap(w, candidate, 0.035));
  }

  function tryBuildWallLayout() {
    const pairCount = 2 + Math.floor(Math.random() * 3); // 2–4 of each (rule 3)
    const built = [];
    const margin = 0.07;
    const spawnSafe = { x: 0.02, y: 0.35, w: 0.18, h: 0.40 };

    function placeOne(orient) {
      for (let tries = 0; tries < 70; tries++) {
        const blocks = 2 + Math.floor(Math.random() * 3); // 2–4 adjacent blocks
        let x, y;
        if (orient === "v") {
          x = margin + Math.random() * (1 - margin * 2 - WALL_UNIT_V.w);
          y = margin + Math.random() * (1 - margin * 2 - WALL_UNIT_V.h * blocks);
        } else {
          x = margin + Math.random() * (1 - margin * 2 - WALL_UNIT_H.w * blocks);
          y = margin + Math.random() * (1 - margin * 2 - WALL_UNIT_H.h);
        }
        const run = buildWallRun(orient, blocks, x, y);
        if (rectsOverlap(run, spawnSafe, 0.04)) continue;
        if (wallsCollide(built, run)) continue;
        built.push(run);
        return true;
      }
      return false;
    }

    for (let i = 0; i < pairCount; i++) {
      if (!placeOne("v")) return null;
      if (!placeOne("h")) return null;
    }
    return built.map(({ x, y, w, h }) => ({ x, y, w, h }));
  }

  function mapIsFullyReachable(layout) {
    const cols = 28, rows = 18;
    const blocked = Array.from({ length: rows }, () => Array(cols).fill(false));
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const cx = (x + 0.5) / cols;
        const cy = (y + 0.5) / rows;
        for (const w of layout) {
          const pad = 0.012;
          if (cx >= w.x - pad && cx <= w.x + w.w + pad &&
              cy >= w.y - pad && cy <= w.y + w.h + pad) {
            blocked[y][x] = true;
            break;
          }
        }
      }
    }

    const sx = Math.min(cols - 1, Math.max(0, Math.floor(0.08 * cols)));
    const sy = Math.min(rows - 1, Math.max(0, Math.floor(0.55 * rows)));
    if (blocked[sy][sx]) return false;

    const seen = Array.from({ length: rows }, () => Array(cols).fill(false));
    const q = [[sx, sy]];
    seen[sy][sx] = true;
    let reached = 0, walkable = 0;
    while (q.length) {
      const [x, y] = q.shift();
      reached++;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (seen[ny][nx] || blocked[ny][nx]) continue;
        seen[ny][nx] = true;
        q.push([nx, ny]);
      }
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!blocked[y][x]) walkable++;
      }
    }
    return walkable > 0 && reached === walkable;
  }

  function generateWalls() {
    for (let attempt = 0; attempt < 50; attempt++) {
      const layout = tryBuildWallLayout();
      if (!layout) continue;
      const vCount = layout.filter(w => w.h >= w.w).length;
      const hCount = layout.filter(w => w.w > w.h).length;
      if (vCount !== hCount || vCount < 2) continue;
      if (!mapIsFullyReachable(layout)) continue;
      walls = layout;
      return;
    }
    walls = [
      { x: 0.22, y: 0.12, w: 0.048, h: 0.28 },
      { x: 0.70, y: 0.45, w: 0.048, h: 0.32 },
      { x: 0.38, y: 0.28, w: 0.28, h: 0.055 },
      { x: 0.18, y: 0.70, w: 0.30, h: 0.055 }
    ];
  }

  const assets = {
    player: { up: null, down: null, left: null, right: null },
    enemy: { up: null, down: null, left: null, right: null },
    mapObjects: [],
    ground: null,
    wallH: null, wallV: null, wallBlock: null,
    taserMagazine: null, medkit: null, muzzle: null,
    marker: null
  };

  function pxWalls() {
    return walls.map(w => ({ x: w.x * width, y: w.y * height, w: w.w * width, h: w.h * height }));
  }

  // Align collision to how walls are actually drawn (centered tall sprites)
  function wallVisualBox(w) {
    const img = assets.wallBlock || assets.wallH || assets.wallV;
    const horizontal = w.w >= w.h;
    if (!img) return { x: w.x, y: w.y, w: w.w, h: w.h };

    if (horizontal) {
      // Drawn upward from the layout strip — block only the ground base
      const th = Math.max(w.h * 2.0, 42);
      const baseH = Math.max(24, Math.min(th * 0.42, w.h + 18));
      const baseY = w.y + w.h - baseH + 6;
      return { x: w.x - 2, y: baseY, w: w.w + 4, h: baseH };
    }

    // Vertical: sprite is centered on the thin layout rect and much wider
    const tw = Math.max(w.w * 2.05, 38);
    const walkW = tw * 0.78; // stone body, not soft outer fringe
    return {
      x: w.x + w.w / 2 - walkW / 2,
      y: w.y - 2,
      w: walkW,
      h: w.h + 4
    };
  }

  function wallHitboxes() {
    return pxWalls().map(wallVisualBox);
  }

  function walkWallHitboxes() {
    return pxWalls().map(wallVisualBox);
  }

  // Entity x/y is sprite center; feet / shadow sit a bit lower
  function footY(entity) {
    return entity.y + 10;
  }

  const ASSET_V = "ff19";
  function loadImage(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src + (src.includes("?") ? "&" : "?") + "v=" + ASSET_V;
    });
  }

  async function loadAssets() {
    let manifest = {};
    try { manifest = await fetch("assets/manifest.json").then(r => r.json()); } catch {}

    assets.player.up = await loadImage("assets/player/up.png");
    assets.player.down = await loadImage("assets/player/down.png");
    assets.player.left = await loadImage("assets/player/left.png");
    assets.player.right = await loadImage("assets/player/right.png");

    assets.enemy.up = await loadImage("assets/sprites/enemies/up.png");
    assets.enemy.down = await loadImage("assets/sprites/enemies/down.png");
    assets.enemy.left = await loadImage("assets/sprites/enemies/left.png");
    assets.enemy.right = await loadImage("assets/sprites/enemies/right.png");

    assets.ground = await loadImage("assets/sprites/ground_field.png");
    assets.wallH = await loadImage("assets/sprites/wall_concrete_h.png");
    assets.wallV = await loadImage("assets/sprites/wall_concrete_v.png");
    assets.wallBlock = await loadImage("assets/sprites/wall_concrete_block.png");

    assets.taserMagazine = await loadImage("assets/sprites/vfx/pickup.png")
      || await loadImage("assets/sprites/taser_magazine.png");
    assets.medkit = await loadImage("assets/sprites/medkit.png");
    assets.muzzle = await loadImage("assets/sprites/vfx/muzzle.png");
    assets.marker = await loadImage("assets/sprites/vfx/enemy_marker.png")
      || await loadImage("assets/sprites/vfx/enemy_marker2.png");

    const wallSkip = new Set([
      "assets/sprites/obstacles/obs_01.png",
      "assets/sprites/obstacles/obs_02.png",
      "assets/sprites/obstacles/obs_03.png",
      "assets/sprites/obstacles/obs_04.png"
    ]);
    const objs = (manifest.obstacles || []).filter(s => !wallSkip.has(s));
    const loaded = await Promise.all(objs.map(loadImage));
    assets.mapObjects = loaded.filter(img => img && img.width >= 24);
  }

  function resize() {
    const area = document.getElementById("gameArea") || document.body;
    canvas.width = area.clientWidth || innerWidth;
    canvas.height = area.clientHeight || innerHeight;
    width = canvas.width;
    height = canvas.height;
  }

  function circleRectCollision(x, y, r, rect) {
    const cx = Math.max(rect.x, Math.min(x, rect.x + rect.w));
    const cy = Math.max(rect.y, Math.min(y, rect.y + rect.h));
    return (x - cx) ** 2 + (y - cy) ** 2 < r * r;
  }

  function blocked(x, y, r) {
    if (x < r || y < r || x > width - r || y > height - r) return true;
    for (const wall of walkWallHitboxes()) if (circleRectCollision(x, y, r, wall)) return true;
    for (const d of decorations) {
      if (!d.solid) continue;
      // solid near the prop's ground contact, not the full tall art
      const rect = { x: d.x - d.w * 0.28, y: d.y + d.h * 0.05, w: d.w * 0.56, h: d.h * 0.35 };
      if (circleRectCollision(x, y, r, rect)) return true;
    }
    return false;
  }

  function validSpawn(x, y, r = 28) {
    if (blocked(x, y, r)) return false;
    if (Math.hypot(x - player.x, y - player.y) < 170) return false;
    return true;
  }

  function randomFreePosition(r = 28) {
    for (let i = 0; i < 500; i++) {
      const x = 70 + Math.random() * (width - 140);
      const y = 70 + Math.random() * (height - 140);
      if (validSpawn(x, y, r)) return { x, y };
    }
    return { x: width / 2, y: height / 2 };
  }

  function placePickup() {
    const p = randomFreePosition(32);
    pickup.x = p.x; pickup.y = p.y; pickup.active = true;
  }

  function placeHealthBox() {
    const p = randomFreePosition(32);
    // keep away from ammo pickup
    for (let i = 0; i < 40; i++) {
      if (Math.hypot(p.x - pickup.x, p.y - pickup.y) > 120) break;
      const q = randomFreePosition(32);
      p.x = q.x; p.y = q.y;
    }
    healthBox.x = p.x; healthBox.y = p.y; healthBox.active = true;
  }

  function worldIsReachable(extraSolid) {
    const cols = 28, rows = 18;
    const blockedGrid = Array.from({ length: rows }, () => Array(cols).fill(false));
    const r = Math.max(14, Math.min(width, height) * 0.018);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const cx = ((x + 0.5) / cols) * width;
        const cy = ((y + 0.5) / rows) * height;
        if (blocked(cx, cy, r)) {
          blockedGrid[y][x] = true;
          continue;
        }
        if (extraSolid) {
          const rect = {
            x: extraSolid.x - extraSolid.w * 0.38,
            y: extraSolid.y - extraSolid.h * 0.15,
            w: extraSolid.w * 0.76,
            h: extraSolid.h * 0.55
          };
          if (circleRectCollision(cx, cy, r, rect)) blockedGrid[y][x] = true;
        }
      }
    }
    const sx = Math.min(cols - 1, Math.max(0, Math.floor((player.x / width) * cols)));
    const sy = Math.min(rows - 1, Math.max(0, Math.floor((player.y / height) * rows)));
    if (blockedGrid[sy][sx]) return false;
    const seen = Array.from({ length: rows }, () => Array(cols).fill(false));
    const q = [[sx, sy]];
    seen[sy][sx] = true;
    let reached = 0, walkable = 0;
    while (q.length) {
      const [x, y] = q.shift();
      reached++;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (seen[ny][nx] || blockedGrid[ny][nx]) continue;
        seen[ny][nx] = true;
        q.push([nx, ny]);
      }
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) if (!blockedGrid[y][x]) walkable++;
    }
    return walkable > 0 && reached === walkable;
  }

  function placeDecorations() {
    // Rule 4: only after walls already satisfy 1–3
    decorations = [];
    if (!assets.mapObjects.length) return;
    const pool = assets.mapObjects.slice().sort(() => Math.random() - 0.5);
    const count = Math.min(10, pool.length);
    for (let i = 0; i < count; i++) {
      const img = pool[i];
      let placed = false;
      for (let attempt = 0; attempt < 35; attempt++) {
        const p = randomFreePosition(36);
        const targetH = 52 + Math.random() * 34;
        const scale = targetH / img.height;
        const candidate = {
          img, x: p.x, y: p.y,
          w: img.width * scale, h: img.height * scale,
          solid: true
        };
        if (!worldIsReachable(candidate)) continue;
        decorations.push(candidate);
        placed = true;
        break;
      }
      if (!placed) continue;
    }
  }

  function facingFromDelta(dx, dy) {
    if (!dx && !dy) return "down";
    if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
    return dy < 0 ? "up" : "down";
  }

  function createEnemies() {
    enemies = [];
    for (let i = 0; i < 6; i++) {
      const p = randomFreePosition(22);
      const bias = (i / 6) * Math.PI * 2 + Math.random() * 0.7;
      enemies.push({
        x: p.x, y: p.y, radius: 18, footR: 10,
        speed: 0.28 + Math.random() * 0.22,
        state: "active", stunUntil: 0,
        shootCooldown: 40 + Math.floor(Math.random() * 70),
        facing: "down",
        // unique approach style — not a shared straight line
        pathBias: bias,
        orbitSign: i % 2 === 0 ? 1 : -1,
        orbitDist: 160 + Math.random() * 220,
        waypoint: null,
        retargetAt: 0,
        wanderPhase: Math.random() * Math.PI * 2
      });
      pickEnemyWaypoint(enemies[enemies.length - 1], true);
    }
    document.getElementById("enemyTotal").textContent = enemies.length;
  }

  function pickEnemyWaypoint(e, force) {
    const now = performance.now();
    if (!force && e.waypoint && now < e.retargetAt) return;
    e.wanderPhase += 0.7 + Math.random();
    // personal flanking / orbit point around the player
    const ang = e.pathBias + Math.sin(e.wanderPhase) * 0.9 + e.orbitSign * 0.4;
    const dist = e.orbitDist * (0.75 + Math.random() * 0.5);
    let tx = player.x + Math.cos(ang) * dist;
    let ty = player.y + Math.sin(ang) * dist;
    // sometimes take a detour corner instead of direct approach
    if (Math.random() < 0.45) {
      tx += (Math.random() - 0.5) * 280;
      ty += (Math.random() - 0.5) * 280;
    }
    tx = Math.max(40, Math.min(width - 40, tx));
    ty = Math.max(40, Math.min(height - 40, ty));
    // nudge until free-ish
    for (let i = 0; i < 12; i++) {
      if (!blocked(tx, footY(e), e.footR)) break;
      tx = 60 + Math.random() * (width - 120);
      ty = 60 + Math.random() * (height - 120);
    }
    e.waypoint = { x: tx, y: ty };
    e.retargetAt = now + 900 + Math.random() * 1600;
  }

  function enemySteer(e) {
    pickEnemyWaypoint(e, false);
    const wp = e.waypoint || { x: player.x, y: player.y };
    let dx = wp.x - e.x;
    let dy = wp.y - e.y;
    // separation — don't clump into one blob
    for (const other of enemies) {
      if (other === e || other.state === "arrested") continue;
      const ox = e.x - other.x, oy = e.y - other.y;
      const d = Math.hypot(ox, oy) || 0.01;
      if (d < 70) {
        const push = (70 - d) / 70;
        dx += (ox / d) * push * 90;
        dy += (oy / d) * push * 90;
      }
    }
    // soft pull toward player so they still hunt
    dx += (player.x - e.x) * 0.18;
    dy += (player.y - e.y) * 0.18;
    if (Math.hypot(dx, dy) < 8) pickEnemyWaypoint(e, true);
    return { dx, dy };
  }

  function moveEntity(entity, dx, dy, speed, footR) {
    const len = Math.hypot(dx, dy);
    if (!len) return;
    const mx = dx / len * speed, my = dy / len * speed;
    // Passage = foot-shadow circle only (not full body / fat wall pads)
    if (!blocked(entity.x + mx, footY(entity), footR)) entity.x += mx;
    if (!blocked(entity.x, footY(entity) + my, footR)) entity.y += my;
    if (blocked(entity.x, footY(entity), footR)) {
      for (const step of [[6, 0], [-6, 0], [0, 6], [0, -6], [5, 5], [-5, 5], [5, -5], [-5, -5]]) {
        if (!blocked(entity.x + step[0], footY(entity) + step[1], footR)) {
          entity.x += step[0];
          entity.y += step[1];
          break;
        }
      }
    }
  }

  function movePlayer() {
    if (gameOver || won) return;
    let dx = 0, dy = 0;
    if (held.KeyW || held.ArrowUp) dy--;
    if (held.KeyS || held.ArrowDown) dy++;
    if (held.KeyA || held.ArrowLeft) dx--;
    if (held.KeyD || held.ArrowRight) dx++;
    player.moving = !!(dx || dy);
    if (player.moving) player.facing = facingFromDelta(dx, dy);
    moveEntity(player, dx, dy, player.speed, player.footR);
  }

  function lineHitsWall(x1, y1, x2, y2) {
    const d = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(d / 8));
    const ws = wallHitboxes();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
      for (const w of ws) if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) return true;
    }
    return false;
  }

  function enemyShoot(e) {
    const dx = player.x - e.x, dy = player.y - e.y, d = Math.hypot(dx, dy);
    if (!d) return;
    const s = 5.2;
    enemyBullets.push({ x: e.x, y: e.y, vx: dx / d * s, vy: dy / d * s, radius: 5, life: 240 });
    flashes.push({ x: e.x + dx / d * 22, y: e.y + dy / d * 22, life: 6, ang: Math.atan2(dy, dx) });
    audio.play("enemy_shoot.wav", 0.45);
  }

  function updateEnemies() {
    if (gameOver || won) return;
    const now = performance.now();
    for (const e of enemies) {
      if (e.state === "arrested") continue;
      if (e.state === "stunned") {
        if (now >= e.stunUntil) {
          e.state = "active";
          setMessage("⚠️ האויב השתחרר מהטייזר!");
        } else continue;
      }
      const steer = enemySteer(e);
      const dx = steer.dx, dy = steer.dy;
      const dPlayer = Math.hypot(player.x - e.x, player.y - e.y);
      e.facing = facingFromDelta(player.x - e.x, player.y - e.y);
      if (dPlayer > 90) moveEntity(e, dx, dy, e.speed, e.footR);
      e.shootCooldown--;
      if (dPlayer < 280 && dPlayer > 70 && e.shootCooldown <= 0 && !lineHitsWall(e.x, e.y, player.x, player.y)) {
        enemyShoot(e);
        e.shootCooldown = 70 + Math.floor(Math.random() * 55);
      }
    }
  }

  function updateBullets() {
    const ws = wallHitboxes();
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.x += b.vx; b.y += b.vy; b.life--;
      let hitWall = false;
      for (const w of ws) if (circleRectCollision(b.x, b.y, b.radius, w)) { hitWall = true; break; }
      if (hitWall || b.life <= 0) { enemyBullets.splice(i, 1); continue; }
      if (Math.hypot(b.x - player.x, b.y - player.y) < b.radius + player.radius) {
        enemyBullets.splice(i, 1);
        player.health = Math.max(0, player.health - 10);
        flashHurt();
        audio.playRandom(HURT_WAV, 0.55);
        audio.playRandom(VOICE_HIT, 0.85);
        updateHUD();
        setMessage("💥 נפגעת מכדור! ‎-10 חיים");
        if (player.health <= 0) {
          gameOver = true;
          setMessage("💀 נפלת במשימה — לחץ משחק חדש");
        }
      }
    }
  }

  function makeLightningBolt(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const px = -uy, py = ux;

    // Main bolt follows the imaginary straight line to the target
    const main = [{ x: x1, y: y1 }];
    const steps = Math.max(8, Math.floor(len / 12));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const envelope = Math.sin(t * Math.PI); // less jagged near ends
      const jag = (Math.random() * 2 - 1) * (10 + len * 0.02) * envelope;
      main.push({
        x: x1 + ux * len * t + px * jag,
        y: y1 + uy * len * t + py * jag
      });
    }
    main.push({ x: x2, y: y2 });

    // Branching forks off the guiding line
    const branches = [];
    for (let i = 2; i < main.length - 2; i++) {
      if (Math.random() > 0.55) continue;
      const p = main[i];
      const side = Math.random() < 0.5 ? 1 : -1;
      const branchLen = 12 + Math.random() * 24;
      const ang = Math.atan2(uy, ux) + side * (0.55 + Math.random() * 0.95);
      const bpts = [{ x: p.x, y: p.y }];
      const segs = 2 + (Math.random() < 0.5 ? 1 : 0);
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        bpts.push({
          x: p.x + Math.cos(ang) * branchLen * t + (Math.random() * 2 - 1) * 5,
          y: p.y + Math.sin(ang) * branchLen * t + (Math.random() * 2 - 1) * 5
        });
      }
      branches.push(bpts);
    }
    return { main, branches };
  }

  function useTaser() {
    if (gameOver || won) return;
    if (player.reloading) { setMessage("🔄 טוען מחדש..."); return; }
    if (!player.ready) { setMessage("🔄 הטייזר עוד לא מוכן"); return; }
    if (player.ammo <= 0) { setMessage("⚠️ אין יריות! מצא מחסנית"); return; }

    // Nearest active enemy in range, with clear line of sight
    let target = null, closest = 230;
    for (const e of enemies) {
      if (e.state !== "active") continue;
      const d = Math.hypot(e.x - player.x, e.y - player.y);
      if (d < closest && !lineHitsWall(player.x, player.y, e.x, e.y)) {
        closest = d;
        target = e;
      }
    }
    if (!target) { setMessage("אין אויב בטווח הטייזר"); return; }

    target.state = "stunned";
    target.stunUntil = performance.now() + 1000;
    player.ammo--;
    player.ready = false;
    player.facing = facingFromDelta(target.x - player.x, target.y - player.y);
    const bolt = makeLightningBolt(player.x, player.y, target.x, target.y);
    taserLines.push({
      x1: player.x, y1: player.y, x2: target.x, y2: target.y,
      main: bolt.main, branches: bolt.branches,
      life: 14, target
    });
    audio.play("taser_buzz.wav", 0.75);
    audio.playRandom(VOICE_ZAP, 0.9);
    if (Math.random() < 0.45) setTimeout(() => audio.playRandom(VOICE_TAUNT, 0.85), 280);
    score += 25;
    updateHUD();
    if (player.ammo > 0) {
      setMessage("⚡ נוטרל! טוען מחדש...");
      beginReload();
    } else {
      setMessage("⚡ ירייה אחרונה — מצא מחסנית");
    }
  }

  function beginReload() {
    if (gameOver || won || player.reloading) return;
    if (player.ammo <= 0) return;
    player.reloading = true;
    player.ready = false;
    player.reloadStart = performance.now();
    player.reloadEnd = player.reloadStart + 500;
    audio.play("reload.wav", 0.7);
    updateHUD();
  }

  function reloadTaser() {
    // kept for mobile button / R — but reload is automatic after each shot
    if (gameOver || won || player.reloading) return;
    if (player.ready) { setMessage("הטייזר כבר מוכן"); return; }
    if (player.ammo <= 0) { setMessage("⚠️ אין תחמושת — מצא מחסנית"); return; }
    beginReload();
    setMessage("🔄 טוען מחדש...");
  }

  function updateReload() {
    if (!player.reloading) return;
    const now = performance.now();
    const pct = Math.max(0, Math.min(1, (now - player.reloadStart) / 500));
    document.getElementById("reloadBar").style.width = (pct * 100) + "%";
    if (now >= player.reloadEnd) {
      player.reloading = false;
      player.ready = true;
      document.getElementById("reloadBar").style.width = "0%";
      updateHUD();
      setMessage("✅ הטייזר מוכן");
    }
  }

  function arrestEnemy() {
    if (gameOver || won) return;
    for (const e of enemies) {
      if (e.state !== "stunned") continue;
      if (Math.hypot(e.x - player.x, e.y - player.y) < 62) {
        e.state = "arrested";
        arrested++;
        score += 100;
        audio.play("arrest.mp3", 0.95);
        if (Math.random() < 0.5) setTimeout(() => audio.playRandom(VOICE_TAUNT, 0.8), 500);
        updateHUD();
        setMessage(arrested === enemies.length
          ? "🏆 כל הכבוד!"
          : "👮 אויב נעצר!");
        if (arrested === enemies.length) {
          won = true;
          score += 500;
          updateHUD();
          showWinBanner(true);
        }
        return;
      }
    }
    setMessage("אין אויב מנוטרל מספיק קרוב");
  }

  function updatePickup() {
    if (!pickup.active) return;
    if (Math.hypot(player.x - pickup.x, player.y - pickup.y) < player.radius + pickup.radius) {
      player.ammo = player.maxAmmo;
      player.ready = true;
      player.reloading = false;
      document.getElementById("reloadBar").style.width = "0%";
      score += 50;
      updateHUD();
      audio.play("ammo_pickup.wav", 0.8);
      setMessage("🔋 מחסנית! 5 יריות זמינות");
      placePickup();
    }
  }

  function updateHealthBox() {
    if (!healthBox.active) return;
    if (Math.hypot(player.x - healthBox.x, player.y - healthBox.y) < player.radius + healthBox.radius) {
      const before = player.health;
      player.health = Math.min(100, player.health + 40);
      score += 30;
      updateHUD();
      audio.play("health_pickup.wav", 0.8);
      setMessage(player.health > before ? "❤️ תיבת בריאות! +" + (player.health - before) + " חיים" : "❤️ כבר מלא בחיים");
      placeHealthBox();
    }
  }

  function checkMission() {
    // win happens on last arrest — no map flag zone
  }

  function showWinBanner(on) {
    const el = document.getElementById("winBanner");
    if (!el) return;
    el.classList.toggle("on", !!on);
    el.style.display = on ? "flex" : "none";
  }

  function setMessage(t) { document.getElementById("message").textContent = t; }

  function updateHUD() {
    document.getElementById("health").textContent = player.health;
    document.getElementById("healthBar").style.width = player.health + "%";
    document.getElementById("ammo").textContent = player.ammo;
    document.getElementById("arrested").textContent = arrested;
    document.getElementById("score").textContent = score;
    document.getElementById("reloadState").textContent =
      player.reloading ? "טוען..." : player.ready ? "מוכן" : player.ammo > 0 ? "טוען..." : "ריק";
    const bolts = document.getElementById("ammoBolts");
    bolts.textContent = "⚡".repeat(player.ammo) + "·".repeat(Math.max(0, player.maxAmmo - player.ammo));
  }

  function drawGround() {
    if (assets.ground) {
      const tile = 220;
      for (let x = -20; x < width; x += tile) {
        for (let y = -20; y < height; y += tile) {
          ctx.drawImage(assets.ground, x, y, tile + 2, tile + 2);
        }
      }
    } else {
      ctx.fillStyle = "#5a7a3e";
      ctx.fillRect(0, 0, width, height);
    }
  }

  function drawWallSprite(w) {
    // Long walls like before, but pieces sit side-by-side — no overlap / wall-in-wall
    const img = assets.wallBlock || assets.wallH || assets.wallV;
    if (!img) {
      ctx.fillStyle = "#6b6f76";
      ctx.fillRect(w.x, w.y, w.w, w.h);
      return;
    }

    const horizontal = w.w >= w.h;

    if (horizontal) {
      const th = Math.max(w.h * 2.0, 42);
      const tw = th * (img.width / img.height);
      const count = Math.max(1, Math.ceil(w.w / tw));
      const pieceW = w.w / count;
      for (let i = 0; i < count; i++) {
        const x = w.x + i * pieceW;
        ctx.drawImage(img, x, w.y + w.h - th + 6, pieceW, th);
      }
    } else {
      const tw = Math.max(w.w * 2.05, 38);
      const th = tw * (img.height / img.width);
      const count = Math.max(1, Math.ceil(w.h / (th * 0.92)));
      const pieceH = w.h / count;
      for (let i = 0; i < count; i++) {
        const y = w.y + i * pieceH;
        // one block per segment, height matches segment — no stacking overlap
        ctx.drawImage(img, w.x + w.w / 2 - tw / 2, y + pieceH - th * 0.85, tw, th * 0.9);
      }
    }
  }

  function drawSpriteCentered(img, x, y, targetH) {
    if (!img) return false;
    const scale = targetH / img.height;
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
    return true;
  }

  function drawFootOval(x, y) {
    // Same kind of light base circle enemies already have under their boots
    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.42)";
    ctx.beginPath();
    ctx.ellipse(x, footY({ y }), 14, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPlayer() {
    drawFootOval(player.x, player.y);
    const img = assets.player[player.facing] || assets.player.down;
    drawSpriteCentered(img, player.x, player.y, 58);
  }

  function drawEnemy(e) {
    if (e.state === "arrested") ctx.globalAlpha = 0.45;
    const img = assets.enemy[e.facing] || assets.enemy.down;
    drawSpriteCentered(img, e.x, e.y, 52);
    ctx.globalAlpha = 1;

    if (e.state === "active" && assets.marker) {
      const mh = 16;
      const mw = assets.marker.width * (mh / assets.marker.height);
      ctx.drawImage(assets.marker, e.x - mw / 2, e.y - 42, mw, mh);
    }
    if (e.state === "stunned") {
      // Simple cyan stun ring — not the old lightning sprite
      ctx.save();
      ctx.strokeStyle = "rgba(0, 229, 255, 0.85)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 22 + Math.sin(performance.now() / 80) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "#00e5ff";
      ctx.font = "22px Segoe UI";
      ctx.textAlign = "center";
      ctx.fillText("⚡", e.x, e.y - 38);
    }
    if (e.state === "arrested") {
      ctx.font = "18px Segoe UI";
      ctx.textAlign = "center";
      ctx.fillText("🔒", e.x, e.y - 34);
    }
  }

  function drawPickup() {
    if (!pickup.active) return;
    const bob = Math.sin(performance.now() / 280) * 4;
    if (assets.taserMagazine) {
      ctx.save();
      ctx.shadowColor = "#ffe600";
      ctx.shadowBlur = 22;
      drawSpriteCentered(assets.taserMagazine, pickup.x, pickup.y + bob, 48);
      ctx.restore();
    } else {
      ctx.fillStyle = "#ffd600";
      ctx.fillRect(pickup.x - 16, pickup.y - 12 + bob, 32, 24);
    }
  }

  function drawHealthBox() {
    if (!healthBox.active) return;
    const bob = Math.sin(performance.now() / 260 + 1.5) * 4;
    if (assets.medkit) {
      ctx.save();
      ctx.shadowColor = "#ff4d4d";
      ctx.shadowBlur = 18;
      drawSpriteCentered(assets.medkit, healthBox.x, healthBox.y + bob, 46);
      ctx.restore();
    } else {
      ctx.fillStyle = "#fff";
      ctx.fillRect(healthBox.x - 16, healthBox.y - 12 + bob, 32, 24);
      ctx.fillStyle = "#e53935";
      ctx.fillRect(healthBox.x - 3, healthBox.y - 10 + bob, 6, 20);
      ctx.fillRect(healthBox.x - 10, healthBox.y - 3 + bob, 20, 6);
    }
  }

  function drawBullets() {
    for (const b of enemyBullets) {
      ctx.beginPath();
      ctx.moveTo(b.x - b.vx * 2, b.y - b.vy * 2);
      ctx.lineTo(b.x + b.vx, b.y + b.vy);
      ctx.strokeStyle = "#ffd800";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#fff3a0";
      ctx.fill();
    }
  }

  function drawFlashes() {
    for (const f of flashes) {
      if (assets.muzzle) {
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.ang);
        const h = 28;
        const w = assets.muzzle.width * (h / assets.muzzle.height);
        ctx.globalAlpha = Math.min(1, f.life / 4);
        ctx.drawImage(assets.muzzle, -w * 0.2, -h / 2, w, h);
        ctx.restore();
      } else {
        ctx.fillStyle = "rgba(255,220,60,.85)";
        ctx.beginPath();
        ctx.arc(f.x, f.y, 10, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function strokePoly(pts) {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  function drawTaser() {
    // Cyan branching lightning along the imaginary line to the nearest enemy
    const boltW = 3; // same thickness as enemy bullet trail
    for (const l of taserLines) {
      const alpha = Math.min(1, l.life / 8);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const mains = l.main || [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }];
      const branches = l.branches || [];

      // Soft cyan glow
      ctx.strokeStyle = "rgba(100, 230, 255, 0.35)";
      ctx.lineWidth = boltW + 4;
      strokePoly(mains);
      for (const b of branches) strokePoly(b);

      // Bright cyan core (enemy-bullet thickness)
      ctx.strokeStyle = "#7af7ff";
      ctx.lineWidth = boltW;
      strokePoly(mains);
      for (const b of branches) {
        ctx.lineWidth = Math.max(2, boltW - 0.5);
        strokePoly(b);
      }

      // Hot white center on main bolt
      ctx.strokeStyle = "#e8ffff";
      ctx.lineWidth = 1.2;
      strokePoly(mains);

      // Hit spark on enemy
      ctx.fillStyle = "#9ef9ff";
      ctx.beginPath();
      ctx.arc(l.x2, l.y2, 5 + (l.life % 3), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawWorldSorted() {
    const items = [];
    for (const w of pxWalls()) items.push({ footY: w.y + w.h, kind: "wall", w });
    for (const d of decorations) {
      // sprite drawn centered on d.y — feet at bottom edge
      items.push({ footY: d.y + d.h * 0.5, kind: "deco", d });
    }
    for (const e of enemies) items.push({ footY: e.y + e.radius * 0.9, kind: "enemy", e });
    if (pickup.active) items.push({ footY: pickup.y + 18, kind: "pickup" });
    if (healthBox.active) items.push({ footY: healthBox.y + 18, kind: "health" });
    items.push({ footY: player.y + player.radius * 0.9, kind: "player" });
    items.sort((a, b) => a.footY - b.footY || (a.kind === "enemy" || a.kind === "player" ? 1 : 0));

    for (const it of items) {
      if (it.kind === "wall") drawWallSprite(it.w);
      else if (it.kind === "deco") {
        ctx.drawImage(it.d.img, it.d.x - it.d.w / 2, it.d.y - it.d.h / 2, it.d.w, it.d.h);
      } else if (it.kind === "enemy") drawEnemy(it.e);
      else if (it.kind === "pickup") drawPickup();
      else if (it.kind === "health") drawHealthBox();
      else if (it.kind === "player") drawPlayer();
    }
  }

  function drawMinimap() {
    const mw = minimap.width, mh = minimap.height;
    mctx.clearRect(0, 0, mw, mh);
    mctx.fillStyle = "rgba(26, 42, 26, 0.35)";
    mctx.fillRect(0, 0, mw, mh);
    const sx = mw / width, sy = mh / height;
    mctx.fillStyle = "#5a6570";
    for (const w of pxWalls()) mctx.fillRect(w.x * sx, w.y * sy, Math.max(2, w.w * sx), Math.max(2, w.h * sy));
    for (const e of enemies) {
      if (e.state === "arrested") mctx.fillStyle = "#7dffa0";
      else if (e.state === "stunned") mctx.fillStyle = "#55e0ff";
      else mctx.fillStyle = "#ff3b3b";
      mctx.beginPath();
      mctx.arc(e.x * sx, e.y * sy, 3, 0, Math.PI * 2);
      mctx.fill();
    }
    mctx.fillStyle = "#fff";
    mctx.beginPath();
    mctx.moveTo(player.x * sx, player.y * sy - 4);
    mctx.lineTo(player.x * sx + 3, player.y * sy + 3);
    mctx.lineTo(player.x * sx - 3, player.y * sy + 3);
    mctx.fill();
    mctx.strokeStyle = "rgba(255,255,255,.25)";
    mctx.strokeRect(0.5, 0.5, mw - 1, mh - 1);
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    drawGround();
    drawWorldSorted();
    drawBullets();
    drawFlashes();
    drawTaser();
    drawMinimap();
    if (gameOver || won) {
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.fillRect(0, 0, width, height);
    }
    if (won) drawWinBox();
  }

  function drawWinBox() {
    const boxW = Math.min(420, width * 0.82);
    const boxH = Math.min(220, height * 0.38);
    const x = (width - boxW) / 2;
    const y = (height - boxH) / 2;
    ctx.save();
    ctx.fillStyle = "#142338";
    ctx.strokeStyle = "#ffd54f";
    ctx.lineWidth = 5;
    roundRect(ctx, x, y, boxW, boxH, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold " + Math.floor(Math.min(42, boxW / 9)) + "px Segoe UI, Tahoma, Arial, sans-serif";
    ctx.fillText("כל הכבוד", width / 2, y + boxH * 0.38);
    ctx.font = "bold " + Math.floor(Math.min(34, boxW / 11)) + "px Segoe UI, Tahoma, Arial, sans-serif";
    ctx.fillText("עצרת את כולם", width / 2, y + boxH * 0.68);
    ctx.restore();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function update() {
    movePlayer();
    updateEnemies();
    updateBullets();
    updateReload();
    updatePickup();
    updateHealthBox();
    checkMission();
    taserLines.forEach(l => l.life--);
    taserLines = taserLines.filter(l => l.life > 0);
    flashes.forEach(f => f.life--);
    flashes = flashes.filter(f => f.life > 0);
  }

  function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
  }

  function restartGame() {
    player.x = 110;
    player.y = Math.max(height * 0.55, 140);
    player.health = 100;
    player.ammo = 5;
    player.ready = true;
    player.reloading = false;
    player.facing = "down";
    score = 0; arrested = 0;
    enemyBullets = []; taserLines = []; flashes = [];
    gameOver = false; won = false;
    showWinBanner(false);
    decorations = [];
    generateWalls();       // rules 1–3
    placeDecorations();    // rule 4
    createEnemies();
    placePickup();
    placeHealthBox();
    updateHUD();
    setMessage("🎯 עצור את כל האויבים");
  }

  function toggleHelp() {
    const p = document.getElementById("help");
    p.style.display = p.style.display === "block" ? "none" : "block";
  }

  addEventListener("resize", () => {
    const px = player.x / Math.max(width, 1);
    const py = player.y / Math.max(height, 1);
    resize();
    player.x = px * width;
    player.y = py * height;
  });

  addEventListener("keydown", e => {
    audio.unlock();
    held[e.code] = true;
    if (e.code === "Space") { e.preventDefault(); useTaser(); }
    if (e.code === "KeyE") arrestEnemy();
    if (e.code === "KeyR") reloadTaser();
  });
  addEventListener("keyup", e => { held[e.code] = false; });
  addEventListener("pointerdown", () => audio.unlock(), { once: true });

  function bindMove(id, code) {
    const b = document.getElementById(id);
    const on = e => { e.preventDefault(); held[code] = true; };
    const off = e => { e.preventDefault(); held[code] = false; };
    ["touchstart", "mousedown"].forEach(n => b.addEventListener(n, on, { passive: false }));
    ["touchend", "touchcancel", "mouseup", "mouseleave"].forEach(n => b.addEventListener(n, off, { passive: false }));
  }
  bindMove("up", "KeyW");
  bindMove("down", "KeyS");
  bindMove("left", "KeyA");
  bindMove("right", "KeyD");
  document.getElementById("taser").addEventListener("click", useTaser);
  document.getElementById("arrest").addEventListener("click", arrestEnemy);
  document.getElementById("reload").addEventListener("click", reloadTaser);
  document.getElementById("restart").addEventListener("click", restartGame);
  document.getElementById("helpBtn").addEventListener("click", toggleHelp);

  (async function boot() {
    setMessage("טוען ספרייטים...");
    await loadAssets();
    resize();
    restartGame();
    loop();
  })();
})();
