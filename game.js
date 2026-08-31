/* מבצע בסיס — standalone (PC + mobile), no Apps Script */
(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  let width = 0, height = 0;
  let score = 0, arrested = 0, gameOver = false, won = false;
  let enemies = [], enemyBullets = [], taserLines = [], decorations = [];
  const held = {};

  const player = {
    x: 100, y: 350, radius: 22, speed: 4.2,
    health: 100, ammo: 5, maxAmmo: 5,
    ready: true, reloading: false, reloadStart: 0, reloadEnd: 0,
    facing: "down", moving: false
  };
  const pickup = { x: 0, y: 0, radius: 28, active: true };
  const mission = { x: 0, y: 0, w: 110, h: 110 };

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
    enemies: [],
    mapObjects: [],
    taserMagazine: null,
    medkit: null,
    ground: null,
    wall: null,
    container: null
  };

  function pxWalls() {
    return walls.map(w => ({ x: w.x * width, y: w.y * height, w: w.w * width, h: w.h * height }));
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function loadAssets() {
    let manifest;
    try {
      manifest = await fetch("assets/manifest.json").then(r => r.json());
    } catch {
      manifest = {
        player: {
          up: "assets/player/up.png",
          down: "assets/player/down.png",
          left: "assets/player/left.png",
          right: "assets/player/right.png"
        },
        sprites: { taser_magazine: "assets/sprites/taser_magazine.png", medkit: "assets/sprites/medkit.png" },
        enemies: [],
        mapObjects: []
      };
    }

    const p = manifest.player || {};
    assets.player.up = await loadImage(p.up);
    assets.player.down = await loadImage(p.down);
    assets.player.left = await loadImage(p.left);
    assets.player.right = await loadImage(p.right);

    const spr = manifest.sprites || {};
    assets.taserMagazine = await loadImage(spr.taser_magazine || "assets/sprites/taser_magazine.png");
    assets.medkit = await loadImage(spr.medkit || "assets/sprites/medkit.png");
    assets.ground = await loadImage(spr.ground_grass);
    assets.wall = await loadImage(spr.wall_h);
    assets.container = await loadImage(spr.container);

    assets.enemies = [];
    for (const src of (manifest.enemies || [])) {
      const img = await loadImage(src);
      if (img) assets.enemies.push(img);
    }

    assets.mapObjects = [];
    const objs = (manifest.obstacles && manifest.obstacles.length)
      ? manifest.obstacles
      : (manifest.mapObjects || []).slice(0, 24);
    const loaded = await Promise.all(objs.map(loadImage));
    for (const img of loaded) {
      if (img && img.width >= 24 && img.height >= 24) {
        assets.mapObjects.push(img);
      }
    }
  }

  function resize() {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    width = canvas.width;
    height = canvas.height;
    mission.x = width - 145;
    mission.y = height - 145;
  }

  function circleRectCollision(x, y, r, rect) {
    const cx = Math.max(rect.x, Math.min(x, rect.x + rect.w));
    const cy = Math.max(rect.y, Math.min(y, rect.y + rect.h));
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy < r * r;
  }

  function blocked(x, y, r) {
    if (x < r || y < r || x > width - r || y > height - r) return true;
    for (const wall of pxWalls()) if (circleRectCollision(x, y, r, wall)) return true;
    for (const d of decorations) {
      if (!d.solid) continue;
      const rect = { x: d.x - d.w * 0.35, y: d.y - d.h * 0.25, w: d.w * 0.7, h: d.h * 0.55 };
      if (circleRectCollision(x, y, r, rect)) return true;
    }
    return false;
  }

  function validSpawn(x, y, r = 28) {
    if (blocked(x, y, r)) return false;
    if (Math.hypot(x - player.x, y - player.y) < 160) return false;
    if (x > mission.x - 30 && y > mission.y - 30) return false;
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
    const count = Math.min(14, assets.mapObjects.length);
    const pool = assets.mapObjects.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let i = 0; i < count; i++) {
      const img = pool[i];
      const p = randomFreePosition(34);
      // keep readable size — new cartoon sheet is high-res
      const targetH = 48 + Math.random() * 36;
      const scale = targetH / img.height;
      decorations.push({
        img, x: p.x, y: p.y,
        w: img.width * scale, h: img.height * scale,
        solid: true
      });
    }
  }

  function createEnemies() {
    enemies = [];
    for (let i = 0; i < 6; i++) {
      const p = randomFreePosition(22);
      enemies.push({
        x: p.x, y: p.y, radius: 20,
        speed: 0.75 + Math.random() * 0.3,
        state: "active", stunUntil: 0,
        shootCooldown: 35 + Math.floor(Math.random() * 80),
        direction: 0,
        sprite: assets.enemies.length
          ? assets.enemies[Math.floor(Math.random() * assets.enemies.length)]
          : null,
        skin: {
          body: ["#3a3a3a", "#5a4a2a", "#2f4a2f", "#4a1a1a", "#1a2a4a"][i % 5],
          vest: "#222", helmet: "#111", skin: "#c99770", weapon: "#000"
        }
      });
    }
    document.getElementById("enemyTotal").textContent = enemies.length;
  }

  function moveEntity(entity, dx, dy, speed, r) {
    const len = Math.hypot(dx, dy);
    if (!len) return;
    const mx = dx / len * speed, my = dy / len * speed;
    if (!blocked(entity.x + mx, entity.y, r)) entity.x += mx;
    if (!blocked(entity.x, entity.y + my, r)) entity.y += my;
  }

  function facingFromDelta(dx, dy) {
    if (!dx && !dy) return player.facing;
    if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
    return dy < 0 ? "up" : "down";
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
      const dx = player.x - e.x, dy = player.y - e.y, d = Math.hypot(dx, dy);
      e.direction = Math.atan2(dy, dx);
      if (d < 650 && d > 150) moveEntity(e, dx, dy, e.speed, e.radius);
      e.shootCooldown--;
      if (d < 400 && d > 70 && e.shootCooldown <= 0 && !lineHitsWall(e.x, e.y, player.x, player.y)) {
        enemyShoot(e);
        e.shootCooldown = 70 + Math.floor(Math.random() * 60);
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
    if (player.ammo <= 0) { setMessage("⚠️ אין יריות! צריך להגיע למחסנית"); return; }
    let target = null, closest = 220;
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
    // Face the shot
    player.facing = facingFromDelta(target.x - player.x, target.y - player.y);
    taserLines.push({ x1: player.x, y1: player.y, x2: target.x, y2: target.y, life: 8 });
    score += 25;
    updateHUD();
    setMessage(player.ammo > 0 ? "⚡ נוטרל! עכשיו R לטעינה מחדש" : "⚡ ירייה אחרונה! צריך למצוא מחסנית");
  }

  function reloadTaser() {
    if (gameOver || won) return;
    if (player.reloading) return;
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
      if (Math.hypot(e.x - player.x, e.y - player.y) < 60) {
        e.state = "arrested";
        arrested++;
        score += 100;
        updateHUD();
        setMessage(arrested === enemies.length
          ? "✅ כולם נעצרו! הגיע לנקודת המשימה"
          : "👮 אויב נעצר!");
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
      setMessage("🔋 מצאת מחסנית — 5 יריות זמינות!");
      placePickup();
    }
  }

  function checkMission() {
    if (arrested !== enemies.length || won) return;
    if (player.x > mission.x && player.x < mission.x + mission.w &&
        player.y > mission.y && player.y < mission.y + mission.h) {
      won = true;
      score += 500;
      updateHUD();
      setMessage("🏆 המשימה הושלמה!");
    }
  }

  function setMessage(t) { document.getElementById("message").textContent = t; }

  function updateHUD() {
    document.getElementById("health").textContent = player.health;
    document.getElementById("ammo").textContent = player.ammo;
    document.getElementById("arrested").textContent = arrested;
    document.getElementById("score").textContent = score;
    document.getElementById("reloadState").textContent =
      player.reloading ? "טוען..." : player.ready ? "מוכן" : player.ammo > 0 ? "צריך R" : "ריק";
  }

  function drawGround() {
    // Solid grass base — sheet ground crops often include labels/UI, so keep simple.
    ctx.fillStyle = "#5f7f45";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(0,0,0,.08)";
    for (let x = 0; x < width; x += 64) {
      for (let y = 0; y < height; y += 64) {
        if (((x / 64) + (y / 64)) % 2 === 0) ctx.fillRect(x, y, 64, 64);
      }
    }
    ctx.strokeStyle = "rgba(255,255,255,.05)";
    for (let x = 0; x < width; x += 50) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y < height; y += 50) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
  }

  function drawDecorations() {
    for (const d of decorations) {
      ctx.globalAlpha = 0.92;
      ctx.drawImage(d.img, d.x - d.w / 2, d.y - d.h / 2, d.w, d.h);
      ctx.globalAlpha = 1;
    }
  }

  function drawWalls() {
    for (const w of pxWalls()) {
      if (assets.wall) {
        // tile wall sprite into rect
        const tw = Math.max(24, Math.min(w.w, assets.wall.width));
        const th = Math.max(24, Math.min(w.h, assets.wall.height));
        for (let x = w.x; x < w.x + w.w; x += tw) {
          for (let y = w.y; y < w.y + w.h; y += th) {
            const dw = Math.min(tw, w.x + w.w - x);
            const dh = Math.min(th, w.y + w.h - y);
            ctx.drawImage(assets.wall, 0, 0, dw, dh, x, y, dw, dh);
          }
        }
      } else {
        ctx.fillStyle = "#303842";
        ctx.fillRect(w.x, w.y, w.w, w.h);
      }
      ctx.strokeStyle = "#71808d";
      ctx.lineWidth = 2;
      ctx.strokeRect(w.x, w.y, w.w, w.h);
    }
  }

  function drawMission() {
    ctx.fillStyle = arrested === enemies.length ? "#ffd600" : "#907c2c";
    ctx.fillRect(mission.x, mission.y, mission.w, mission.h);
    ctx.strokeStyle = "#ffe566";
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(mission.x + 4, mission.y + 4, mission.w - 8, mission.h - 8);
    ctx.setLineDash([]);
    ctx.fillStyle = "#111";
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "center";
    ctx.fillText("משימה", mission.x + mission.w / 2, mission.y + mission.h / 2);
  }

  function drawSpriteCentered(img, x, y, targetH) {
    if (!img) return false;
    const scale = targetH / img.height;
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
    return true;
  }

  function drawPlayer() {
    const img = assets.player[player.facing] || assets.player.down || assets.player.up;
    if (!drawSpriteCentered(img, player.x, player.y, 56)) {
      // fallback vector
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.fillStyle = "#326ca8";
      ctx.beginPath(); ctx.ellipse(0, 5, 14, 20, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#183c60"; ctx.fillRect(-11, -4, 22, 16);
      ctx.fillStyle = "#d7aa7d"; ctx.beginPath(); ctx.arc(0, -13, 9, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawEnemy(e) {
    if (e.state === "arrested") ctx.globalAlpha = 0.5;
    const drawn = e.sprite && drawSpriteCentered(e.sprite, e.x, e.y, 50);
    if (!drawn) {
      const s = e.skin;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.direction + Math.PI / 2);
      ctx.fillStyle = s.body;
      ctx.fillRect(-11, 9, 8, 15); ctx.fillRect(3, 9, 8, 15);
      ctx.beginPath(); ctx.ellipse(0, 2, 15, 20, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = s.vest; ctx.fillRect(-12, -5, 24, 19);
      ctx.fillStyle = s.skin; ctx.beginPath(); ctx.arc(0, -17, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = s.helmet; ctx.beginPath(); ctx.arc(0, -19, 10, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillStyle = s.weapon; ctx.fillRect(8, -15, 4, 30);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (e.state === "stunned") {
      ctx.fillStyle = "#00e5ff";
      ctx.font = "25px Arial";
      ctx.textAlign = "center";
      ctx.fillText("⚡", e.x, e.y - 34);
    }
    if (e.state === "arrested") {
      ctx.font = "20px Arial";
      ctx.textAlign = "center";
      ctx.fillText("🔒", e.x, e.y - 30);
    }
  }

  function drawBullets() {
    for (const b of enemyBullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fillStyle = "#ffd800";
      ctx.fill();
      ctx.strokeStyle = "#ff9d00";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function drawTaser() {
    for (const l of taserLines) {
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y2);
      ctx.strokeStyle = "#00eaff";
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }

  function drawPickup() {
    if (!pickup.active) return;
    if (assets.taserMagazine) {
      ctx.save();
      ctx.shadowColor = "#ffe600";
      ctx.shadowBlur = 18;
      drawSpriteCentered(assets.taserMagazine, pickup.x, pickup.y, 52);
      ctx.restore();
      return;
    }
    ctx.fillStyle = "#ffd600";
    ctx.fillRect(pickup.x - 18, pickup.y - 14, 36, 28);
    ctx.fillStyle = "#111";
    ctx.fillRect(pickup.x - 14, pickup.y - 10, 20, 20);
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    drawGround();
    drawMission();
    drawDecorations();
    drawWalls();
    drawPickup();
    enemies.forEach(drawEnemy);
    drawBullets();
    drawTaser();
    drawPlayer();
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
  }

  function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
  }

  function restartGame() {
    player.x = 100;
    player.y = height / 2;
    player.health = 100;
    player.ammo = 5;
    player.ready = true;
    player.reloading = false;
    player.facing = "down";
    score = 0; arrested = 0;
    enemyBullets = []; taserLines = [];
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
    mission.x = width - 145;
    mission.y = height - 145;
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
