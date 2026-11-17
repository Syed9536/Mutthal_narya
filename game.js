const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

// ================= SETTINGS =================
// 'drag'  = video jaisa: ungli jis taraf kheechi, line uski ulti taraf jati hai (ungli bed ke niche rakh ke khencho)
// 'point' = line seedha ungli/cursor ki taraf jati hai
const AIM_MODE = 'drag';
const FLY_SPEED = [0.0030, 0.0042]; // screen width per frame
const GRAVITY = 0.00028;            // screen height per frame^2
const RESPAWN_FRAMES = 70;

// ================= SIZE (sab kuch screen height ke hisaab se) =================
let W, H, U; // U = screen height ka 1/1000
const bed = { x: 0, y: 0 };

function resize() {
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  W = canvas.width;
  H = canvas.height;
  U = Math.min(H / 1000, W / 480);
  bed.x = W * 0.5;
  bed.y = H * 0.78; // bed ke pairon ki line
}
resize();
addEventListener('resize', resize);

// ================= ASSETS =================
function loadImg(src) {
  const i = new Image();
  i.src = src;
  return i;
}
const bedFace = loadImg('assets/bed.png');
const flyFaceFiles = [
  'assets/fly1.png',
  'assets/fly2.png',
  'assets/fly3.png',
  'assets/fly4.png',
  'assets/fly5.png'
];
const flyFaces = flyFaceFiles.map(loadImg);
const fallbackColors = ['#d9a577', '#c68642', '#8d5524', '#f1c27d', '#e0ac69'];

const hitSound = new Audio('assets/hit.mp3'); // bed wale ki voice (baad me)
function playHit() {
  try {
    hitSound.currentTime = 0;
    hitSound.play().catch(() => {});
  } catch (e) {}
}

// ================= STATE =================
let enemy = null;
let respawnTimer = 0;
let score = 0;
let best = 0;
try { best = Number(localStorage.getItem('best')) || 0; } catch (e) {}
let frame = 0;
let bedShake = 0;

const ragdolls = [];
const particles = [];
const rings = [];
const popups = [];
const tracers = [];

const aim = { active: false, sx: 0, sy: 0, x: 0, y: 0, angle: -Math.PI / 2 };

// ================= FIGURE (video wala character) =================
// Sab points head ke center se U units me, right-facing. dir=-1 pe mirror hota hai.
const FLY = {
  sh: [-10, 44], hip: [-24, 58],
  arm1: [[40, 29], [60, 10]],
  arm2: [[-45, 53], [-74, 59]],
  leg1: [[-51, 73], [-95, 89]],
  leg2: [[-51, 91], [-80, 104]]
};
const SPLAY = {
  sh: [-4, 44], hip: [10, 64],
  arm1: [[30, 30], [54, 8]],
  arm2: [[-40, 50], [-78, 40]],
  leg1: [[40, 84], [66, 100]],
  leg2: [[-24, 88], [-46, 112]]
};
const FACE_RX = 29;
const FACE_RY = 42;

function sway(base, t, ph) {
  const o = (i, a) => [Math.sin(t / 16 + ph + i) * a, Math.cos(t / 19 + ph + i * 1.3) * a];
  const add = (p, i, a) => { const d = o(i, a); return [p[0] + d[0], p[1] + d[1]]; };
  return {
    sh: base.sh, hip: base.hip,
    arm1: [add(base.arm1[0], 1, 3), add(base.arm1[1], 2, 5)],
    arm2: [add(base.arm2[0], 3, 3), add(base.arm2[1], 4, 5)],
    leg1: [add(base.leg1[0], 5, 3), add(base.leg1[1], 6, 5)],
    leg2: [add(base.leg2[0], 7, 3), add(base.leg2[1], 8, 5)]
  };
}

