'use strict';

const APP_VERSION = '0.1.0';
const SAVE_KEY = 'lizard-save';
const SAVE_VERSION = 1;
const W = 400, H = 300;                 // 사육장 논리 좌표
const MAX_OFFLINE_MIN = 72 * 60;        // 앱을 꺼둔 시간은 최대 72시간까지만 계산
const FLOOR = { x1: 60, x2: 340, y1: 192, y2: 270 };
const HIDE = { x: 318, y: 206 };
const DISH = { x: 92, y: 252 };
const EGG = { x: 200, y: 232 };

const STAGE_NAME = { egg: '알', baby: '아기', juvenile: '청소년', adult: '어른' };
const STAGE_SCALE = { baby: 0.55, juvenile: 0.78, adult: 1 };

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const $ = (id) => document.getElementById(id);

/* ---------- 저장 / 불러오기 ---------- */

function defaultState() {
  const now = Date.now();
  return {
    v: SAVE_VERSION, name: '', stage: 'egg', eggWarmth: 0, hatchedAt: null, lastTick: now,
    hunger: 70, mood: 70, clean: 100, health: 100, humidity: 50, temp: 26, heater: true,
    poops: [], poopAt: null, shedding: false, shedProgress: 0, shedStart: null, nextShedAt: null,
  };
}

// 저장 형식이 바뀌면 여기서 예전 데이터를 새 형식으로 변환한다 (업데이트해도 도마뱀 유지)
function migrate(s) {
  if (!s || typeof s !== 'object') return defaultState();
  // 예: if (s.v === 1) { s.newField = ...; s.v = 2; }
  return Object.assign(defaultState(), s, { v: SAVE_VERSION });
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? migrate(JSON.parse(raw)) : defaultState();
  } catch (e) { return defaultState(); }
}
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* 저장 불가 환경 */ }
}

let state = load();
const pendingMsgs = [];

/* ---------- 시간 / 텍스트 도우미 ---------- */

