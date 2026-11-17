"use strict";

const params = new URLSearchParams(location.search);
// 테스트 모드: ?test=1 이면 성장 2000배, ?test=500 처럼 배속 지정 가능.
// 성장 시간만 빨라지고(상태 감소는 그대로), 실제 게코와 따로 저장된다.
const TEST_SPEED = !params.has("test") ? 1 : Number(params.get("test")) > 1 ? Number(params.get("test")) : 2000;
const TEST = TEST_SPEED > 1;
const SAVE_KEY = "critter-craft-v1" + (TEST ? "-test" : "");
const MAX_OFFLINE_MIN = 24 * 60; // 오래 자리를 비워도 최대 24시간치만 반영
const OFFLINE_GAP_MIN = 2;       // 이보다 오래 계산이 멈췄으면 게임을 꺼 둔 것으로 본다
const OFFLINE_FACTOR = 0.15;     // 꺼 둔 동안은 상태가 0.15배 속도로 줄어든다
const STEP_MIN = 5;              // 긴 시간은 5분씩 나눠 계산 (돌봄 여부를 중간중간 확인)
// 분당 변화량 (밤에 자는 중에는 SLEEP_* 적용)
// clean은 사육장 깨끗함. 대부분 응가 때문에 더러워지고, 바닥재 먼지로 조금씩 줄어든다.
const DECAY = { hunger: 1.8, happy: 0.8, energy: 1.0, clean: 0.3 };
const SLEEP = { hunger: 0.4, happy: 0.1, energy: -4, clean: 0.05 };
// 응가: 먹고 나서 45~90분 뒤에 나온다 (실제 소화보다 빠르게 해서 자주 치우게). 레오파드 게코는 한쪽 구석에만 응가한다.
const DIGEST_MIN = 45, DIGEST_RAND = 45, MAX_DIGEST = 5, MAX_POOP = 3;
const POOP_DIRT = 0.4; // 응가 하나당 분당 깨끗함 감소
// 물그릇: 하루쯤 지나면 물을 갈아줘야 한다. 꺼 둔 동안에도 같은 속도로 줄어든다(매일 물 갈기 습관).
const WATER_RATE = 0.07, THIRSTY = 20;
// 평균 상태가 이 이상인 시간만 성장 시간(careMin)으로 친다. 알은 돌볼 수 없으니 시간만 흐르면 된다.
const CARE_AVG = 50;
// 성장 단계: care = 그 단계가 되기 위해 필요한 누적 성장 시간(분)
// key는 이미지 파일 이름에 쓰인다: assets/lizard/<key>_<기분>.png
const STAGES = [
  { key: "egg", name: "알", care: 0 },
  { key: "hatchling", name: "아기 게코", care: 10 },
  { key: "juvenile", name: "어린 게코", care: 2 * 24 * 60 },
  { key: "adult", name: "어른 게코", care: 7 * 24 * 60 },
];
// 어른이 된 뒤 이만큼 더 잘 돌봐주면 알을 낳는다. 어른은 앨범에 사진으로 남고, 다음 세대가 알부터 다시 시작한다.
const LAY_CARE_MIN = 3 * 24 * 60;
const LAY_GOAL = { key: "lay", name: "알 낳기", care: STAGES[STAGES.length - 1].care + LAY_CARE_MIN };
const IMG_DIR = "assets/lizard/";
const CAGE_BG = "assets/cage/background.png";
// 온도: 램프를 켜면 LAMP_MAX 쪽으로, 끄면 방 온도(ROOM_TEMP) 쪽으로 천천히 움직인다.
// 램프를 계속 켜 두면 1시간쯤 뒤 너무 뜨거워지고, 꺼 두면 1시간쯤 뒤 추워진다.
const LAMP_MAX = 36, ROOM_TEMP = 22, TEMP_RATE = 0.03;
// 게임을 꺼 둔 동안은 온도조절기가 알맞은 온도로 맞춰 준다고 친다 (밤새 너무 덥거나 춥지 않게)
const AUTO_TEMP = { day: 30, night: 25 };
// 실제 레오파드 게코 사육 온도: 낮 28~32°C, 밤 24~27°C
// 너무 춥거나 더우면 상태가 빨리 나빠지고 성장이 멈춘다 (rest: 잘 때 에너지 회복 배율)
const TEMP_EFFECT = {
  cold: { hunger: 0.5, happy: 2, energy: 1, clean: 1, rest: 1 }, // 추우면 소화가 느려지고 기운이 없다
  hot: { hunger: 1, happy: 1.5, energy: 2, clean: 1, rest: 0.5 },
};
const NO_EFFECT = { hunger: 1, happy: 1, energy: 1, clean: 1, rest: 1 };

const $ = (id) => document.getElementById(id);
const clamp = (v) => Math.max(0, Math.min(100, v));

function newState() {
  const now = Date.now();
  return { name: "도마", hunger: 80, happy: 80, energy: 80, clean: 80,
           ageMin: 0, careMin: 0, sleeping: false, poopCount: 0, digest: [], water: 100,
           temp: 29, lampOn: true, mathGrade: 2, mathDay: "", mathClears: 0,
           gen: 1, history: [], born: now, last: now };
}

function fromSave(s) {
  const st = Object.assign(newState(), s);
  if (typeof s.careMin !== "number") st.careMin = s.ageMin || 0; // 돌봄 조건 이전 저장본
  if (typeof s.poopCount !== "number") st.poopCount = s.poop ? 1 : 0; // 응가가 하나뿐이던 저장본
  delete st.poop;
  if (st.mathGrade !== 2 && st.mathGrade !== 3) st.mathGrade = 2; // 1학년이 있던 저장본
  if (typeof s.born !== "number") st.born = st.last - st.ageMin * 60000; // 태어난 시각이 없던 저장본
  return st;
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s.last === "number") return fromSave(s);
  } catch (e) { /* 저장 데이터가 없거나 손상됨 */ }
  return newState();
}
// 프로필: 주소에 ?p=이름 을 붙이면 사람(기기)마다 따로 저장된다. 기본값은 "default".
const PROFILE = (TEST ? "test-" : "") + ((params.get("p") || "default")
  .toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 26) || "default");
const API = "api/state?p=" + encodeURIComponent(PROFILE);
let serverReady = false; // 서버 상태를 확인하기 전에는 서버에 덮어쓰지 않는다
let noServer = false;    // 저장 서버가 없는 곳(GitHub Pages 등): localStorage만 쓴다

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {}
  if (!serverReady) return;
  fetch(API, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
    keepalive: true,
  }).catch(() => { /* 서버 연결 실패 시 localStorage가 백업 */ });
}