// pose -> local pixel points
function makeFigure(pose, dir) {
  const f = p => ({ x: p[0] * dir * U, y: p[1] * U });
  const sh = f(pose.sh), hip = f(pose.hip);
  const a1 = pose.arm1.map(f), a2 = pose.arm2.map(f);
  const l1 = pose.leg1.map(f), l2 = pose.leg2.map(f);
  return {
    segs: [
      [sh, hip],
      [sh, a1[0], a1[1]],
      [sh, a2[0], a2[1]],
      [hip, l1[0], l1[1]],
      [hip, l2[0], l2[1]]
    ],
    hands: [a1, a2],
    feet: [l1, l2]
  };
}

function drawFaceEllipse(img, rx, ry, fallback, tint, tilt) {
  ctx.save();
  ctx.rotate(tilt || 0);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  if (img && img.complete && img.naturalWidth > 0) {
    const ar = rx / ry;
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    if (sw / sh > ar) { const nw = sh * ar; sx = (sw - nw) / 2; sw = nw; }
    else { const nh = sw / ar; sy = (sh - nh) / 2; sh = nh; }
    ctx.drawImage(img, sx, sy, sw, sh, -rx, -ry, rx * 2, ry * 2);
  } else {
    ctx.fillStyle = fallback;
    ctx.fillRect(-rx, -ry, rx * 2, ry * 2);
  }
  if (tint > 0) {
    ctx.fillStyle = 'rgba(225,45,35,' + tint + ')';
    ctx.fillRect(-rx, -ry, rx * 2, ry * 2);
  }
  ctx.restore();
}

// ctx pehle se head center pe translate/rotate hona chahiye
function drawFigure(fig, faceImg, fallback, tint, faceTilt, shakeLines, t) {
  ctx.save();
  ctx.strokeStyle = '#111';
  ctx.fillStyle = '#111';
  ctx.lineWidth = 6 * U;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  fig.segs.forEach(seg => {
    ctx.beginPath();
    ctx.moveTo(seg[0].x, seg[0].y);
    for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i].x, seg[i].y);
    ctx.stroke();
  });

  // hands = gol
  fig.hands.forEach(h => {
    const p = h[1];
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9 * U, 0, Math.PI * 2);
    ctx.fill();
  });
  // feet = oval (limb ki direction me)
  fig.feet.forEach(l => {
    const p = l[1], q = l[0];
    const a = Math.atan2(p.y - q.y, p.x - q.x);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 11 * U, 7.5 * U, a, 0, Math.PI * 2);
    ctx.fill();
  });

  // hit ke baad hilne wali chhoti lines
  if (shakeLines && t % 8 < 5) {
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1.8 * U;
    fig.hands.concat(fig.feet).forEach(l => {
      const p = l[1], q = l[0];
      const a = Math.atan2(p.y - q.y, p.x - q.x);
      [15, 20].forEach(r => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * U, a - 0.5, a + 0.5);
        ctx.stroke();
      });
    });
  }
  ctx.restore();

  drawFaceEllipse(faceImg, FACE_RX * U, FACE_RY * U, fallback, tint, faceTilt);
}

// ================= ENEMY =================
function spawnEnemy() {
  const dir = Math.random() < 0.5 ? 1 : -1;
  enemy = {
    dir,
    x: dir === 1 ? -160 * U : W + 160 * U,
    y0: H * (0.24 + Math.random() * 0.14),
    y: 0,
    speed: W * (FLY_SPEED[0] + Math.random() * (FLY_SPEED[1] - FLY_SPEED[0])),
    phase: Math.random() * 10,
    faceIdx: Math.floor(Math.random() * flyFaces.length),
    fig: null
  };
}

function updateEnemy() {
  const e = enemy;
  e.x += e.speed * e.dir;
  e.y = e.y0 + Math.sin(frame / 40 + e.phase) * 16 * U + Math.sin(frame / 120 + e.phase * 1.7) * 20 * U;
  e.fig = makeFigure(sway(FLY, frame, e.phase), e.dir);
  const gone = (e.dir === 1 && e.x > W + 170 * U) || (e.dir === -1 && e.x < -170 * U);
  if (gone) enemy = null;
}

// ================= SHOOTING (hitscan) =================
function muzzle() {
  return { x: bed.x - 70 * U, y: bed.y - 150 * U };
}

function distPtSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function rayLength(ox, oy, dx, dy) {
  const tx = dx > 0 ? (W - ox) / dx : dx < 0 ? -ox / dx : Infinity;
  const ty = dy > 0 ? (H - oy) / dy : dy < 0 ? -oy / dy : Infinity;
  return Math.min(tx, ty);
}

// poori body check: head + torso + haath + pair
function rayHitEnemy(ox, oy, dx, dy, tmax) {
  const e = enemy;
  for (let t = 0; t <= tmax; t += 4 * U) {
    const px = ox + dx * t, py = oy + dy * t;
    const ex = (px - e.x) / ((FACE_RX + 8) * U);
    const ey = (py - e.y) / ((FACE_RY + 8) * U);
    if (ex * ex + ey * ey <= 1) return t;
    for (const seg of e.fig.segs) {
      for (let i = 0; i < seg.length - 1; i++) {
        const d = distPtSeg(px, py, e.x + seg[i].x, e.y + seg[i].y, e.x + seg[i + 1].x, e.y + seg[i + 1].y);
        if (d <= 13 * U) return t;
      }
    }
  }
  return -1;
}

function fire() {
  const m = muzzle();
  const dx = Math.cos(aim.angle), dy = Math.sin(aim.angle);
  const tmax = rayLength(m.x, m.y, dx, dy);
  let tEnd = tmax;
  if (enemy) {
    const t = rayHitEnemy(m.x, m.y, dx, dy, tmax);
    if (t >= 0) {
      tEnd = t;
      knockOut(m.x + dx * t, m.y + dy * t);
    }
  }
  tracers.push({ x0: m.x, y0: m.y, x1: m.x + dx * tEnd, y1: m.y + dy * tEnd, life: 8 });
}

function knockOut(hx, hy) {
  const e = enemy;
  ragdolls.push({
    x: e.x, y: e.y, vx: e.speed * e.dir * 0.25, vy: 0,
    t: 0, hold: 6, alpha: 1, dir: e.dir, faceIdx: e.faceIdx,
    fig: makeFigure(SPLAY, e.dir)
  });

  rings.push({ x: hx, y: hy, life: 14 });
  popups.push({ x: e.x + 30 * U, y: e.y - 55 * U, life: 55 });

  const colors = ['#777', '#999', '#d9534f', '#f0a050', '#e8b88a', '#333'];
  for (let i = 0; i < 24; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (0.5 + Math.random() * 3) * U * 1.6;
    particles.push({
      x: hx, y: hy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 40 + Math.random() * 25, max: 65,
      r: (1.5 + Math.random() * 2.2) * U,
      color: colors[Math.floor(Math.random() * colors.length)]
    });
  }

  enemy = null;
  respawnTimer = 0;
  score++;
  if (score > best) {
    best = score;
    try { localStorage.setItem('best', best); } catch (e2) {}
  }
  bedShake = 28;
  playHit();
}

// ================= UPDATE =================
function update() {
  frame++;

  if (!enemy) {
    respawnTimer++;
    if (respawnTimer > RESPAWN_FRAMES) {
      spawnEnemy();
      respawnTimer = 0;
    }
  }
  if (enemy) updateEnemy();

  // girte hue characters
  const fadeY = bed.y - 200 * U;
  for (let i = ragdolls.length - 1; i >= 0; i--) {
    const r = ragdolls[i];
    r.t++;
    if (r.t > r.hold) {
      r.vy += GRAVITY * H;
      r.y += r.vy;
      r.x += r.vx;
      r.vx *= 0.99;
    }
    if (r.y > fadeY) r.alpha -= 0.07;
    if (r.alpha <= 0 || r.y > H + 200 * U) ragdolls.splice(i, 1);
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.94; p.vy = p.vy * 0.94 + 0.05 * U;
    if (--p.life <= 0) particles.splice(i, 1);
  }
  for (let i = rings.length - 1; i >= 0; i--) if (--rings[i].life <= 0) rings.splice(i, 1);
  for (let i = popups.length - 1; i >= 0; i--) {
    popups[i].y -= 0.25 * U;
    if (--popups[i].life <= 0) popups.splice(i, 1);
  }
  for (let i = tracers.length - 1; i >= 0; i--) if (--tracers[i].life <= 0) tracers.splice(i, 1);
  if (bedShake > 0) bedShake--;
}