function isNight(t = Date.now()) { const h = new Date(t).getHours(); return h >= 20 || h < 7; }
function ageMs() { return state.hatchedAt ? Date.now() - state.hatchedAt : 0; }
function stageFor(ms) { const h = ms / 3.6e6; return h < 24 ? 'baby' : h < 72 ? 'juvenile' : 'adult'; }
function fmtDur(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간`;
  return `${Math.floor(h / 24)}일 ${h % 24}시간`;
}
// 받침 있으면 a(이/은), 없으면 b(가/는)
function josa(word, a, b) {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return b;
  return (c - 0xac00) % 28 ? a : b;
}
const petName = () => state.name || '도마뱀';

/* ---------- 시뮬레이션 (1분 단위) ---------- */

function addPoop() {
  if (state.poops.length >= 5) return;
  state.poops.push({ x: rand(FLOOR.x1, FLOOR.x2), y: rand(FLOOR.y1 + 6, FLOOR.y2) });
  state.clean = clamp(state.clean - 15);
}

function simMinute(t) {
  const s = state;
  const night = isNight(t);
  s.hunger = clamp(s.hunger - (night ? 0.16 : 0.1));
  const target = s.heater ? (night ? 27 : 31) : (night ? 19 : 22);
  s.temp += (target - s.temp) * 0.03;
  s.humidity = clamp(s.humidity + (40 - s.humidity) * 0.01);
  s.clean = clamp(s.clean - 0.01);

  const tempOk = s.temp >= 24 && s.temp <= 34;
  s.mood = clamp(s.mood - 0.04 - (tempOk ? 0 : 0.1) - s.poops.length * 0.03 - (s.hunger < 25 ? 0.05 : 0));

  if (s.poopAt && t >= s.poopAt) { addPoop(); s.poopAt = null; }

  let bad = 0;
  if (s.hunger < 15) bad++;
  if (!tempOk) bad++;
  if (s.clean < 30) bad++;
  if (s.shedding && t - s.shedStart > 12 * 3.6e6) bad++;   // 탈피가 너무 오래 걸림
  s.health = clamp(s.health + (bad ? -0.07 * bad : 0.04));

  if (!s.shedding && s.nextShedAt && t >= s.nextShedAt) {
    s.shedding = true; s.shedProgress = 0; s.shedStart = t;
    pendingMsgs.push('탈피를 시작했어요! 분무로 습도를 높여주세요 💦');
  }
  if (s.shedding) {
    s.shedProgress += s.humidity >= 60 ? 1.5 : 0.2;
    if (s.shedProgress >= 100) {
      s.shedding = false; s.shedProgress = 0;
      s.nextShedAt = t + rand(36, 60) * 3.6e6;
      s.mood = clamp(s.mood + 10);
      pendingMsgs.push('탈피 완료! 반짝반짝 ✨');
    }
  }
}

function checkStage() {
  if (state.stage === 'egg') return;
  const st = stageFor(ageMs());
  if (st !== state.stage) {
    state.stage = st;
    pendingMsgs.push(`${petName()}${josa(petName(), '이', '가')} ${STAGE_NAME[st]} 도마뱀으로 자랐어요! 🎉`);
    state.nextShedAt = Math.min(state.nextShedAt || Infinity, Date.now() + 5 * 60000);
  }
}

function tickSim() {
  const now = Date.now();
  let n = Math.floor((now - state.lastTick) / 60000);
  if (n <= 0) return;
  if (state.stage === 'egg') { state.lastTick = now; return; }
  let start = state.lastTick;
  if (n > MAX_OFFLINE_MIN) { n = MAX_OFFLINE_MIN; start = now - n * 60000; }
  for (let i = 1; i <= n; i++) simMinute(start + i * 60000);
  state.lastTick = start + n * 60000;
  checkStage();
  save();
  while (pendingMsgs.length) toast(pendingMsgs.shift());
}

/* ---------- 화면 속 생물들 ---------- */

const canvas = $('tank');
const ctx = canvas.getContext('2d');
let scale = 1;
let time = 0;

const gecko = {
  x: 200, y: 235, tx: 200, ty: 235, dir: 1, phase: 0, moving: false,
  mode: 'idle', modeT: 2, blink: 0, blinkT: 3, eatT: 0, tongue: 0, zT: 0,
};
let crickets = [];
let particles = [];
let eggWobble = 0;
let petTimes = [];
let lastPetFx = 0;

const sandDots = Array.from({ length: 70 }, () => ({ x: rand(0, W), y: rand(170, H), r: rand(0.6, 1.6) }));

function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.width * H / W * dpr));
  scale = canvas.width / W;
}

function geckoScale() { return STAGE_SCALE[state.stage] || 1; }
function mouthPos() {
  const s = geckoScale();
  return { x: gecko.x + gecko.dir * 56 * s, y: gecko.y - 4 * s };
}

function moveToward(tx, ty, speed, dt) {
  const g = gecko;
  const dx = tx - g.x, dy = ty - g.y, d = Math.hypot(dx, dy);
  if (d < 2) { g.moving = false; return true; }
  const st = Math.min(d, speed * dt);
  g.x += dx / d * st; g.y += dy / d * st;
  if (Math.abs(dx) > 3) g.dir = dx > 0 ? 1 : -1;
  g.phase += st * 0.25;
  g.moving = true;
  return false;
}

function pickMode() {
  const g = gecko;
  const sick = state.health < 30;
  const pSleep = sick ? 0.5 : isNight() ? 0.1 : 0.55;   // 레오파드 게코는 야행성
  const r = Math.random();
  if (r < pSleep) {
    g.mode = 'toHide'; g.tx = HIDE.x - rand(25, 45); g.ty = HIDE.y + rand(12, 22);
  } else if (r < pSleep + 0.3) {
    g.mode = 'walk'; g.tx = rand(FLOOR.x1, FLOOR.x2); g.ty = rand(FLOOR.y1, FLOOR.y2);
  } else {
    g.mode = 'idle'; g.modeT = rand(2, 5);
  }
}

function updateGecko(dt) {
  const g = gecko;
  g.blinkT -= dt;
  if (g.blinkT <= 0) { g.blink = 0.15; g.blinkT = rand(2, 6); }
  if (g.blink > 0) g.blink -= dt;
  if (g.tongue > 0) g.tongue -= dt;
  g.moving = false;
  if (g.eatT > 0) { g.eatT -= dt; return; }

  const hungry = state.hunger < 95;
  const sick = state.health < 30;
  if (crickets.length && hungry && g.mode !== 'hunt') g.mode = 'hunt';

  switch (g.mode) {
    case 'hunt': {
      if (!crickets.length || !hungry) { g.mode = 'idle'; g.modeT = 2; break; }
      const m = mouthPos();
      let best = null, bd = Infinity;
      for (const c of crickets) { const d = Math.hypot(c.x - m.x, c.y - m.y); if (d < bd) { bd = d; best = c; } }
      if (bd < 12 && best.z < 8) { eatCricket(best); break; }
      moveToward(best.x - g.dir * 40 * geckoScale(), best.y + 4, sick ? 25 : 55, dt);
      if (Math.abs(best.x - g.x) > 8) g.dir = best.x > g.x ? 1 : -1;
      break;
    }
    case 'walk':
      if (moveToward(g.tx, g.ty, sick ? 12 : 28, dt)) { g.mode = 'idle'; g.modeT = rand(1.5, 4); }
      break;
    case 'toHide':
      if (moveToward(g.tx, g.ty, 22, dt)) { g.mode = 'sleep'; g.modeT = rand(20, 45); }
      break;
    case 'sleep':
      g.modeT -= dt; g.zT -= dt;
      if (g.zT <= 0) { g.zT = 1.4; spawn('z', g.x + g.dir * 40 * geckoScale(), g.y - 25 * geckoScale()); }
      if (g.modeT <= 0) pickMode();
      break;
    default: // idle
      g.modeT -= dt;
      if (Math.random() < dt * 0.3) g.tongue = 0.25;
      if (g.modeT <= 0) pickMode();
  }
}

function eatCricket(c) {
  crickets = crickets.filter((x) => x !== c);
  state.hunger = clamp(state.hunger + 15);
  state.mood = clamp(state.mood + 3);
  gecko.eatT = 0.6;
  gecko.tongue = 0.3;
  if (!state.poopAt) state.poopAt = Date.now() + rand(20, 60) * 60000;
  spawn('sparkle', c.x, c.y - 6);
  save(); updateUI();
}

function updateCrickets(dt) {
  for (const c of crickets) {
    c.hopT -= dt;
    if (c.hopT <= 0 && c.z === 0) { c.vz = rand(60, 110); c.vx = rand(-55, 55); c.vy = rand(-20, 20); c.hopT = rand(0.6, 2); }
    if (c.z > 0 || c.vz > 0) {
      c.z += c.vz * dt; c.vz -= 320 * dt;
      c.x += c.vx * dt; c.y += c.vy * dt;
      if (c.z <= 0) { c.z = 0; c.vz = 0; c.vx = 0; c.vy = 0; }
    }
    c.x = clamp(c.x, FLOOR.x1 - 20, FLOOR.x2 + 20);
    c.y = clamp(c.y, FLOOR.y1, FLOOR.y2);
    if (c.vx) c.dir = c.vx > 0 ? 1 : -1;
  }
}

function spawn(type, x, y) {
  const p = { type, x, y, t: 0, life: 1.6, vx: rand(-8, 8), vy: -22 };
  if (type === 'drop') { p.vx = 0; p.vy = rand(120, 180); p.life = 1.4; }
  if (type === 'sparkle') { p.life = 0.8; }
  particles.push(p);
}
function updateParticles(dt) {
  for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  particles = particles.filter((p) => p.t < p.life && !(p.type === 'drop' && p.y > FLOOR.y2));
}

/* ---------- 그리기 ---------- */

function ellipse(x, y, rx, ry, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); }

function drawTank() {
  const night = isNight();
  let gr = ctx.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, night ? '#1b2440' : '#bfe3d0');
  gr.addColorStop(1, night ? '#2c3554' : '#e6f1df');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);

  // 뒷벽 바위
  ctx.fillStyle = night ? '#2f3653' : '#a9b9a2';
  ellipse(60, 168, 80, 34); ctx.fill();
  ellipse(200, 172, 70, 22); ctx.fill();
  ellipse(350, 165, 90, 40); ctx.fill();

  // 모래 바닥
  gr = ctx.createLinearGradient(0, 165, 0, H);
  gr.addColorStop(0, night ? '#6f6250' : '#ecd39b');
  gr.addColorStop(1, night ? '#5a4e3f' : '#d8b26b');
  ctx.fillStyle = gr; ctx.fillRect(0, 172, W, H - 172);
  ctx.fillStyle = night ? 'rgba(0,0,0,.18)' : 'rgba(120,80,30,.18)';
  for (const d of sandDots) { ellipse(d.x, d.y, d.r, d.r); ctx.fill(); }

  // 식물
  ctx.strokeStyle = night ? '#2f5a43' : '#4f9a5e'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  for (const [dx, h, bend] of [[-10, 70, -18], [0, 90, 6], [10, 65, 20], [18, 50, 30]]) {
    ctx.beginPath(); ctx.moveTo(30 + dx, 200); ctx.quadraticCurveTo(30 + dx + bend * 0.3, 200 - h * 0.6, 30 + dx + bend, 200 - h); ctx.stroke();
  }

  // 물그릇
  ctx.fillStyle = night ? '#5a5a5a' : '#8f8f8f'; ellipse(DISH.x, DISH.y, 26, 10); ctx.fill();
  ctx.fillStyle = night ? '#3b6f8f' : '#7cc4e8'; ellipse(DISH.x, DISH.y - 1, 21, 7); ctx.fill();

  // 은신처
  ctx.fillStyle = night ? '#4d3a28' : '#8a6440';
  ctx.beginPath(); ctx.ellipse(HIDE.x + 20, HIDE.y + 14, 55, 40, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = night ? '#1d150d' : '#3d2b1a';
  ctx.beginPath(); ctx.ellipse(HIDE.x + 6, HIDE.y + 14, 20, 16, 0, Math.PI, 0); ctx.fill();

  // 히터 램프
  ctx.fillStyle = '#555'; ctx.fillRect(282, 0, 36, 10);
  ctx.fillStyle = state.heater ? '#ffb15c' : '#888'; ellipse(300, 12, 12, 6); ctx.fill();
  if (state.heater) {
    const g = ctx.createRadialGradient(300, 12, 5, 300, 12, 190);
    g.addColorStop(0, 'rgba(255,160,60,.35)'); g.addColorStop(1, 'rgba(255,160,60,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}

function drawPoops() {
  for (const p of state.poops) {
    ctx.fillStyle = '#5b3d22'; ellipse(p.x, p.y, 6, 3.5); ctx.fill();
    ctx.fillStyle = '#f4f1e8'; ellipse(p.x + 5, p.y - 1, 2.2, 1.8); ctx.fill();
  }
}

function drawEgg() {
  const w = state.eggWarmth;
  const wob = (w > 60 ? Math.sin(time * 18) * 0.06 * (w / 100) : 0) + Math.sin(time * 25) * eggWobble;
  ctx.save(); ctx.translate(EGG.x, EGG.y + 18); ctx.rotate(wob);
  ctx.fillStyle = 'rgba(0,0,0,.15)'; ellipse(0, 2, 20, 5); ctx.fill();
  ctx.fillStyle = '#fbf3df'; ellipse(0, -22, 17, 23); ctx.fill();
  ctx.strokeStyle = '#d8ccae'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#e7dcc1';
  for (const [x, y, r] of [[-6, -30, 2.5], [5, -20, 2], [-3, -12, 1.8], [7, -34, 1.6]]) { ellipse(x, y, r, r); ctx.fill(); }
  if (w > 80) { // 금이 감
    ctx.strokeStyle = '#8a7a58'; ctx.beginPath(); ctx.moveTo(-10, -26); ctx.lineTo(-4, -22); ctx.lineTo(0, -27); ctx.lineTo(5, -21); ctx.lineTo(10, -25); ctx.stroke();
  }
  ctx.restore();
  // 따뜻함 게이지
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(EGG.x - 30, EGG.y - 42, 60, 6);
  ctx.fillStyle = '#ff9a3c'; ctx.fillRect(EGG.x - 30, EGG.y - 42, 60 * w / 100, 6);
}

function geckoPath() {
  // 꼬리 + 몸 + 머리를 하나의 경로로 (무늬 클리핑용)
  const wag = Math.sin(time * 1.5) * 3;
  const p = new Path2D();
  p.moveTo(-28, -10);
  p.quadraticCurveTo(-68, -15, -92, 2 + wag);
  p.quadraticCurveTo(-68, 12, -28, 11);
  p.closePath();
  p.ellipse(0, 0, 40, 15, 0, 0, Math.PI * 2);
  p.ellipse(44, -5, 20, 13, 0, 0, Math.PI * 2);
  return p;
}

function drawLeg(x, y, angle, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 13); ctx.stroke();
  ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-3, 14); ctx.lineTo(5, 15); ctx.stroke();
  ctx.restore();
}

function drawGecko() {
  const g = gecko;
  const s = geckoScale();
  const sleeping = g.mode === 'sleep';
  const baby = state.stage === 'baby';
  const swing = g.moving ? Math.sin(g.phase) * 0.55 : 0;
  const breathe = Math.sin(time * (sleeping ? 1.5 : 3)) * 0.8;

  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.scale(g.dir * s, s);

  ctx.fillStyle = 'rgba(0,0,0,.15)'; ellipse(-10, 20, 70, 6); ctx.fill();

  const bodyC = baby ? '#f5d36a' : '#f2c14e';
  const farLeg = '#c99b38';
  drawLeg(-20, 8, -swing, farLeg);
  drawLeg(26, 8, swing, farLeg);

  ctx.save(); ctx.translate(0, breathe * 0.3);
  const path = geckoPath();
  ctx.fillStyle = bodyC; ctx.fill(path);

  ctx.save(); ctx.clip(path);
  ctx.fillStyle = '#fbe7a8'; ellipse(4, 10, 36, 7); ctx.fill();        // 배
  ctx.fillStyle = '#6b4a2b';
  if (baby) { // 아기는 줄무늬
    for (const x of [-78, -55, -14, 16, 46]) { ctx.fillRect(x, -20, 9, 40); }
  } else {    // 어른은 점박이
    const spots = [[-80, 1, 2.5], [-66, -4, 3], [-56, 4, 2.6], [-44, -3, 3], [-20, -8, 3.4], [-8, -2, 2.6], [6, -9, 3], [18, -3, 2.8], [-30, 2, 2.4], [28, -10, 2.4], [40, -12, 2.2], [36, -3, 1.8], [50, -14, 1.8]];
    for (const [x, y, r] of spots) { ellipse(x, y, r, r); ctx.fill(); }
  }
  ctx.restore();

  if (state.shedding) { ctx.fillStyle = 'rgba(235,235,235,.5)'; ctx.fill(path); }
  if (state.health < 30) { ctx.fillStyle = 'rgba(110,150,90,.3)'; ctx.fill(path); }
  ctx.strokeStyle = '#8a6a2c'; ctx.lineWidth = 1.4; ctx.stroke(path);

  // 눈
  if (sleeping || g.blink > 0) {
    ctx.strokeStyle = '#3a2a18'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(50, -10, 4, 0.2, Math.PI - 0.2); ctx.stroke();
  } else {
    ctx.fillStyle = '#2a1e12'; ellipse(50, -10, 4.8, 4.8); ctx.fill();
    ctx.fillStyle = '#fff'; ellipse(51.6, -11.6, 1.6, 1.6); ctx.fill();
  }
  // 입
  ctx.strokeStyle = '#8a6a2c'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(62, -2); ctx.quadraticCurveTo(56, 2, 47, 0); ctx.stroke();
  if (g.tongue > 0) {
    ctx.strokeStyle = '#e45a6a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(62, -2); ctx.lineTo(70, -1); ctx.stroke();
  }
  ctx.restore();

  const nearLeg = '#e3b043';
  drawLeg(-26, 9, swing, nearLeg);
  drawLeg(20, 9, -swing, nearLeg);
  ctx.restore();
}

function drawCricket(c) {
  ctx.save(); ctx.translate(c.x, c.y);
  ctx.fillStyle = 'rgba(0,0,0,.15)'; ellipse(0, 1, 5, 1.6); ctx.fill();
  ctx.translate(0, -c.z); ctx.scale(c.dir || 1, 1);
  ctx.strokeStyle = '#4a3216'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-1, -2); ctx.lineTo(-6, -7); ctx.lineTo(-8, 0); ctx.stroke(); // 뒷다리
  ctx.beginPath(); ctx.moveTo(4, -4); ctx.quadraticCurveTo(10, -10, 14, -8); ctx.stroke();  // 더듬이
  ctx.fillStyle = '#7a5426'; ellipse(0, -3, 6, 2.8); ctx.fill();
  ctx.fillStyle = '#4a3216'; ellipse(5, -3.5, 2, 2); ctx.fill();
  ctx.restore();
}

function drawParticles() {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const p of particles) {
    const a = 1 - p.t / p.life;
    ctx.globalAlpha = Math.max(0, a);
    if (p.type === 'heart') { ctx.font = '16px sans-serif'; ctx.fillText('💗', p.x, p.y); }
    else if (p.type === 'z') { ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('z', p.x, p.y); }
    else if (p.type === 'sparkle') { ctx.font = '14px sans-serif'; ctx.fillText('✨', p.x, p.y); }
    else if (p.type === 'drop') { ctx.fillStyle = '#7cc4e8'; ellipse(p.x, p.y, 1.6, 3.5); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
}

function draw() {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawTank();
  drawPoops();
  if (state.stage === 'egg') { drawEgg(); }
  else {
    // 위쪽(뒤)에 있는 것부터 그린다
    const items = [...crickets.map((c) => ({ y: c.y, f: () => drawCricket(c) })), { y: gecko.y, f: drawGecko }];
    items.sort((a, b) => a.y - b.y).forEach((i) => i.f());
  }
  drawParticles();
  // 유리 반사
  ctx.fillStyle = 'rgba(255,255,255,.08)';
  ctx.beginPath(); ctx.moveTo(40, 0); ctx.lineTo(90, 0); ctx.lineTo(20, H); ctx.lineTo(-30, H); ctx.fill();
}

/* ---------- 행동 ---------- */

const actions = {
  feed() {
    if (state.hunger >= 90) return toast(`${petName()}${josa(petName(), '은', '는')} 배가 불러요`);
    if (crickets.length >= 3) return toast('아직 귀뚜라미가 남아있어요');
    crickets.push({ x: rand(FLOOR.x1 + 20, FLOOR.x2 - 20), y: rand(FLOOR.y1 + 10, FLOOR.y2), z: 60, vz: 0, vx: 0, vy: 0, hopT: rand(0.5, 1.5), dir: 1 });
    if (gecko.mode === 'sleep') toast('귀뚜라미 소리에 깼어요! 🦗');
  },
  mist() {
    state.humidity = clamp(state.humidity + 30);
    for (let i = 0; i < 24; i++) spawn('drop', rand(20, W - 20), rand(-40, 20));
    if (state.humidity > 90) { state.mood = clamp(state.mood - 3); toast('너무 습해요 💦'); }
    else if (state.shedding) toast('촉촉해서 탈피가 잘 돼요');
  },
  clean() {
    if (!state.poops.length && state.clean > 95) return toast('이미 깨끗해요 ✨');
    state.poops = []; state.clean = 100;
    toast('깨끗하게 청소했어요 🧹');
  },
  heater() {
    state.heater = !state.heater;
    toast(state.heater ? '히터를 켰어요 🔥' : '히터를 껐어요. 추워질 수 있어요');
  },
  vet() {
    if (state.health >= 40) return toast('건강해요! 병원에 갈 필요 없어요');
    state.health = 80; state.mood = clamp(state.mood - 10);
    toast('병원에 다녀왔어요. 이제 괜찮아요 💊');
  },
};

function pet() {
  const now = Date.now();
  if (now - lastPetFx < 400) return;
  lastPetFx = now;
  petTimes = petTimes.filter((t) => now - t < 60000);
  petTimes.push(now);
  if (gecko.mode === 'sleep') {
    gecko.mode = 'idle'; gecko.modeT = 3;
    state.mood = clamp(state.mood - 2);
    toast('깜짝! 잠에서 깼어요 😳');
  } else if (petTimes.length > 8) {
    state.mood = clamp(state.mood - 3);
    toast('너무 많이 만지면 스트레스 받아요 😣');
  } else {
    state.mood = clamp(state.mood + 4);
    for (let i = 0; i < 3; i++) spawn('heart', gecko.x + rand(-15, 25) * gecko.dir, gecko.y - 25);
  }
  save(); updateUI();
}

function hatch() {
  const now = Date.now();
  state.stage = 'baby'; state.hatchedAt = now; state.lastTick = now;
  state.hunger = 60; state.mood = 80;
  state.nextShedAt = now + 8 * 3.6e6;
  gecko.x = EGG.x; gecko.y = EGG.y + 10; gecko.mode = 'idle'; gecko.modeT = 3;
  for (let i = 0; i < 6; i++) spawn('sparkle', EGG.x + rand(-25, 25), EGG.y + rand(-30, 10));
  save(); updateUI();
  showNameDialog();
}

function onTap(e) {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * W;
  const y = (e.clientY - r.top) / r.height * H;
  if (state.stage === 'egg') {
    if (Math.hypot(x - EGG.x, y - (EGG.y - 4)) < 40) {
      state.eggWarmth = clamp(state.eggWarmth + 8);
      eggWobble = 0.12;
      spawn('sparkle', x, y);
      if (state.eggWarmth >= 100) hatch(); else save();
    }
    return;
  }
  const i = state.poops.findIndex((p) => Math.hypot(p.x - x, p.y - y) < 14);
  if (i >= 0) { state.poops.splice(i, 1); state.clean = clamp(state.clean + 10); save(); updateUI(); return; }
  const s = geckoScale();
  if (Math.hypot(x - (gecko.x + gecko.dir * 10 * s), y - gecko.y) < 55 * s) pet();
}

/* ---------- UI ---------- */

let toastQueue = [], toastBusy = false;
function toast(msg) {
  toastQueue.push(msg);
  if (!toastBusy) nextToast();
}
function nextToast() {
  const el = $('toast');
  if (!toastQueue.length) { toastBusy = false; return; }
  toastBusy = true;
  el.textContent = toastQueue.shift();
  el.classList.add('show');
  setTimeout(() => { el.classList.remove('show'); setTimeout(nextToast, 350); }, 2400);
}

function setBar(id, v) {
  const el = $(id);
  el.style.width = v + '%';
  el.className = v < 25 ? 'low' : v < 50 ? 'mid' : '';
}

function statusText() {
  const s = state;
  if (s.stage === 'egg') return s.heater ? '알을 톡톡 두드려서 따뜻하게 해주세요 🥚' : '히터를 켜야 알이 따뜻해져요';
  if (s.health < 30) return '아파요… 병원에 데려가 주세요 🤒';
  if (s.shedding) return `탈피 중 ${Math.floor(s.shedProgress)}% · 습도를 높여주세요`;
  if (gecko.mode === 'hunt') return '사냥 중! 🦗';
  if (s.hunger < 25) return '배고파요 🍖';
  if (s.temp < 24) return '추워요 🥶';
  if (s.clean < 40) return '사육장이 더러워요';
  if (gecko.mode === 'sleep') return '쿨쿨 자는 중 💤';
  if (s.mood > 75) return '기분 최고! 😊';
  return isNight() ? '밤이라 활발해요 🌙' : '느긋하게 쉬는 중';
}

function updateUI() {
  const s = state;
  const egg = s.stage === 'egg';
  $('name').textContent = egg ? '도마뱀 알' : petName();
  $('sub').textContent = egg ? '레오파드 게코 알' : `레오파드 게코 · ${STAGE_NAME[s.stage]} · ${fmtDur(ageMs())}`;
  $('clock').textContent = isNight() ? '🌙 밤' : '☀️ 낮';
  setBar('b-hunger', s.hunger);
  setBar('b-mood', s.mood);
  setBar('b-clean', s.clean);
  setBar('b-health', s.health);
  const t = $('temp');
  t.textContent = `🌡️ ${s.temp.toFixed(1)}°C`;
  t.className = s.temp < 24 || s.temp > 34 ? 'warn' : '';
  const h = $('hum');
  h.textContent = `💧 습도 ${Math.round(s.humidity)}%`;
  h.className = s.shedding && s.humidity < 60 ? 'warn' : '';
  $('heater-btn').setAttribute('aria-pressed', String(s.heater));
  $('heater-label').textContent = s.heater ? '히터 켜짐' : '히터 꺼짐';
  for (const b of document.querySelectorAll('.actions button')) {
    const act = b.dataset.act;
    b.disabled = (egg && act !== 'heater') || (act === 'vet' && s.health >= 40);
  }
  $('status').textContent = statusText();
}

function showNameDialog() {
  $('dialog').classList.remove('hidden');
  setTimeout(() => $('name-input').focus(), 50);
}
$('name-ok').addEventListener('click', () => {
  state.name = $('name-input').value.trim().slice(0, 10) || '망고';
  $('dialog').classList.add('hidden');
  save(); updateUI();
  toast(`반가워, ${state.name}! 🦎`);
});
$('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('name-ok').click(); });

for (const b of document.querySelectorAll('.actions button')) {
  b.addEventListener('click', () => { actions[b.dataset.act](); save(); updateUI(); });
}

let resetArmed = null;
$('reset').addEventListener('click', () => {
  const btn = $('reset');
  if (!resetArmed) {
    btn.textContent = '정말요? 한 번 더 누르면 처음부터';
    resetArmed = setTimeout(() => { resetArmed = null; btn.textContent = '처음부터'; }, 3000);
    return;
  }
  clearTimeout(resetArmed); resetArmed = null; btn.textContent = '처음부터';
  state = defaultState(); crickets = []; particles = [];
  gecko.x = 200; gecko.y = 235; gecko.mode = 'idle';
  save(); updateUI();
  toast('새 알을 받았어요 🥚');
});

canvas.addEventListener('pointerdown', onTap);
window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); else { tickSim(); updateUI(); } });

/* ---------- 메인 루프 ---------- */

let last = performance.now();
let uiAcc = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  if (eggWobble > 0) eggWobble = Math.max(0, eggWobble - dt * 0.4);

  if (state.stage === 'egg') {
    if (state.heater) {
      state.eggWarmth = clamp(state.eggWarmth + dt * 0.8);
      if (state.eggWarmth >= 100) hatch();
    }
  } else {
    updateGecko(dt);
    updateCrickets(dt);
  }
  updateParticles(dt);
  draw();

  uiAcc += dt;
  if (uiAcc >= 1) { uiAcc = 0; tickSim(); updateUI(); }
  requestAnimationFrame(frame);
}

/* ---------- 시작 ---------- */

$('ver').textContent = APP_VERSION;
{
  const away = Date.now() - state.lastTick;
  tickSim();
  if (state.stage !== 'egg' && away > 30 * 60000) {
    toast(`${fmtDur(away)} 동안 ${petName()}${josa(petName(), '이', '가')} 기다렸어요`);
  }
}
if (state.stage !== 'egg' && !state.name) showNameDialog();
resize();
updateUI();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