async function loadFromServer() {
  try {
    const res = await fetch(API, { cache: "no-store" });
    // 우리 서버는 404도 JSON으로 답한다. JSON이 아니면 저장 서버가 없는 정적 호스팅이다.
    if (!(res.headers.get("content-type") || "").includes("application/json")) { noServer = true; return; }
    if (res.ok) {
      const s = await res.json();
      if (s && typeof s.last === "number") state = fromSave(s);
    }
    // 404면 서버에 저장본이 없는 것: 현재(로컬/새) 상태를 그대로 올린다
    serverReady = true;
  } catch (e) { /* 서버에 못 닿으면 로컬 상태로 계속 진행 */ }
}

let state = load();

const careAvg = () => (state.hunger + state.happy + state.energy + state.clean) / 4;
// 온도 상태: cold / ok / good / hot. 밤(자는 중)에는 기준이 낮다.
function tempZone() {
  const t = state.temp;
  if (state.sleeping) return t < 21 ? "cold" : t > 29 ? "hot" : t >= 24 && t <= 27 ? "good" : "ok";
  return t < 24 ? "cold" : t > 34 ? "hot" : t >= 28 && t <= 32 ? "good" : "ok";
}
const badTemp = () => { const z = tempZone(); return z === "cold" || z === "hot"; };
// 알도 따뜻해야 부화한다 (실제로도 알은 28~32°C에서 키운다)
const thirsty = () => stage().key !== "egg" && state.water < THIRSTY;
const isCared = () => !badTemp() && (stage().key === "egg" || (!thirsty() && careAvg() >= CARE_AVG));

// 경과 시간(분)만큼 상태를 진행. 아이용이라 아무리 방치해도 죽지 않는다.
function advance(total, offline) {
  for (let left = total; left > 0; left -= STEP_MIN) step(Math.min(left, STEP_MIN), offline ? OFFLINE_FACTOR : 1);
}

// f: 감소 속도 배율 (꺼 둔 동안은 느리게). 잘 때 에너지 회복은 그대로 둔다.
function step(min, f) {
  const r = state.sleeping ? SLEEP : DECAY;
  const e = TEMP_EFFECT[tempZone()] || NO_EFFECT;
  if (isCared()) state.careMin += min * TEST_SPEED;
  for (const k of ["hunger", "happy", "energy", "clean"]) {
    state[k] = clamp(state[k] - (r[k] > 0 ? r[k] * f * e[k] : r[k] * e.rest) * min);
  }
  const target = f < 1 ? AUTO_TEMP[state.sleeping ? "night" : "day"] : state.lampOn ? LAMP_MAX : ROOM_TEMP;
  state.temp += (target - state.temp) * (1 - Math.exp(-TEMP_RATE * min));
  state.ageMin += min;
  if (state.sleeping && state.energy >= 100) state.sleeping = false;
  state.water = clamp(state.water - WATER_RATE * min);
  while (state.digest.length && state.digest[0] <= state.ageMin) {
    state.digest.shift();
    state.poopCount = Math.min(MAX_POOP, state.poopCount + 1);
  }
  state.clean = clamp(state.clean - POOP_DIRT * state.poopCount * f * min);
}

function tick() {
  const now = Date.now();
  const gap = (now - state.last) / 60000;
  const min = Math.min(gap, MAX_OFFLINE_MIN);
  const before = stage(), hadPoop = state.poopCount, wasSleeping = state.sleeping;
  const online = gap <= OFFLINE_GAP_MIN;
  state.last = now;
  if (min > 0) advance(min, !online);
  if (state.careMin >= LAY_GOAL.care && !busy) return layEgg();
  save();
  render();
  const after = stage();
  if (after !== before) { sfx("grow"); say(`와! ${after.name}로 자랐어요!`); }
  // 켜 둔 동안 생긴 일만 소리를 낸다 (다시 열었을 때 한꺼번에 울리지 않게)
  else if (online && state.poopCount > hadPoop) sfx("poop");
  else if (online && wasSleeping && !state.sleeping) sfx("wake");
}

function stage() {
  let cur = STAGES[0];
  for (const s of STAGES) if (state.careMin >= s.care) cur = s;
  return cur;
}

// 다음 목표: 다음 성장 단계, 어른이면 알 낳기
const nextGoal = () => STAGES[STAGES.indexOf(stage()) + 1] || LAY_GOAL;

// 다음 목표까지 진행률(0~100)
function growth() {
  const from = stage().care, next = nextGoal();
  return Math.min(100, ((state.careMin - from) / (next.care - from)) * 100);
}

function mood() {
  const z = tempZone();
  if (state.sleeping) return { face: "sleep", text: z === "hot" ? "더워서 잠이 안 와요..." : "쿨쿨..." };
  if (z === "cold") return { face: "sad", text: "추워요... 램프를 켜주세요" };
  if (z === "hot") return { face: "sad", text: "더워요! 램프를 꺼주세요" };
  if (thirsty()) return { face: "sad", text: "목말라요... 물을 갈아주세요" };
  if (state.hunger < 25) return { face: "sad", text: "배고파요..." };
  if (state.clean < 25) return { face: "sad", text: "사육장이 더러워요..." };
  if (state.energy < 25) return { face: "sad", text: "졸려요..." };
  if (state.happy < 25) return { face: "sad", text: "심심해요" };
  if (state.poopCount) return { face: "ok", text: "응가했어요! 치워주세요" };
  const avg = (state.hunger + state.happy + state.energy + state.clean) / 4;
  return avg > 70 ? { face: "happy", text: "너무 좋아요!" } : { face: "ok", text: "괜찮아요" };
}

// ---- 그리기 ----
// 이미지가 있으면 이미지를 쓰고, 없으면 아래 SVG 그림으로 대신한다.
// 찾는 순서: <단계>_<동작>.png → <단계>_<기분>.png → <단계>.png → SVG
let shownKey = "";
function renderPet(st, faces, svgFace) {
  const key = st.key + "_" + faces.join("+");
  if (key === shownKey) return; // 바뀐 게 없으면 다시 불러오지 않는다
  shownKey = key;
  const img = $("petImg"), svg = $("lizard");
  svg.innerHTML = lizardSvg(st, svgFace);
  const tries = faces.map((f) => IMG_DIR + st.key + "_" + f + ".png").concat(IMG_DIR + st.key + ".png");
  (function next(i) {
    if (i >= tries.length) { img.style.display = "none"; svg.style.display = ""; return; }
    const probe = new Image();
    probe.onload = () => {
      if (shownKey !== key) return;
      img.src = probe.src;
      img.style.display = "";
      svg.style.display = "none";
    };
    probe.onerror = () => { if (shownKey === key) next(i + 1); };
    probe.src = tries[i];
  })(0);
}

