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

  const player = {
    x: 100, y: 350, radius: 20, speed: 2.1,
    health: 100, ammo: 5, maxAmmo: 5,
    ready: true, reloading: false, reloadStart: 0, reloadEnd: 0,
    facing: "down", moving: false
  };
  const pickup = { x: 0, y: 0, radius: 28, active: true };

  const walls = [
    { x: .17, y: .10, w: .05, h: .30 }, { x: .17, y: .53, w: .05, h: .31 },
    { x: .30, y: .19, w: .18, h: .07 }, { x: .34, y: .43, w: .05, h: .30 },
    { x: .51, y: .09, w: .05, h: .25 }, { x: .51, y: .49, w: .05, h: .35 },
    { x: .63, y: .30, w: .18, h: .07 }, { x: .66, y: .62, w: .18, h: .07 },
    { x: .82, y: .12, w: .05, h: .31 }, { x: .88, y: .50, w: .09, h: .07 },
    { x: .08, y: .72, w: .16, h: .06 }, { x: .72, y: .15, w: .08, h: .05 }
  ];

  const assets = {
    player: { up: null, down: null, left: null, right: null },
    enemy: { up: null, down: null, left: null, right: null },
    mapObjects: [],
    ground: null,
    wallH: null, wallV: null, wallBlock: null,
    taserMagazine: null, muzzle: null, taserBolt: null, stunAura: null,
    marker: null
  };

  function pxWalls() {
    return walls.map(w => ({ x: w.x * width, y: w.y * height, w: w.w * width, h: w.h * height }));
  }

  function loadImage(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
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
    assets.muzzle = await loadImage("assets/sprites/vfx/muzzle.png");
    assets.taserBolt = await loadImage("assets/sprites/vfx/taser_bolt.png");
    assets.stunAura = await loadImage("assets/sprites/vfx/stun_aura.png");
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
    canvas.width = innerWidth;
    canvas.height = innerHeight;
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
    for (const wall of pxWalls()) if (circleRectCollision(x, y, r, wall)) return true;
    for (const d of decorations) {
      if (!d.solid) continue;
      const rect = { x: d.x - d.w * 0.35, y: d.y - d.h * 0.2, w: d.w * 0.7, h: d.h * 0.5 };
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

  function placeDecorations() {
    decorations = [];
    if (!assets.mapObjects.length) return;
    const pool = assets.mapObjects.slice().sort(() => Math.random() - 0.5);
    const count = Math.min(12, pool.length);
    for (let i = 0; i < count; i++) {
      const img = pool[i];
      const p = randomFreePosition(36);
      const targetH = 52 + Math.random() * 34;
      const scale = targetH / img.height;
      decorations.push({
        img, x: p.x, y: p.y,
        w: img.width * scale, h: img.height * scale,
        solid: true
      });
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
        x: p.x, y: p.y, radius: 18,
        speed: 0.55 + Math.random() * 0.45,
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
      if (!blocked(tx, ty, e.radius + 2)) break;
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

  function moveEntity(entity, dx, dy, speed, r) {
    const len = Math.hypot(dx, dy);
    if (!len) return;
    const mx = dx / len * speed, my = dy / len * speed;
    if (!blocked(entity.x + mx, entity.y, r)) entity.x += mx;
    if (!blocked(entity.x, entity.y + my, r)) entity.y += my;
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
    moveEntity(player, dx, dy, player.speed, player.radius);
  }

  function lineHitsWall(x1, y1, x2, y2) {
    const d = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(d / 8));
    const ws = pxWalls();
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
      if (dPlayer > 90) moveEntity(e, dx, dy, e.speed, e.radius);
      e.shootCooldown--;
      if (dPlayer < 400 && dPlayer > 70 && e.shootCooldown <= 0 && !lineHitsWall(e.x, e.y, player.x, player.y)) {
        enemyShoot(e);
        e.shootCooldown = 70 + Math.floor(Math.random() * 55);
      }
    }
  }

  function updateBullets() {
    const ws = pxWalls();
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.x += b.vx; b.y += b.vy; b.life--;
      let hitWall = false;
      for (const w of ws) if (circleRectCollision(b.x, b.y, b.radius, w)) { hitWall = true; break; }
      if (hitWall || b.life <= 0) { enemyBullets.splice(i, 1); continue; }
      if (Math.hypot(b.x - player.x, b.y - player.y) < b.radius + player.radius) {
        enemyBullets.splice(i, 1);
        player.health = Math.max(0, player.health - 10);
        updateHUD();
        setMessage("💥 נפגעת מכדור! ‎-10 חיים");
        if (player.health <= 0) {
          gameOver = true;
          setMessage("💀 נפלת במשימה — לחץ משחק חדש");
        }
      }
    }
  }

  function useTaser() {
    if (gameOver || won) return;
    if (player.reloading) { setMessage("🔄 עדיין טוען..."); return; }
    if (!player.ready) { setMessage("🔄 חובה לטעון מחדש עם R"); return; }
    if (player.ammo <= 0) { setMessage("⚠️ אין יריות! מצא מחסנית"); return; }
    let target = null, closest = 230;
    for (const e of enemies) {
      if (e.state !== "active") continue;
      const d = Math.hypot(e.x - player.x, e.y - player.y);
      if (d < closest && !lineHitsWall(player.x, player.y, e.x, e.y)) {
        closest = d; target = e;
      }
    }
    if (!target) { setMessage("אין אויב בטווח הטייזר"); return; }
    target.state = "stunned";
    target.stunUntil = performance.now() + 1000;
    player.ammo--;
    player.ready = false;
    player.facing = facingFromDelta(target.x - player.x, target.y - player.y);
    taserLines.push({
      x1: player.x, y1: player.y, x2: target.x, y2: target.y,
      life: 10, target
    });
    score += 25;
    updateHUD();
    setMessage(player.ammo > 0 ? "⚡ נוטרל! עכשיו R לטעינה" : "⚡ ירייה אחרונה — מצא מחסנית");
  }

  function reloadTaser() {
    if (gameOver || won || player.reloading) return;
    if (player.ready) { setMessage("הטייזר כבר מוכן"); return; }
    if (player.ammo <= 0) { setMessage("⚠️ אין תחמושת — מצא מחסנית"); return; }
    player.reloading = true;
    player.reloadStart = performance.now();
    player.reloadEnd = player.reloadStart + 500;
    updateHUD();
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
        updateHUD();
        setMessage(arrested === enemies.length
          ? "🏆 כולם נעצרו — המשימה הושלמה!"
          : "👮 אויב נעצר!");
        if (arrested === enemies.length) {
          won = true;
          score += 500;
          updateHUD();
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
      setMessage("🔋 מחסנית! 5 יריות זמינות");
      placePickup();
    }
  }

  function checkMission() {
    // win happens on last arrest — no map flag zone
  }

  function setMessage(t) { document.getElementById("message").textContent = t; }

  function updateHUD() {
    document.getElementById("health").textContent = player.health;
    document.getElementById("healthBar").style.width = player.health + "%";
    document.getElementById("ammo").textContent = player.ammo;
    document.getElementById("arrested").textContent = arrested;
    document.getElementById("score").textContent = score;
    document.getElementById("reloadState").textContent =
      player.reloading ? "טוען..." : player.ready ? "מוכן" : player.ammo > 0 ? "צריך R" : "ריק";
    const bolts = document.getElementById("ammoBolts");
    bolts.textContent = "⚡".repeat(player.ammo) + "·".repeat(Math.max(0, player.maxAmmo - player.ammo));
  }

  function drawShadow(x, y, rx, ry, dark) {
    ctx.save();
    ctx.fillStyle = dark ? "rgba(0, 0, 0, 0.62)" : "rgba(28, 48, 22, 0.45)";
    ctx.beginPath();
    ctx.ellipse(x, y + ry * 0.35, rx, ry * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
    // One clean concrete piece per wall — no stacking / walls-inside-walls
    const img = assets.wallBlock || assets.wallH || assets.wallV;
    if (!img) {
      ctx.fillStyle = "#6b6f76";
      ctx.fillRect(w.x, w.y, w.w, w.h);
      return;
    }

    const horizontal = w.w >= w.h;
    let dw, dh, dx, dy;
    if (horizontal) {
      dh = Math.max(w.h * 2.1, 44);
      dw = Math.max(w.w * 1.05, dh * (img.width / img.height) * 0.85);
      dx = w.x + w.w / 2 - dw / 2;
      dy = w.y + w.h - dh + 8;
    } else {
      dw = Math.max(w.w * 2.2, 40);
      dh = Math.max(w.h * 1.15, dw * (img.height / img.width) * 0.9);
      dx = w.x + w.w / 2 - dw / 2;
      dy = w.y + w.h - dh + 6;
    }

    // darker black shadow under the wall
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.beginPath();
    ctx.ellipse(w.x + w.w / 2 + 4, w.y + w.h + 2, Math.max(w.w, dw) * 0.42, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.drawImage(img, dx, dy, dw, dh);
  }

  function drawSpriteCentered(img, x, y, targetH) {
    if (!img) return false;
    const scale = targetH / img.height;
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
    return true;
  }

  function drawPlayer() {
    drawShadow(player.x, player.y, 16, 14);
    const img = assets.player[player.facing] || assets.player.down;
    drawSpriteCentered(img, player.x, player.y, 58);
  }

  function drawEnemy(e) {
    if (e.state === "arrested") ctx.globalAlpha = 0.45;
    drawShadow(e.x, e.y, 15, 13);
    const img = assets.enemy[e.facing] || assets.enemy.down;
    drawSpriteCentered(img, e.x, e.y, 52);
    ctx.globalAlpha = 1;

    if (e.state === "active" && assets.marker) {
      const mh = 16;
      const mw = assets.marker.width * (mh / assets.marker.height);
      ctx.drawImage(assets.marker, e.x - mw / 2, e.y - 42, mw, mh);
    }
    if (e.state === "stunned") {
      if (assets.stunAura) {
        ctx.globalAlpha = 0.75;
        drawSpriteCentered(assets.stunAura, e.x, e.y, 70);
        ctx.globalAlpha = 1;
      }
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
    drawShadow(pickup.x, pickup.y, 18, 12);
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

  function drawTaser() {
    for (const l of taserLines) {
      if (assets.taserBolt) {
        const dx = l.x2 - l.x1, dy = l.y2 - l.y1;
        const len = Math.hypot(dx, dy) || 1;
        const ang = Math.atan2(dy, dx);
        ctx.save();
        ctx.translate(l.x1, l.y1);
        ctx.rotate(ang);
        ctx.globalAlpha = Math.min(1, l.life / 6);
        ctx.drawImage(assets.taserBolt, 0, -14, len, 28);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.moveTo(l.x1, l.y1);
        ctx.lineTo(l.x2, l.y2);
        ctx.strokeStyle = "#00eaff";
        ctx.lineWidth = 4;
        ctx.stroke();
      }
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
    items.push({ footY: player.y + player.radius * 0.9, kind: "player" });
    items.sort((a, b) => a.footY - b.footY || (a.kind === "enemy" || a.kind === "player" ? 1 : 0));

    for (const it of items) {
      if (it.kind === "wall") drawWallSprite(it.w);
      else if (it.kind === "deco") {
        // soft grass-colored shadow only (sprite pale shadows already stripped)
        drawShadow(it.d.x, it.d.y + it.d.h * 0.28, it.d.w * 0.26, it.d.h * 0.16);
        ctx.drawImage(it.d.img, it.d.x - it.d.w / 2, it.d.y - it.d.h / 2, it.d.w, it.d.h);
      } else if (it.kind === "enemy") drawEnemy(it.e);
      else if (it.kind === "pickup") drawPickup();
      else if (it.kind === "player") drawPlayer();
    }
  }

  function drawMinimap() {
    const mw = minimap.width, mh = minimap.height;
    mctx.clearRect(0, 0, mw, mh);
    mctx.fillStyle = "#1a2a1a";
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
      ctx.fillStyle = "rgba(0,0,0,.28)";
      ctx.fillRect(0, 0, width, height);
    }
  }

  function update() {
    movePlayer();
    updateEnemies();
    updateBullets();
    updateReload();
    updatePickup();
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
    player.y = height * 0.55;
    player.health = 100;
    player.ammo = 5;
    player.ready = true;
    player.reloading = false;
    player.facing = "down";
    score = 0; arrested = 0;
    enemyBullets = []; taserLines = []; flashes = [];
    gameOver = false; won = false;
    createEnemies();
    placeDecorations();
    placePickup();
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
    held[e.code] = true;
    if (e.code === "Space") { e.preventDefault(); useTaser(); }
    if (e.code === "KeyE") arrestEnemy();
    if (e.code === "KeyR") reloadTaser();
  });
  addEventListener("keyup", e => { held[e.code] = false; });

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