// ================= DRAW: BED =================
// zoom-coordinates (reference video ke bed ke) -> screen
function bp(zx, zy) {
  return [bed.x + (zx - 687) * 0.585 * U, bed.y + (zy - 495) * 0.585 * U];
}
function poly(pts, fill, stroke, lw) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const q = bp(p[0], p[1]);
    if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
  });
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw * 0.585 * U; ctx.stroke(); }
}
function polyline(pts, color, lw) {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const q = bp(p[0], p[1]);
    if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = lw * 0.585 * U;
  ctx.stroke();
}
function dot(zx, zy, r) {
  const q = bp(zx, zy);
  ctx.beginPath();
  ctx.arc(q[0], q[1], r * 0.585 * U, 0, Math.PI * 2);
  ctx.fill();
}

function drawBed() {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // headboard frame + inner panel
  polyline([[378, 432], [366, 180], [588, 72], [596, 198]], '#111', 14);
  poly([[398, 212], [574, 128], [580, 240], [402, 330]], '#4a4a4a', '#111', 8);
  polyline([[380, 378], [470, 392]], '#111', 9);

  // legs
  ctx.fillStyle = '#111';
  poly([[376, 385], [418, 385], [416, 440], [380, 440]], '#111');
  poly([[858, 460], [895, 455], [895, 497], [862, 497]], '#111');
  poly([[975, 405], [1002, 400], [1000, 440], [978, 440]], '#111');

  // mattress
  poly([[585, 240], [700, 213], [1012, 275], [897, 385], [555, 350]], '#9b9b9b', '#111', 7);
  poly([[555, 350], [897, 385], [893, 448], [760, 455], [640, 430], [560, 412]], '#8c8c8c', '#111', 7);
  poly([[897, 385], [1012, 275], [1008, 338], [942, 438], [893, 448]], '#7b7b7b', '#111', 7);

  // blanket
  poly([[598, 222], [652, 188], [692, 208], [690, 252], [640, 300], [563, 352], [556, 418], [466, 410], [468, 330], [545, 305]], '#2f4a43', '#1c2e29', 4);

  // lete hue stick body
  polyline([[600, 264], [716, 259]], '#111', 7);
  polyline([[606, 270], [652, 322], [724, 292]], '#111', 7);
  polyline([[724, 292], [910, 322]], '#111', 7);
  polyline([[640, 280], [910, 352]], '#111', 7);
  ctx.fillStyle = '#111';
  dot(912, 322, 9);
  dot(912, 352, 9);

  // face (voice aate waqt hilta hai)
  const f = bp(530, 210);
  ctx.save();
  ctx.translate(f[0], f[1]);
  const shake = bedShake > 0 ? Math.sin(bedShake * 1.3) * 0.12 * (bedShake / 28) : 0;
  drawFaceEllipse(bedFace, 36 * U, 46 * U, '#d9a577', 0, 0.3 + shake);
  ctx.restore();

  ctx.restore();
}