function lizardSvg(st, face) {
  if (st.key === "egg") {
    return `<ellipse cx="100" cy="85" rx="38" ry="48" fill="#f6efd9" stroke="#b9a977" stroke-width="3"/>
            <circle cx="88" cy="70" r="6" fill="#a5d6a7"/><circle cx="112" cy="95" r="8" fill="#a5d6a7"/>`;
  }
  const k = { hatchling: 0.6, juvenile: 0.8, adult: 1 }[st.key];
  const body = st.key === "adult" ? "#43a047" : "#66bb6a";
  const eyes = {
    happy: `<circle cx="150" cy="58" r="5"/><circle cx="168" cy="58" r="5"/>`,
    ok: `<circle cx="150" cy="58" r="5"/><circle cx="168" cy="58" r="5"/>`,
    sad: `<circle cx="150" cy="60" r="4"/><circle cx="168" cy="60" r="4"/><path d="M143 50l14 4M175 50l-14 4" stroke="#222" stroke-width="2"/>`,
    sleep: `<path d="M145 58h10M163 58h10" stroke="#222" stroke-width="3"/>`,
  }[face];
  const mouth = {
    happy: `<path d="M150 74q10 10 20 0" stroke="#222" stroke-width="3" fill="none"/>`,
    ok: `<path d="M152 76h16" stroke="#222" stroke-width="3"/>`,
    sad: `<path d="M150 80q10-8 20 0" stroke="#222" stroke-width="3" fill="none"/>`,
    sleep: `<path d="M152 76h16" stroke="#222" stroke-width="3"/>`,
  }[face];
  const spikes = st.key === "adult"
    ? `<path d="M70 62l8-12 8 12 8-12 8 12 8-12 8 12" fill="#ef6c00"/>` : "";
  return `<g transform="translate(100 125) scale(${k}) translate(-100 -125)">
    <path d="M30 110q-28 5-24 30 5-18 40-14z" fill="${body}"/>
    <ellipse cx="85" cy="100" rx="62" ry="30" fill="${body}"/>
    ${spikes}
    <ellipse cx="85" cy="108" rx="48" ry="16" fill="#c5e1a5"/>
    <rect x="45" y="118" width="14" height="22" rx="7" fill="${body}"/>
    <rect x="105" y="118" width="14" height="22" rx="7" fill="${body}"/>
    <ellipse cx="158" cy="68" rx="30" ry="26" fill="${body}"/>
    <g fill="#222">${eyes}</g>${mouth}
  </g>`;
}

function render() {
  const st = stage();
  const m = mood();
  $("stageLabel").textContent = st.name + (state.gen > 1 ? ` · ${state.gen}대` : "");
  $("s-grow").value = growth();
  const z = tempZone();
  const adult = !STAGES[STAGES.indexOf(st) + 1];
  $("growLabel").textContent = z === "cold" ? (st.key === "egg" ? "알이 추워요! 램프를 켜주세요" : "너무 추워서 못 자라요")
    : z === "hot" ? (st.key === "egg" ? "알이 너무 뜨거워요!" : "너무 더워서 못 자라요")
    : st.key === "egg" ? "알이 따뜻해지는 중"
    : thirsty() ? "목말라서 못 자라요"
    : adult ? (isCared() ? "알 낳을 준비 중 🥚" : "잘 돌봐줘야 알을 낳아요")
    : isCared() ? "쑥쑥 자라는 중" : "잘 돌봐줘야 자라요";
  const next = nextGoal();
  // 남은 시간 = 계속 잘 돌봐줬을 때 실제로 걸리는 시간 (테스트 모드면 배속 반영)
  $("growLeft").textContent = `${next.name}까지 ${fmtLeft((next.care - state.careMin) / TEST_SPEED)}`;
  if (TEST) {
    $("testInfo").textContent = `성장 ${fmtMin(state.careMin)} / 다음 목표 ${fmtMin(next.care)}`
      + ` · 평균 ${Math.round(careAvg())} · ${state.temp.toFixed(1)}°C`;
  }
  renderPet(st, action ? [action, m.face] : [m.face], action ? "happy" : m.face);
  $("room").dataset.action = action || "";
  $("app").classList.toggle("busy", busy);
  $("lizard").classList.toggle("sleeping", state.sleeping);
  $("petImg").classList.toggle("sleeping", state.sleeping);
  $("room").classList.toggle("night", state.sleeping);
  renderTemp();
  if (!busy) $("bubble").textContent = st.key === "egg" ? "곧 태어날 거예요..." : m.text;
  $("dark").hidden = !state.sleeping;
  renderBars();
  $("sleepBtn").textContent = state.sleeping ? "☀️ 깨우기" : "🌙 재우기";
  $("mathLeft").textContent = `오늘 🦴 ${mathLeft()}/${MATH_DAILY}`;
  if (document.activeElement !== $("nameInput")) $("nameInput").value = state.name;
}

// ---- 소리 ----
// 기본은 Web Audio로 만든 효과음. assets/sounds/<이름>.mp3 가 있으면 그 파일을 대신 쓴다.
// bgm.mp3가 있으면 배경음악으로 반복 재생한다.
const SOUND_DIR = "assets/sounds/";
const MUTE_KEY = "critter-craft-muted";
let muted = false, unlocked = false, actx = null;
try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (e) {}
const soundFiles = {}; // 이름 → 서버에 파일이 있는 Audio

function audioCtx() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
  }
  if (actx.state === "suspended") actx.resume();
  return actx;
}

// 삑 소리 하나. to를 주면 그 음까지 미끄러진다.
function tone(c, at, freq, dur, { type = "sine", vol = 0.15, to } = {}) {
  const t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// 바삭 소리: 점점 작아지는 짧은 잡음
function crunch(c, at, dur = 0.06, vol = 0.25) {
  const t = c.currentTime + at;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf;
  f.type = "bandpass";
  f.frequency.value = 2000;
  g.gain.value = vol;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

const notes = (c, freqs, gap, opts) => freqs.forEach((fq, i) => tone(c, i * gap, fq, gap * 1.6, opts));

const SYNTH = {
  tap: (c) => tone(c, 0, 700, 0.07, { type: "triangle", vol: 0.1 }),
  nope: (c) => { tone(c, 0, 330, 0.12, { type: "triangle" }); tone(c, 0.13, 247, 0.18, { type: "triangle" }); },
  // 레오파드 게코는 가끔 "끽끽" 하고 짧게 운다
  chirp: (c) => { tone(c, 0, 2200, 0.05, { to: 1500, vol: 0.12 }); tone(c, 0.08, 2400, 0.05, { to: 1600, vol: 0.12 }); },
  eat: (c) => [0, 0.16, 0.32, 0.5].forEach((t) => crunch(c, t)),
  start: (c) => notes(c, [523, 659, 784], 0.08, { type: "square", vol: 0.06 }),
  catch: (c) => tone(c, 0, 880, 0.1, { type: "square", vol: 0.07, to: 1760 }),
  yay: (c) => notes(c, [659, 784, 1047], 0.1, { type: "triangle" }),
  pick: (c) => { tone(c, 0, 500, 0.06, { type: "triangle", vol: 0.12 }); tone(c, 0.08, 800, 0.1, { to: 1400, vol: 0.1 }); },
  clean: (c) => { for (let i = 0; i < 5; i++) tone(c, i * 0.09, 1200 + i * 250, 0.12, { vol: 0.07 }); },
  water: (c) => { for (let i = 0; i < 6; i++) tone(c, i * 0.12, 300 + Math.random() * 300, 0.1, { to: 700, vol: 0.09 }); },
  sleep: (c) => notes(c, [784, 659, 523, 392], 0.28, { vol: 0.1 }),
  wake: (c) => notes(c, [523, 659, 784, 1047], 0.1, { type: "triangle", vol: 0.12 }),
  grow: (c) => {
    notes(c, [523, 659, 784, 1047], 0.12, { type: "triangle" });
    [523, 659, 784].forEach((fq) => tone(c, 0.5, fq, 0.8, { type: "triangle", vol: 0.08 }));
  },
  poop: (c) => tone(c, 0, 320, 0.18, { to: 90, vol: 0.18 }),
  lamp: (c) => { tone(c, 0, 1400, 0.03, { type: "square", vol: 0.06 }); tone(c, 0.05, 900, 0.03, { type: "square", vol: 0.05 }); },
};

function sfx(name) {
  if (muted) return;
  const file = soundFiles[name];
  if (file) { file.cloneNode().play().catch(() => {}); return; }
  const c = audioCtx();
  if (c && SYNTH[name]) SYNTH[name](c);
}

function updateBgm() {
  const b = soundFiles.bgm;
  if (!b) return;
  b.loop = true;
  b.volume = 0.25;
  if (muted || !unlocked) b.pause();
  else b.play().catch(() => {});
}

// 서버에 소리 파일이 있는지 확인 (없으면 기본 효과음)
for (const name of [...Object.keys(SYNTH), "bgm"]) {
  const url = SOUND_DIR + name + ".mp3";
  fetch(url).then((r) => {
    if (!r.ok) return;
    soundFiles[name] = new Audio(url);
    if (name === "bgm") updateBgm();
  }).catch(() => {});
}

// 브라우저는 사용자가 화면을 한 번 터치해야 소리를 낼 수 있다
document.addEventListener("pointerdown", () => { unlocked = true; audioCtx(); updateBgm(); }, { once: true });

function nope(text) {
  sfx("nope");
  say(text);
}

// ---- 행동 ----
// action: 지금 하고 있는 동작(eat/play). 그림과 애니메이션이 바뀐다.
// busy: 활동이 진행 중이라 다른 버튼을 막는 상태
let action = null, actionTimer, busy = false;
function setAction(name, ms) {
  action = name;
  clearTimeout(actionTimer);
  if (name !== "play") stopWalk();
  render();
  actionTimer = setTimeout(() => { action = null; render(); }, ms);
}

// ---- 돌아다니기 ----
// petX: #pet의 left(방 너비 %). #pet 너비가 55%라 0~45 사이를 오간다.
const PET_MIN_X = 2, PET_MAX_X = 43, PET_CENTER_X = 22.5, HIDE_X = 0;
let petX = PET_CENTER_X, facing = 1, wanderTimer, walkEndTimer;

// x까지 speed(%/초)로 걸어간다. 걸리는 시간(초)을 돌려준다.
function walkTo(x, speed) {
  const pet = $("pet");
  const dist = Math.abs(x - petX);
  if (dist < 1) return 0;
  facing = x > petX ? 1 : -1;
  const sec = dist / speed;
  pet.style.transition = `left ${sec}s linear`;
  pet.style.left = x + "%";
  pet.style.setProperty("--face", facing);
  pet.classList.add("walking");
  petX = x;
  clearTimeout(walkEndTimer);
  walkEndTimer = setTimeout(() => pet.classList.remove("walking"), sec * 1000);
  return sec;
}

// 걷던 자리에서 바로 멈춘다 (밥 먹기, 씻기 등)
function stopWalk() {
  const pet = $("pet");
  petX = (pet.offsetLeft / $("room").clientWidth) * 100;
  pet.style.transition = "none";
  pet.style.left = petX + "%";
  pet.classList.remove("walking");
  clearTimeout(walkEndTimer);
}

function placeAt(x) {
  stopWalk();
  petX = x;
  $("pet").style.left = x + "%";
}

const randX = () => PET_MIN_X + Math.random() * (PET_MAX_X - PET_MIN_X);

// 몇 초마다 다음 행동을 고른다. 레오파드 게코는 천천히 걷다가 자주 멈춰 쉰다.
function wander() {
  clearTimeout(wanderTimer);
  let sec = 0, pause = 1500 + Math.random() * 3500;
  if (stage().key === "egg") {
    if (petX !== PET_CENTER_X) placeAt(PET_CENTER_X);
  } else if (state.sleeping) {
    sec = walkTo(HIDE_X, 4); // 잘 때는 은신처 옆으로
  } else if (!busy && !action && tempZone() === "hot") {
    sec = walkTo(HIDE_X, 5); // 더우면 그늘진 은신처로 피한다
  } else if (!busy && !action && tempZone() === "cold") {
    if (Math.random() < 0.1) sec = walkTo(randX(), 1.5); // 추우면 몸이 굳어 거의 안 움직인다
  } else if (action === "play") {
    sec = walkTo(randX(), 14); // 벌레 잡기 중에는 재빠르게
    pause = 200;
  } else if (!busy && !action) {
    const sad = mood().face === "sad";
    if (Math.random() < (sad ? 0.3 : 0.7)) sec = walkTo(randX(), sad ? 3 : 6);
  }
  wanderTimer = setTimeout(wander, sec * 1000 + pause);
}

// 방 안에 효과(먹이, 벌레, 거품)를 띄운다. 위치는 방 크기 기준 %
function spawn(cls, text, x, y) {
  const el = document.createElement("div");
  el.className = "fx " + cls;
  el.textContent = text;
  el.style.left = x + "%";
  el.style.top = y + "%";
  $("room").appendChild(el);
  return el;
}

// 실제 레오파드 게코는 살아있는 곤충을 먹는다. 밀웜은 지방이 많은 간식.
const FOODS = {
  cricket: { icon: "🦗", hunger: 30, happy: 5, msg: "냠냠! 귀뚜라미 최고!" },
  worm: { icon: "🐛", hunger: 20, happy: 12, msg: "밀웜은 간식이라 너무 맛있어요!" },
};

function giveFood(kind) {
  $("foodPicker").style.display = "none";
  const f = FOODS[kind];
  if (!f) { busy = false; return render(); }
  sfx("tap");
  const el = spawn("food", f.icon, 12, 15);
  // 먹이는 게코 입 쪽으로 날아간다 (오른쪽을 보면 오른쪽 끝, 왼쪽을 보면 왼쪽 끝)
  const p = $("pet").getBoundingClientRect(), room = $("room").getBoundingClientRect();
  const mouthX = p.left + p.width * (facing > 0 ? 0.85 : 0.15);
  const tx = ((mouthX - room.left) / room.width) * 100;
  const ty = ((p.top + p.height * 0.45 - room.top) / room.height) * 100;
  // 다음 프레임에 위치를 바꿔야 날아가는 transition이 보인다
  requestAnimationFrame(() => requestAnimationFrame(() => { el.style.left = tx + "%"; el.style.top = ty + "%"; }));
  setTimeout(() => {
    el.remove();
    tick();
    state.hunger = clamp(state.hunger + f.hunger);
    state.happy = clamp(state.happy + f.happy);
    if (state.digest.length < MAX_DIGEST) {
      state.digest.push(state.ageMin + DIGEST_MIN + Math.random() * DIGEST_RAND);
      state.digest.sort((a, b) => a - b);
    }
    busy = false;
    setAction("eat", 1500);
    sfx("eat");
    say(f.msg);
  }, 900);
}

const BUG_GAME_MS = 8000;
// 놀아주기: 방 안을 돌아다니는 귀뚜라미를 아이가 톡톡 잡는 미니게임
function startBugGame() {
  busy = true;
  let caught = 0;
  setAction("play", BUG_GAME_MS);
  wander();
  sfx("start");
  $("bubble").textContent = "벌레를 잡아요! 톡톡!";
  const spawner = setInterval(() => {
    const bug = spawn("bug", "🦗", 10 + Math.random() * 80, 25 + Math.random() * 60);
    bug.addEventListener("pointerdown", () => {
      if (bug.dataset.done) return;
      bug.dataset.done = "1";
      caught++;
      sfx("catch");
      bug.textContent = "✨";
      $("bubble").textContent = `${caught}마리 잡았다!`;
      setTimeout(() => bug.remove(), 300);
    });
    setTimeout(() => { if (!bug.dataset.done) bug.remove(); }, 1300);
  }, 650);
  setTimeout(() => {
    clearInterval(spawner);
    $("room").querySelectorAll(".bug").forEach((b) => b.remove());
    tick();
    state.happy = clamp(state.happy + 10 + caught * 3);
    state.hunger = clamp(state.hunger + caught * 2);
    state.energy = clamp(state.energy - 10);
    busy = false;
    sfx(caught ? "yay" : "tap");
    say(caught ? `${caught}마리나 잡았어요! 신난다!` : "다음엔 꼭 잡아보자!");
  }, BUG_GAME_MS);
}

// 반짝이 효과를 (x, y) 근처에 n개 띄운다
function sparkle(n, x, y, spread) {
  for (let i = 0; i < n; i++) {
    setTimeout(() => {
      const s = spawn("rise-fx", "✨", x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread * 0.6);
      setTimeout(() => s.remove(), 1800);
    }, i * 80);
  }
}

// ---- 청소 ----
// 실제 레오파드 게코는 목욕시키지 않는다. 대신 매일 응가를 집게로 치우고(스팟 청소) 물을 갈아준다.
// 응가 자리(방 기준 %): 물그릇 옆 한쪽 구석
const POOP_SLOTS = [[64, 91], [70, 93], [67, 85]];
let cleaning = false, cleanTimer;

function renderPoops() {
  const box = $("poops");
  const live = [...box.children].filter((c) => !c.dataset.picked);
  live.slice(state.poopCount).forEach((c) => c.remove());
  for (let n = live.length; n < state.poopCount; n++) {
    const used = [...box.children].filter((c) => !c.dataset.picked).map((c) => c.dataset.slot);
    const slot = POOP_SLOTS.findIndex((_, i) => !used.includes(String(i)));
    const el = document.createElement("div");
    el.className = "poop";
    el.textContent = "💩";
    el.dataset.slot = slot;
    el.style.left = POOP_SLOTS[slot][0] + "%";
    el.style.top = POOP_SLOTS[slot][1] + "%";
    el.addEventListener("pointerdown", () => pickPoop(el));
    box.appendChild(el);
  }
  box.classList.toggle("pickable", cleaning);
}

// 응가를 집게로 집어 치운다. 청소 중이 아니어도 바로 눌러서 치울 수 있다.
function pickPoop(el) {
  if (el.dataset.picked || (busy && !cleaning)) return;
  el.dataset.picked = "1";
  state.poopCount = Math.max(0, state.poopCount - 1);
  sfx("pick");
  el.classList.add("picked");
  const tongs = spawn("tongs", "🥢", parseFloat(el.style.left), parseFloat(el.style.top) - 10);
  setTimeout(() => { el.remove(); tongs.remove(); }, 600);
  save();
  if (cleaning && state.poopCount === 0) finishCleaning();
  else if (!cleaning) { state.clean = clamp(state.clean + 20); say("응가 치웠어요!"); }
}

function startCleaning() {
  if (state.poopCount === 0) return wipeCage();
  busy = true;
  cleaning = true;
  sfx("tap");
  render();
  $("bubble").textContent = "응가를 톡 눌러서 치워요!";
  cleanTimer = setTimeout(finishCleaning, 15000); // 다 못 치워도 15초 뒤 끝난다
}

function finishCleaning() {
  clearTimeout(cleanTimer);
  cleaning = false;
  busy = false;
  wipeCage();
}

// 바닥재 정리 + 유리 닦기. 응가가 남아 있으면 완전히 깨끗해지지는 않는다.
function wipeCage() {
  sfx("clean");
  sparkle(10, 50, 60, 70);
  state.clean = state.poopCount ? Math.max(state.clean, 60) : 100;
  say(state.poopCount ? "아직 응가가 남았어요" : "반짝반짝 깨끗해졌어요!");
  render();
}

function changeWater() {
  if (busy) return;
  tick();
  sfx("water");
  state.water = 100;
  state.happy = clamp(state.happy + 3);
  sparkle(4, 85, 88, 14);
  say("시원한 새 물이에요!");
  render();
}

// 물이 줄수록 물그릇 수위가 낮아지고 색이 탁해진다
function renderWater() {
  const w = state.water / 100;
  const mix = (a, b) => Math.round(b + (a - b) * w);
  $("waterFill").setAttribute("ry", (3 + 5 * w).toFixed(1));
  $("waterFill").setAttribute("fill", `rgb(${mix(110, 141)},${mix(198, 154)},${mix(255, 91)})`);
}

function renderBars() {
  $("s-hunger").value = state.hunger;
  $("s-happy").value = state.happy;
  $("s-energy").value = state.energy;
  $("s-clean").value = state.clean;
  $("s-water").value = state.water;
  renderPoops();
  renderWater();
}

const ACTIONS = {
  feed() {
    if (state.sleeping) return nope("쿨쿨 자는 중이에요");
    if (state.hunger > 95) return nope("배불러요!");
    // 파충류는 몸이 따뜻해야 소화를 할 수 있다
    if (tempZone() === "cold") return nope("추워서 소화가 안 돼요. 램프를 켜주세요");
    sfx("tap");
    busy = true;
    render();
    $("bubble").textContent = "무엇을 먹을까요?";
    $("foodPicker").style.display = "";
    stopWalk();
  },
  play() {
    if (state.sleeping) return nope("쿨쿨 자는 중이에요");
    if (state.energy < 15) return nope("너무 졸려서 못 놀아요");
    startBugGame();
  },
  sleep() {
    state.sleeping = !state.sleeping;
    sfx(state.sleeping ? "sleep" : "wake");
    say(!state.sleeping ? "안녕! 잘 잤어요" : state.lampOn ? "잘 자요~ 램프를 끄면 더 잘 자요" : "잘 자요~");
    wander();
  },
  // 청소와 물 갈기는 게코가 자는 동안에도 할 수 있다
  clean() { startCleaning(); },
  water() { changeWater(); },
};

let sayTimer;
function say(text) {
  $("bubble").textContent = text;
  clearTimeout(sayTimer);
  sayTimer = setTimeout(render, 2000);
  save();
  renderStatsOnly();
}
function renderStatsOnly() {
  renderBars();
  $("sleepBtn").textContent = state.sleeping ? "☀️ 깨우기" : "🌙 재우기";
  $("room").classList.toggle("night", state.sleeping);
  renderTemp();
  $("dark").hidden = !state.sleeping;
}

const TEMP_WORD = { cold: "추워요", ok: "", good: "딱 좋아요", hot: "더워요" };
function renderTemp() {
  const z = tempZone();
  $("temp").textContent = Math.round(state.temp) + "°C" + (TEMP_WORD[z] ? " " + TEMP_WORD[z] : "");
  $("thermo").dataset.zone = z;
  $("room").classList.toggle("lamp-off", !state.lampOn);
  $("lampBtn").textContent = state.lampOn ? "🔥 히팅램프 끄기" : "💡 히팅램프 켜기";
}

function toggleLamp() {
  tick();
  state.lampOn = !state.lampOn;
  sfx("lamp");
  say(state.lampOn ? "램프 켜짐! 점점 따뜻해져요" : "램프 꺼짐! 점점 시원해져요");
  render();
}
$("lampBtn").addEventListener("click", toggleLamp);
$("dish").addEventListener("click", changeWater);
$("lamp").addEventListener("click", toggleLamp);

document.querySelectorAll("[data-act]").forEach((b) =>
  b.addEventListener("click", () => {
    if (busy) return;
    tick();
    if (stage().key === "egg") return nope("아직 알이에요! 조금만 기다려줘요");
    ACTIONS[b.dataset.act]();
  }));

// 게코를 톡 건드리면 "끽끽" 하고 반응한다
const PET_TALK = ["끽끽!", "간지러워요!", "안녕! 반가워요", "또 만져줘요!"];
let lastPetTap = 0;
$("pet").addEventListener("pointerdown", () => {
  const now = Date.now();
  if (busy || now - lastPetTap < 800) return;
  lastPetTap = now;
  if (stage().key === "egg") { sfx("tap"); return say("알이 따뜻해요..."); }
  if (state.sleeping) return say("쿨쿨... (깨우지 말아요)");
  sfx("chirp");
  state.happy = clamp(state.happy + 2);
  say(PET_TALK[Math.floor(Math.random() * PET_TALK.length)]);
});

function renderMute() {
  $("muteBtn").textContent = muted ? "🔇" : "🔊";
  $("muteBtn").setAttribute("aria-label", muted ? "소리 켜기" : "소리 끄기");
}
$("muteBtn").addEventListener("click", () => {
  muted = !muted;
  try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (e) {}
  renderMute();
  updateBgm();
  sfx("tap");
});
renderMute();
document.querySelectorAll("[data-food]").forEach((b) =>
  b.addEventListener("click", () => giveFood(b.dataset.food)));

// ---- 수학 미션 ----
// 사칙연산 5문제 중 4개 이상 맞히면 칼슘 영양제를 받는다 (성장이 빨라지고 행복해진다).
// 진짜 레오파드 게코도 먹이에 칼슘 가루를 묻혀 줘야 뼈가 튼튼하게 자란다.
// 영양제는 하루 MATH_DAILY번까지만 주고, 그 뒤로는 연습만 할 수 있다.
const MATH_COUNT = 5, MATH_PASS = 4, MATH_DAILY = 3;
const MATH_GROW_MIN = 60, MATH_HAPPY = 15;
// 학년별로 배우는 연산 (초등 교육과정 기준): 2학년 곱셈구구, 3학년 나눗셈
const MATH_OPS = { 2: ["+", "-", "×"], 3: ["+", "-", "×", "÷"] };
const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const today = () => new Date().toDateString();
const mathLeft = () => Math.max(0, MATH_DAILY - (state.mathDay === today() ? state.mathClears : 0));
let quiz = null, mathSay = "";

function makeProblem(grade) {
  const ops = MATH_OPS[grade] || MATH_OPS[2];
  const op = ops[rand(0, ops.length - 1)];
  let a, b;
  if (op === "+") {
    [a, b] = grade === 2 ? [rand(10, 99), rand(10, 99)] // 두 자리 + 두 자리
      : [rand(100, 999), rand(100, 999)];              // 세 자리 + 세 자리
  } else if (op === "-") {
    // 답이 0보다 작아지지 않게 빼는 수는 항상 작게
    a = grade === 2 ? rand(20, 99) : rand(200, 999);
    b = grade === 2 ? rand(10, a) : rand(100, a);
  } else if (op === "×") {
    [a, b] = grade === 2 ? [rand(2, 9), rand(1, 9)]   // 곱셈구구
      : [rand(11, 99), rand(2, 9)];                    // 두 자리 × 한 자리
  } else {
    b = rand(2, 9);
    a = b * rand(1, 9);                                // 곱셈구구 안에서 나누어떨어지는 나눗셈
  }
  const answer = { "+": a + b, "-": a - b, "×": a * b, "÷": a / b }[op];
  return { text: `${a} ${op === "-" ? "−" : op} ${b}`, answer };
}

function showMathView(id) {
  for (const v of ["mathIntro", "mathQuiz", "mathResult"]) $(v).hidden = v !== id;
}

function openMath() {
  if (busy) return;
  tick();
  busy = true;
  render();
  showMathIntro();
  $("mathPanel").hidden = false;
  sfx("tap");
}

function closeMath() {
  $("mathPanel").hidden = true;
  quiz = null;
  busy = false;
  render();
  if (mathSay) { say(mathSay); mathSay = ""; }
}

function showMathIntro() {
  quiz = null;
  document.querySelectorAll("[data-grade]").forEach((b) => {
    const on = Number(b.dataset.grade) === state.mathGrade;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on);
  });
  $("mathReward").textContent = `성장 ${MATH_GROW_MIN / 60}시간 빨라짐 · 행복 +${MATH_HAPPY}`;
  const left = mathLeft();
  $("mathToday").textContent = left ? `오늘 받을 수 있는 영양제: 🦴 ${left}개`
    : "오늘 영양제는 다 받았어요! 연습은 계속할 수 있어요";
  showMathView("mathIntro");
}

function startQuiz() {
  const list = [];
  while (list.length < MATH_COUNT) {
    const p = makeProblem(state.mathGrade);
    if (!list.some((q) => q.text === p.text)) list.push(p);
  }
  quiz = { list, i: 0, input: "", results: [], locked: false };
  sfx("start");
  showMathView("mathQuiz");
  renderQuiz();
}

function renderQuiz() {
  const q = quiz.list[quiz.i];
  $("mathDots").innerHTML = quiz.list.map((_, i) =>
    `<span class="${quiz.results[i] === true ? "ok" : quiz.results[i] === false ? "no" : i === quiz.i ? "now" : ""}"></span>`).join("");
  $("mathQ").textContent = q.text + " = ?";
  $("mathA").textContent = quiz.input || " ";
}

// 화면 숫자판과 키보드 둘 다 이 함수로 들어온다. k: 숫자 / "del" / "ok"
function mathKey(k) {
  if (!quiz || quiz.locked) return;
  if (k === "ok") return checkAnswer();
  if (k === "del") quiz.input = quiz.input.slice(0, -1);
  else if (quiz.input.length < 4) quiz.input = (quiz.input === "0" ? "" : quiz.input) + k;
  sfx("tap");
  renderQuiz();
}

function checkAnswer() {
  if (!quiz.input) return;
  const cur = quiz, q = cur.list[cur.i], ok = Number(cur.input) === q.answer;
  cur.results.push(ok);
  cur.locked = true;
  sfx(ok ? "catch" : "nope");
  // 틀리면 정답을 보여 줘서 바로 배우게 한다
  $("mathFeedback").textContent = ok ? "딩동댕! ⭕" : `아쉬워요! 정답은 ${q.answer}`;
  $("mathFeedback").className = ok ? "ok" : "no";
  renderQuiz();
  setTimeout(() => {
    if (quiz !== cur) return; // 그 사이 창을 닫았으면 그만
    cur.i++;
    cur.input = "";
    cur.locked = false;
    $("mathFeedback").textContent = "";
    $("mathFeedback").className = "";
    if (cur.i < MATH_COUNT) renderQuiz();
    else finishQuiz();
  }, ok ? 900 : 1800);
}

function finishQuiz() {
  const score = quiz.results.filter(Boolean).length;
  $("mathScore").textContent = "⭐".repeat(score) + "☆".repeat(MATH_COUNT - score) + `\n${score} / ${MATH_COUNT}`;
  let msg;
  if (score < MATH_PASS) {
    msg = `아깝다! ${MATH_PASS}개 이상 맞히면 영양제를 받아요`;
    sfx("tap");
  } else if (mathLeft()) {
    msg = giveCalcium();
  } else {
    // 하루 영양제는 다 받았어도 공부한 만큼 조금 기뻐한다
    tick();
    state.happy = clamp(state.happy + 5);
    save();
    msg = "최고예요! 오늘 영양제는 다 받았지만 게코가 기뻐해요";
    mathSay = "공부하는 모습 멋져요!";
    sfx("yay");
  }
  $("mathMsg").textContent = msg;
  showMathView("mathResult");
}

function giveCalcium() {
  tick();
  const before = stage();
  if (state.mathDay !== today()) { state.mathDay = today(); state.mathClears = 0; }
  state.mathClears++;
  state.careMin += MATH_GROW_MIN;
  state.happy = clamp(state.happy + MATH_HAPPY);
  save();
  const grew = stage() !== before;
  sfx(grew ? "grow" : "yay");
  mathSay = grew ? `와! ${stage().name}로 자랐어요!` : "칼슘 먹고 뼈가 튼튼해졌어요!";
  return `미션 클리어! 🦴 칼슘 영양제를 받았어요\n성장 ${MATH_GROW_MIN / 60}시간 빨라짐 · 행복 +${MATH_HAPPY}`;
}

$("mathBtn").addEventListener("click", openMath);
$("mathClose").addEventListener("click", closeMath);
$("mathDone").addEventListener("click", closeMath);
$("mathStart").addEventListener("click", startQuiz);
$("mathAgain").addEventListener("click", startQuiz);
document.querySelectorAll("[data-grade]").forEach((b) =>
  b.addEventListener("click", () => {
    state.mathGrade = Number(b.dataset.grade);
    save();
    sfx("tap");
    showMathIntro();
  }));
document.querySelectorAll("[data-key]").forEach((b) =>
  b.addEventListener("click", () => mathKey(b.dataset.key)));
document.addEventListener("keydown", (e) => {
  if ($("mathPanel").hidden) return;
  if (e.key === "Escape") closeMath();
  else if (/^[0-9]$/.test(e.key)) mathKey(e.key);
  else if (e.key === "Backspace") mathKey("del");
  else if (e.key === "Enter" && quiz) { e.preventDefault(); mathKey("ok"); }
});

// ---- 알 낳기 / 가족 앨범 ----
// 다 키운 어른은 이름·세대·함께한 기간을 앨범에 남기고, 다음 세대가 알부터 다시 시작한다.
// 학년·수학 기록·램프·온도·물그릇은 사육장 그대로라 이어진다.
const ALBUM_IMG = IMG_DIR + "adult_happy.png";
let albumNews = false; // 방금 알을 낳아서 열린 앨범인지

// "도마" → "도마 2세", "도마 2세" → "도마 3세" (이름 칸 최대 10글자에 맞춘다)
function babyName(name, gen) {
  const suffix = ` ${gen}세`;
  return name.replace(/\s*\d+세$/, "").slice(0, 10 - suffix.length) + suffix;
}

function layEgg() {
  const parent = { name: state.name, gen: state.gen, born: state.born, laid: Date.now() };
  const keep = {
    history: state.history.concat(parent), gen: state.gen + 1, name: babyName(state.name, state.gen + 1),
    mathGrade: state.mathGrade, mathDay: state.mathDay, mathClears: state.mathClears,
    lampOn: state.lampOn, temp: state.temp, water: state.water,
  };
  state = Object.assign(newState(), keep);
  save();
  shownKey = "";
  render();
  wander();
  sfx("grow");
  openAlbum(true);
}

const fmtDate = (t) => new Date(t).toLocaleDateString("ko-KR");
// 받침이 있으면 a(이/을), 없으면 b(가/를). 한글이 아니면 받침 없는 쪽.
function josa(word, a, b) {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 ? a : b;
}

function renderAlbum() {
  const list = $("albumList");
  list.innerHTML = "";
  $("albumEmpty").hidden = state.history.length > 0;
  // 최근에 남긴 사진이 맨 앞
  for (const h of [...state.history].reverse()) {
    const card = document.createElement("figure");
    card.className = "photo";
    const img = document.createElement("img");
    img.src = ALBUM_IMG;
    img.alt = h.name;
    // 그림 파일이 없으면 SVG 도마뱀으로 대신한다
    img.onerror = () => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 200 140");
      svg.innerHTML = lizardSvg(STAGES[STAGES.length - 1], "happy");
      img.replaceWith(svg);
    };
    const days = Math.max(1, Math.round((h.laid - h.born) / 86400000));
    const cap = document.createElement("figcaption");
    cap.innerHTML = `<b></b><span>${h.gen}대 · 함께한 시간 ${days}일</span><small>${fmtDate(h.born)} ~ ${fmtDate(h.laid)}</small>`;
    cap.querySelector("b").textContent = h.name; // 이름은 아이가 입력한 글자라 textContent로
    card.append(img, cap);
    list.appendChild(card);
  }
}