// ================= DRAW: ALL =================
function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ebe5ea';
  ctx.fillRect(0, 0, W, H);

  // score
  ctx.textAlign = 'center';
  ctx.fillStyle = '#222';
  ctx.font = 'bold ' + 34 * U + 'px sans-serif';
  ctx.fillText(score, W / 2, H * 0.1);
  ctx.fillStyle = '#555';
  ctx.font = 'bold ' + 14 * U + 'px sans-serif';
  ctx.fillText('BEST ' + best, W / 2, H * 0.1 + 20 * U);

  drawBed();

  // udta character
  if (enemy) {
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    drawFigure(enemy.fig, flyFaces[enemy.faceIdx], fallbackColors[enemy.faceIdx % fallbackColors.length], 0, 0, false, 0);
    ctx.restore();
  }

  // girta hua character
  ragdolls.forEach(r => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, r.alpha);
    ctx.translate(r.x, r.y);
    const ang = r.dir * (-1.0 + Math.min(r.t, 90) / 90 * 0.6 + Math.sin(r.t * 0.12) * 0.08);
    ctx.rotate(ang);
    const tint = Math.max(0, 0.4 - r.t / 120);
    drawFigure(r.fig, flyFaces[r.faceIdx], fallbackColors[r.faceIdx % fallbackColors.length], tint, -0.4 * r.dir, r.t < 90, r.t);
    ctx.restore();
  });

  // specks
  particles.forEach(p => {
    ctx.globalAlpha = Math.min(1, p.life / 25);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // orange ring
  rings.forEach(r => {
    const k = 1 - r.life / 14;
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = '#f0a050';
    ctx.lineWidth = 2 * U;
    ctx.beginPath();
    ctx.arc(r.x, r.y, (12 + k * 48) * U, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;

  // +1
  popups.forEach(p => {
    ctx.globalAlpha = Math.min(1, p.life / 20);
    ctx.fillStyle = '#8a7f84';
    ctx.font = 'bold ' + 22 * U + 'px sans-serif';
    ctx.fillText('+1', p.x, p.y);
  });
  ctx.globalAlpha = 1;

  // dotted aim line (bed se screen ke kinare tak)
  if (aim.active) {
    const m = muzzle();
    const dx = Math.cos(aim.angle), dy = Math.sin(aim.angle);
    const L = rayLength(m.x, m.y, dx, dy);
    ctx.save();
    ctx.setLineDash([10 * U, 8 * U]);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1.8 * U;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x + dx * L, m.y + dy * L);
    ctx.stroke();
    ctx.restore();
  }

  // orange goli ki line
  tracers.forEach(t => {
    const a = t.life / 8;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,140,60,' + 0.35 * a + ')';
    ctx.lineWidth = 8 * U;
    ctx.beginPath(); ctx.moveTo(t.x0, t.y0); ctx.lineTo(t.x1, t.y1); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,120,40,' + 0.95 * a + ')';
    ctx.lineWidth = 3 * U;
    ctx.beginPath(); ctx.moveTo(t.x0, t.y0); ctx.lineTo(t.x1, t.y1); ctx.stroke();
    ctx.restore();
  });
}

// fixed 60fps logic (120Hz screen pe bhi same speed)
let last = performance.now();
let acc = 0;
function loop(now) {
  acc += Math.min(100, now - last);
  last = now;
  while (acc >= 1000 / 60) { update(); acc -= 1000 / 60; }
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ================= INPUT =================
function clampUp(a) {
  // goli sirf upar ki taraf
  if (a >= -0.15 && a <= Math.PI / 2) return -0.15;
  if (a > Math.PI / 2 || a <= -Math.PI + 0.15) return -Math.PI + 0.15;
  return a;
}

function updateAim() {
  let dx, dy;
  if (AIM_MODE === 'point') {
    const m = muzzle();
    dx = aim.x - m.x; dy = aim.y - m.y;
  } else {
    dx = aim.sx - aim.x; dy = aim.sy - aim.y; // touch start se ulti taraf
  }
  if (Math.hypot(dx, dy) < 8 * U) return;
  aim.angle = clampUp(Math.atan2(dy, dx));
}

canvas.addEventListener('pointerdown', e => {
  aim.active = true;
  aim.sx = aim.x = e.clientX;
  aim.sy = aim.y = e.clientY;
  aim.angle = -Math.PI / 2;
  updateAim();
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', e => {
  if (!aim.active) return;
  aim.x = e.clientX;
  aim.y = e.clientY;
  updateAim();
});

canvas.addEventListener('pointerup', () => {
  if (!aim.active) return;
  aim.active = false;
  fire();
});
canvas.addEventListener('pointercancel', () => { aim.active = false; });