function openAlbum(news) {
  if (busy) return;
  busy = true;
  albumNews = news;
  const last = state.history[state.history.length - 1];
  $("albumNews").hidden = !news;
  if (news) $("albumNews").textContent = `🥚 ${last.name}${josa(last.name, "이", "가")} 알을 낳고 앨범에 남았어요!\n새 아기 ${state.name}${josa(state.name, "을", "를")} 잘 키워 주세요`;
  renderAlbum();
  $("albumPanel").hidden = false;
  render();
  if (!news) sfx("tap");
}

function closeAlbum() {
  $("albumPanel").hidden = true;
  busy = false;
  render();
  if (albumNews) {
    albumNews = false;
    say("새 아기 이름을 지어 주세요!");
    $("nameInput").focus();
    $("nameInput").select();
  }
}

$("albumBtn").addEventListener("click", () => openAlbum(false));
$("albumClose").addEventListener("click", closeAlbum);
$("albumDone").addEventListener("click", closeAlbum);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("albumPanel").hidden) closeAlbum(); });

$("nameInput").addEventListener("input", (e) => {
  state.name = e.target.value.trim() || "도마";
  save();
});
$("resetBtn").addEventListener("click", () => {
  if (confirm("정말 처음부터 다시 시작할까요?")) { state = newState(); save(); render(); }
});

// 아이가 읽기 쉽게 큰 단위 두 개까지만: "1일 3시간", "2시간 10분", "5분", "곧!"
function fmtLeft(m) {
  if (m < 1) return "곧!";
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  if (d) return `${d}일 ${h}시간 남음`;
  if (h) return `${h}시간 ${Math.floor(m % 60)}분 남음`;
  return `${Math.ceil(m)}분 남음`;
}

function fmtMin(m) {
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = Math.floor(m % 60);
  return (d ? d + "일 " : "") + (d || h ? h + "시간 " : "") + mm + "분";
}

if (TEST) {
  $("testBar").hidden = false;
  $("testSpeed").textContent = TEST_SPEED;
  // 시간 건너뛰기: 마지막 계산 시각을 과거로 돌려서 "게임을 꺼 둔 시간"처럼 처리한다
  document.querySelectorAll("[data-skip]").forEach((b) =>
    b.addEventListener("click", () => {
      if (busy) return;
      state.last -= Number(b.dataset.skip) * 60000;
      tick();
    }));
}

// 안내서에 다녀와도 같은 프로필(?p=)·테스트 모드로 돌아오게 주소 뒷부분을 붙여 준다
$("helpLink").href = "help.html" + location.search;

document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
setInterval(tick, 5000);

const cageProbe = new Image();
cageProbe.onload = () => {
  $("room").style.backgroundImage = `url(${CAGE_BG})`;
  $("room").classList.add("has-bg");
};
cageProbe.src = CAGE_BG;

render();
wander();
loadFromServer().then(() => {
  if (!serverReady && !noServer) setInterval(() => { if (!serverReady && !noServer) loadFromServer(); }, 15000);
  tick();
});
