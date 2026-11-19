"use strict";

const params = new URLSearchParams(location.search);
// 테스트 모드: ?test=1 이면 성장 2000배, ?test=500 처럼 배속 지정 가능.
// 성장 시간만 빨라지고(상태 감소는 그대로), 실제 게코와 따로 저장된다.
const TEST_SPEED = !params.has("test") ? 1 : Number(params.get("test")) > 1 ? Number(params.get("test")) : 2000;
const TEST = TEST_SPEED > 1;
const SAVE_KEY = "critter-craft-v1" + (TEST ? "-test" : "");
const MAX_OFFLINE_MIN = 24 * 60; // 오래 자리를 비워도 최대 24시간치만 반영
const OFFLINE_GAP_MIN = 2;       // 이보다 오래 계산이 멈췄으면 게임을 꺼 둔 것으로 본다
const OFFLINE_FACTOR = 0.2;      // 꺼 둔 동안은 상태가 0.2배 속도로 줄어든다
const STEP_MIN = 5;              // 긴 시간은 5분씩 나눠 계산 (돌봄 여부를 중간중간 확인)
// 분당 변화량 (밤에 자는 중에는 SLEEP_* 적용)
// clean은 사육장 깨끗함. 대부분 응가 때문에 더러워지고, 바닥재 먼지로 조금씩 줄어든다.
// v0.11.0: 아이 요청으로 난이도를 올렸다 (원래 hunger 1.8, happy 0.8, energy 1.0, clean 0.3)
const DECAY = { hunger: 2.3, happy: 1.05, energy: 1.25, clean: 0.38 };
const SLEEP = { hunger: 0.5, happy: 0.15, energy: -4, clean: 0.05 };
// 응가: 먹고 나서 15~35분 뒤에 나온다 (실제 소화보다 훨씬 빠르게 해서 자주 치우게). 레오파드 게코는 한쪽 구석에만 응가한다.
const DIGEST_MIN = 15, DIGEST_RAND = 20, MAX_DIGEST = 6, MAX_POOP = 5;
const POOP_DIRT = 0.45; // 응가 하나당 분당 깨끗함 감소
// 물그릇: 하루쯤 지나면 물을 갈아줘야 한다. 꺼 둔 동안에도 같은 속도로 줄어든다(매일 물 갈기 습관).
// 상점에서 물그릇을 업그레이드하면 천천히 줄어든다.
const WATER_RATE = 0.09, THIRSTY = 20;
// 평균 상태가 이 이상인 시간만 성장 시간(careMin)으로 친다. 알은 돌볼 수 없으니 시간만 흐르면 된다.
const CARE_AVG = 55;
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
// 모프(색 변이): 알에서 아기 게코로 깨어날 때 랜덤으로 하나 정해진다.
// 노멀은 assets/lizard/ 그림을, 나머지는 assets/lizard/<key>/ 폴더의 같은 이름 그림을 쓴다.
const MORPHS = [
  { key: "normal", name: "노멀" },
  { key: "tangerine", name: "탠저린" },
  { key: "macksnow", name: "맥 스노우" },
  { key: "blizzard", name: "블리자드" },
  { key: "lavender", name: "라벤더" },
  { key: "albino", name: "알비노" },
  { key: "blacknight", name: "블랙나이트" },
  { key: "sunglow", name: "썬글로우" },
];
const morphOf = (key) => MORPHS.find((m) => m.key === key) || MORPHS[0];
const morphDir = (key) => IMG_DIR + (morphOf(key).key === "normal" ? "" : morphOf(key).key + "/");
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
// 습도: 분무하면 오르고, 시간이 지나면 방 습도 쪽으로 내려간다 (램프를 켜 두면 더 건조).
// 레오파드 게코는 평소 30~60%면 충분하고, 허물 벗을 때는 60% 이상 촉촉해야 잘 벗는다.
const HUMID_RATE = 0.012, HUMID_DRY = { lampOn: 30, lampOff: 40 };
const MIST_UP = 30, WATER_HUMID_UP = 8, TOO_HUMID = 85;
// 탈피: 다음 성장 단계까지 SHED_AT% 오면 몸이 하얘지고(탈피 직전),
// 습도 SHED_HUMID% 이상인 시간이 SHED_WET_MIN분 쌓이면 허물을 벗는다.
const SHED_AT = 80, SHED_HUMID = 60, SHED_WET_MIN = 30;
// 상점 업그레이드: 놀아주기로 모은 코인으로 사육장을 좋게 바꾼다. 단계는 1(처음)~3.
// fx: 단계별 배율 (hide.happy: 심심해지는 속도, hide.rest: 잘 때 에너지 회복, dish.water: 물이 줄어드는 속도,
//     floor.dust: 먼지로 더러워지는 속도, floor.poop: 응가 때문에 더러워지는 속도)
const UPGRADES = [
  { id: "hide", icon: "🪨", name: "은신처", fx: { happy: [1, 0.85, 0.7], rest: [1, 1.3, 1.6] }, levels: [
    { name: "바위 동굴" },
    { name: "이끼 동굴", price: 40, desc: "덜 심심해요 · 잘 때 에너지가 더 빨리 차요" },
    { name: "수정 동굴", price: 100, desc: "훨씬 덜 심심해요 · 아주 푹 자요" },
  ] },
  { id: "dish", icon: "💧", name: "물그릇", fx: { water: [1, 0.65, 0.4] }, levels: [
    { name: "도자기 물그릇" },
    { name: "큰 파란 물그릇", price: 30, desc: "물이 더 천천히 줄어요" },
    { name: "황금 샘물 그릇", price: 80, desc: "물이 아주 천천히 줄어요 · 퐁퐁 물결" },
  ] },
  { id: "floor", icon: "🏖️", name: "바닥재", fx: { dust: [1, 0.6, 0.3], poop: [1, 0.8, 0.6] }, levels: [
    { name: "모래 바닥" },
    { name: "부드러운 흙", price: 35, desc: "사육장이 덜 더러워져요" },
    { name: "숲속 이끼 흙", price: 90, desc: "사육장이 훨씬 덜 더러워져요" },
  ] },
];
const upDef = (id) => UPGRADES.find((u) => u.id === id);
const upLv = (id) => Math.max(1, Math.min(3, Math.floor(state.upgrades[id]) || 1));
const upFx = (id, k) => upDef(id).fx[k][upLv(id) - 1];
// 놀이 코인: 벌레 1마리 1개, 사냥 1마리 3개, 숨바꼭질 1번 찾기 3개, 놀이를 완벽하게 하면 보너스
const COIN = { bug: 1, hunt: 3, hide: 3, perfect: 3 };

const $ = (id) => document.getElementById(id);
const clamp = (v) => Math.max(0, Math.min(100, v));

function newState() {
  const now = Date.now();
  return { name: "도마", hunger: 80, happy: 80, energy: 80, clean: 80,
           ageMin: 0, careMin: 0, sleeping: false, poopCount: 0, digest: [], water: 100,
           temp: 29, lampOn: true, mathGrade: 2, mathDay: "", mathClears: 0,
           mathSkill: {}, mathWrong: [], treats: 0,
           humidity: 45, shedPhase: "none", shedFor: "", shedWet: 0,
           stats: {}, decor: [], decorGot: [], decorSeen: [], coins: 0, upgrades: {},
           gen: 1, history: [], morph: null, born: now, last: now };
}

function fromSave(s) {
  const st = Object.assign(newState(), s);
  if (typeof s.careMin !== "number") st.careMin = s.ageMin || 0; // 돌봄 조건 이전 저장본
  if (typeof s.poopCount !== "number") st.poopCount = s.poop ? 1 : 0; // 응가가 하나뿐이던 저장본
  delete st.poop;
  // 모프가 없던 저장본: 이미 깨어난 게코는 원래 그림(노멀) 그대로, 알이면 깨어날 때 정한다
  if (!MORPHS.some((m) => m.key === st.morph)) st.morph = st.careMin >= STAGES[1].care ? "normal" : null;
  if (st.mathGrade !== 2 && st.mathGrade !== 3) st.mathGrade = 2; // 1학년이 있던 저장본
  if (typeof s.born !== "number") st.born = st.last - st.ageMin * 60000; // 태어난 시각이 없던 저장본
  // 실력 기록·오답 노트가 없던 저장본
  if (!st.mathSkill || typeof st.mathSkill !== "object" || Array.isArray(st.mathSkill)) st.mathSkill = {};
  if (!Array.isArray(st.mathWrong)) st.mathWrong = [];
  if (typeof st.treats !== "number") st.treats = 0;
  // 꾸미기가 없던 저장본
  if (!st.stats || typeof st.stats !== "object") st.stats = {};
  for (const k of ["decor", "decorGot", "decorSeen"]) if (!Array.isArray(st[k])) st[k] = [];
  // 상점이 없던 저장본
  if (typeof st.coins !== "number" || !(st.coins >= 0)) st.coins = 0;
  if (!st.upgrades || typeof st.upgrades !== "object" || Array.isArray(st.upgrades)) st.upgrades = {};
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
  // 상점 업그레이드: 좋은 은신처는 덜 심심하고 푹 자고, 좋은 바닥재는 먼지가 덜 난다
  const up = { hunger: 1, happy: upFx("hide", "happy"), energy: 1, clean: upFx("floor", "dust") };
  for (const k of ["hunger", "happy", "energy", "clean"]) {
    state[k] = clamp(state[k] - (r[k] > 0 ? r[k] * f * e[k] * up[k] : r[k] * e.rest * upFx("hide", "rest")) * min);
  }
  const target = f < 1 ? AUTO_TEMP[state.sleeping ? "night" : "day"] : state.lampOn ? LAMP_MAX : ROOM_TEMP;
  state.temp += (target - state.temp) * (1 - Math.exp(-TEMP_RATE * min));
  state.ageMin += min;
  if (state.sleeping && state.energy >= 100) state.sleeping = false;
  state.water = clamp(state.water - WATER_RATE * upFx("dish", "water") * min);
  while (state.digest.length && state.digest[0] <= state.ageMin) {
    state.digest.shift();
    state.poopCount = Math.min(MAX_POOP, state.poopCount + 1);
  }
  state.clean = clamp(state.clean - POOP_DIRT * upFx("floor", "poop") * state.poopCount * f * min);
  const dry = state.lampOn ? HUMID_DRY.lampOn : HUMID_DRY.lampOff;
  state.humidity = clamp(state.humidity + (dry - state.humidity) * (1 - Math.exp(-HUMID_RATE * min)));
  stepShed(min);
}

function stepShed(min) {
  if (stage().key === "egg") return;
  const next = nextGoal();
  if (state.shedPhase !== "pre" && state.shedPhase !== "ready" && state.shedFor !== next.key && growth() >= SHED_AT) {
    state.shedPhase = "pre";
    state.shedFor = next.key;
    state.shedWet = 0;
  }
  if (state.shedPhase === "pre") {
    if (state.humidity >= SHED_HUMID) state.shedWet += min;
    if (state.shedWet >= SHED_WET_MIN) state.shedPhase = "ready";
  }
}
const shedding = () => state.shedPhase === "pre" || state.shedPhase === "ready";

function tick() {
  const now = Date.now();
  const gap = (now - state.last) / 60000;
  const min = Math.min(gap, MAX_OFFLINE_MIN);
  const before = stage(), hadPoop = state.poopCount, wasSleeping = state.sleeping;
  const online = gap <= OFFLINE_GAP_MIN;
  state.last = now;
  if (min > 0) advance(min, !online);
  pickMorph();
  if (state.careMin >= LAY_GOAL.care && !busy) return layEgg();
  // 꺼 둔 사이에 허물 벗을 준비가 끝났으면, 그 사이에 벗고 먹은 것으로 친다
  let shedAway = false;
  if (!online && state.shedPhase === "ready") { state.shedPhase = "done"; shedAway = true; bump("shed"); }
  save();
  render();
  const after = stage();
  if (after !== before) { sfx("grow"); say(grewText(before, after)); }
  else if (shedAway) say("없는 동안 허물을 벗고 냠냠 먹었어요! ✨");
  // 켜 둔 동안 생긴 일만 소리를 낸다 (다시 열었을 때 한꺼번에 울리지 않게)
  else if (online && state.poopCount > hadPoop) sfx("poop");
  else if (online && wasSleeping && !state.sleeping) sfx("wake");
  maybeShed();
}

// 알에서 깨어났는데 모프가 아직 없으면 랜덤으로 정한다. 정해졌으면 true
function pickMorph() {
  if (state.morph || stage().key === "egg") return false;
  state.morph = MORPHS[Math.floor(Math.random() * MORPHS.length)].key;
  return true;
}
// 자랐을 때 말풍선. 알에서 깨어났으면 어떤 모프인지도 알려 준다.
// 처음 만난 모프면 도감에 새로 올라갔다고 알려 준다.
const grewText = (before, after) => before.key === "egg"
  ? `와! ${morphOf(state.morph).name} ${after.name}가 태어났어요!`
    + (state.history.some((h) => morphOf(h.morph).key === state.morph) ? "" : " 📖 도감 등록!")
  : `와! ${after.name}로 자랐어요!`;

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
  if (state.humidity > TOO_HUMID) return { face: "sad", text: "너무 축축해요... 램프로 말려 주세요" };
  if (state.shedPhase === "pre" && state.humidity < SHED_HUMID) return { face: "ok", text: "허물 벗을 때예요! 💦 분무해 주세요" };
  if (state.shedPhase === "pre") return { face: "ok", text: "촉촉해서 허물이 들뜨고 있어요..." };
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
// 그림 속 눈·입 위치 (그림 기준 0~100). 모든 그림이 머리가 오른쪽이라 단계별로 거의 같다.
// eye: [x, y, 반지름], eye2: 건너편 눈(보이는 경우), mouth: 혀가 나오는 입 앞쪽
const HEAD = {
  hatchling: { eye: [75.8, 38.3, 4.3], mouth: [85.5, 42.8] },
  juvenile: { eye: [76.2, 38.5, 4.3], mouth: [85.5, 43] },
  adult: { eye: [77.5, 37.1, 3.7], eye2: [89.2, 34.9, 1.8], mouth: [86.5, 41.5] },
};
const HEAD_SAD = { adult: { eye: [79.7, 39.7, 3.4], mouth: [88.5, 44] } };
let head = null; // 지금 보이는 그림의 머리 위치 (그림이 없거나 잘 때는 null)

function placeHead(st, face) {
  head = face === "sleep" || !HEAD[st.key] ? null : (face === "sad" && HEAD_SAD[st.key]) || HEAD[st.key];
  if (!head) return;
  const lid = (n, e) => {
    const el = $("lid" + n), line = $("lidLine" + n);
    if (!e) { el.setAttribute("rx", 0); line.setAttribute("d", "M0 0"); return; }
    const [x, y, r] = e;
    el.setAttribute("cx", x); el.setAttribute("cy", y);
    el.setAttribute("rx", (r * 1.25).toFixed(2)); el.setAttribute("ry", (r * 1.15).toFixed(2));
    line.setAttribute("d", `M${x - r * 1.05} ${y + r * 0.15}Q${x} ${y + r * 0.85} ${x + r * 1.05} ${y + r * 0.15}`);
  };
  lid(1, head.eye);
  lid(2, head.eye2);
}

let shownKey = "";
function renderPet(st, faces, svgFace) {
  const key = st.key + "_" + faces.join("+") + "_" + state.morph;
  if (key === shownKey) return; // 바뀐 게 없으면 다시 불러오지 않는다
  shownKey = key;
  const img = $("petImg"), svg = $("lizard"), fx = $("petFx");
  svg.innerHTML = lizardSvg(st, svgFace);
  placeHead(st, faces[faces.length - 1]);
  // 모프 그림을 먼저 찾고, 없으면(동작 그림 등) 노멀 그림을 쓴다
  const names = faces.map((f) => st.key + "_" + f).concat(st.key);
  const dirs = [...new Set([st.key === "egg" ? IMG_DIR : morphDir(state.morph), IMG_DIR])];
  const tries = dirs.flatMap((d) => names.map((n) => d + n + ".png"));
  (function next(i) {
    if (i >= tries.length) { img.style.display = "none"; svg.style.display = ""; fx.style.display = "none"; head = null; return; }
    const probe = new Image();
    probe.onload = () => {
      if (shownKey !== key) return;
      img.src = probe.src;
      img.style.display = "";
      svg.style.display = "none";
      fx.style.display = head ? "" : "none";
      if (head) tintLids(probe);
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
  $("stageLabel").textContent = st.name + (st.key !== "egg" && state.morph ? ` · ${morphOf(state.morph).name}` : "")
    + (state.gen > 1 ? ` · ${state.gen}대` : "");
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
  // 쓰다듬는 동안은 행복한 얼굴 그림 위에 눈꺼풀을 덮는다
  renderPet(st, petting ? ["happy"] : action ? [action, m.face] : [m.face], petting || action ? "happy" : m.face);
  $("pet").classList.toggle("pale", shedding() && st.key !== "egg");
  $("room").dataset.action = action || "";
  $("app").classList.toggle("busy", busy);
  $("lizard").classList.toggle("sleeping", state.sleeping);
  $("petImg").classList.toggle("sleeping", state.sleeping);
  $("room").classList.toggle("night", state.sleeping);
  renderTemp();
  // 방금 한 말(say)은 2초 동안 그대로 둔다 (5초마다 하는 화면 갱신이 덮어쓰지 않게)
  if (!busy && Date.now() >= sayUntil) $("bubble").textContent = st.key === "egg" ? "곧 태어날 거예요..." : m.text;
  $("dark").hidden = !state.sleeping;
  renderBars();
  $("sleepBtn").textContent = state.sleeping ? "☀️ 깨우기" : "🌙 재우기";
  // 버튼 옆 작은 글씨: 오늘 받은 영양제 · 누에 간식 · 복습할 문제 (0이면 안 보인다)
  $("mathLeft").textContent = [mathToday() && `오늘 🦴 ${mathToday()}`, state.treats && `🪱 ${state.treats}`,
    dueReviews().length && `📒 복습 ${dueReviews().length}`].filter(Boolean).join(" · ");
  if (document.activeElement !== $("nameInput")) $("nameInput").value = state.name;
  renderLight();
  fogKick();
  checkDecor();
  $("decorNew").hidden = !state.decorGot.some((id) => !state.decorSeen.includes(id));
  renderUpgrades();
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
  // 분무기 "칙칙"
  mist: (c) => { hiss(c, 0); hiss(c, 0.36); },
  // 유리를 두드리는 둔탁한 "톡" + 아주 작은 유리 울림
  knock: (c) => { tone(c, 0, 170, 0.11, { to: 70, vol: 0.35 }); tone(c, 0, 2600, 0.12, { vol: 0.012 }); },
  // 김 서린 유리를 문지르는 "뽀득"
  squeak: (c) => tone(c, 0, 1100 + Math.random() * 500, 0.06, { type: "triangle", vol: 0.035, to: 1600 }),
  // 쓰다듬을 때 기분 좋은 낮은 소리
  content: (c) => notes(c, [392, 330], 0.22, { vol: 0.06 }),
  // 허물 벗는 바스락 소리
  rustle: (c) => { for (let i = 0; i < 6; i++) crunch(c, i * 0.16, 0.05, 0.07); },
  // 코인 "띠링"
  coin: (c) => { tone(c, 0, 988, 0.08, { type: "square", vol: 0.06 }); tone(c, 0.08, 1319, 0.3, { type: "square", vol: 0.06 }); },
  // 상점에서 샀을 때
  buy: (c) => { notes(c, [784, 988, 1175, 1568], 0.07, { type: "square", vol: 0.05 }); },
};

// 칙 소리: 높은 음역만 남긴 짧은 잡음
function hiss(c, at, dur = 0.3, vol = 0.12) {
  const t = c.currentTime + at;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.5);
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf;
  f.type = "highpass";
  f.frequency.value = 2500;
  g.gain.value = vol;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

// 게코가 내는 소리. 자는 동안에는 나지 않는다 (사람이 하는 분무·물 갈기·유리 두드리기 소리는 그대로)
const GECKO_SOUNDS = new Set(["chirp", "content", "eat", "poop", "grow", "rustle", "catch"]);
function sfx(name) {
  if (muted) return;
  if (state.sleeping && GECKO_SOUNDS.has(name)) return;
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
  if (petting) { wanderTimer = setTimeout(wander, 1500); return; } // 쓰다듬는 동안은 가만히
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
  // 수학 미션 보상. 누에는 영양이 풍부해서 실제로도 좋은 간식이다.
  silk: { icon: "🪱", hunger: 25, happy: 20, msg: "수학 상으로 받은 누에! 영양 만점이에요!" },
};

function giveFood(kind) {
  $("foodPicker").style.display = "none";
  const f = FOODS[kind];
  if (!f || (kind === "silk" && state.treats < 1)) { busy = false; return render(); }
  if (kind === "silk") state.treats--;
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
    addDigest(1);
    busy = false;
    setAction("eat", 1500);
    sfx("eat");
    say(f.msg);
  }, 900);
}

// 먹은 게 있으면 잠시 뒤 응가가 나오게 예약한다
function addDigest(ate) {
  if (!ate || state.digest.length >= MAX_DIGEST) return;
  state.digest.push(state.ageMin + DIGEST_MIN + Math.random() * DIGEST_RAND);
  state.digest.sort((a, b) => a - b);
}

// 놀이 코인 받기. 받은 개수를 돌려준다
function earnCoins(n) {
  if (!(n > 0)) return 0;
  state.coins += n;
  setTimeout(() => sfx("coin"), 250);
  const c = spawn("rise-fx coin-fx", `+${n} 🪙`, 50, 35);
  setTimeout(() => c.remove(), 1800);
  renderUpgrades();
  return n;
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
    setTimeout(() => { if (!bug.dataset.done) bug.remove(); }, 1000); // 빨리 숨어 버린다 (원래 1.3초)
  }, 650);
  setTimeout(() => {
    clearInterval(spawner);
    $("room").querySelectorAll(".bug").forEach((b) => b.remove());
    tick();
    state.happy = clamp(state.happy + 10 + caught * 3);
    state.hunger = clamp(state.hunger + caught * 2);
    state.energy = clamp(state.energy - 10);
    addDigest(caught);
    const got = earnCoins(caught * COIN.bug);
    busy = false;
    sfx(caught ? "yay" : "tap");
    say(caught ? `${caught}마리나 잡았어요! 🪙 +${got}` : "다음엔 꼭 잡아보자!");
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
const POOP_SLOTS = [[64, 91], [70, 93], [67, 85], [59, 94], [61, 86]];
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
  bump("poop");
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
  bump("water");
  state.humidity = clamp(state.humidity + WATER_HUMID_UP);
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
    $("silkBtn").style.display = state.treats > 0 ? "" : "none";
    $("silkCount").textContent = "×" + state.treats;
    $("foodPicker").style.display = "";
    stopWalk();
  },
  play() {
    if (state.sleeping) return nope("쿨쿨 자는 중이에요");
    if (state.energy < 15) return nope("너무 졸려서 못 놀아요");
    sfx("tap");
    busy = true;
    render();
    $("bubble").textContent = "무엇을 하고 놀까요?";
    $("playPicker").style.display = "";
    stopWalk();
  },
  sleep() {
    state.sleeping = !state.sleeping;
    sfx(state.sleeping ? "sleep" : "wake");
    say(!state.sleeping ? "안녕! 잘 잤어요" : state.lampOn ? "잘 자요~ 램프를 끄면 더 잘 자요" : "잘 자요~");
    wander();
  },
  // 청소와 물 갈기, 분무는 게코가 자는 동안에도 할 수 있다
  clean() { startCleaning(); },
  water() { changeWater(); },
  mist() {
    sfx("mist");
    state.humidity = clamp(state.humidity + MIST_UP);
    for (let i = 0; i < 7; i++) {
      const s = spawn("spray-fx", "💧", 15 + Math.random() * 70, 18 + Math.random() * 20);
      s.style.setProperty("--dx", (Math.random() * 30 - 15).toFixed(0) + "px");
      s.style.animationDelay = (i * 60) + "ms";
      setTimeout(() => s.remove(), 1400);
    }
    say(state.humidity > TOO_HUMID ? "너무 축축해요! 조금만 뿌려요"
      : state.shedPhase === "pre" ? "촉촉! 허물이 잘 벗겨지겠어요"
      : "칙칙! 사육장이 촉촉해졌어요");
    render();
  },
};

let sayTimer, sayUntil = 0;
function say(text) {
  $("bubble").textContent = text;
  clearTimeout(sayTimer);
  sayUntil = Date.now() + 2000;
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
  $("humid").textContent = Math.round(state.humidity) + "%";
  $("s-humid").value = state.humidity;
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
// 선풍기: 누를 때마다 바로 FAN_DOWN도 내려간다 (램프를 끄는 것보다 빠르게 식힌다).
// 너무 많이 누르면 추워질 수 있다. 램프가 켜져 있으면 다시 천천히 따뜻해진다.
const FAN_DOWN = 2, FAN_MIN = 18;
function useFan() {
  tick();
  if (state.temp <= FAN_MIN) { nope("이미 너무 시원해요!"); return; }
  state.temp = Math.max(FAN_MIN, state.temp - FAN_DOWN);
  sfx("tap");
  save();
  render();
  const z = tempZone();
  say(z === "cold" ? `${Math.round(state.temp)}°C! 앗, 너무 추워요 🥶`
    : z === "hot" ? `${Math.round(state.temp)}°C! 아직 더워요. 램프도 꺼 주세요`
    : `${Math.round(state.temp)}°C! 시원해요 🌬️`);
}
$("lampBtn").addEventListener("click", toggleLamp);
$("fanBtn").addEventListener("click", useFan);
$("dish").addEventListener("click", changeWater);
$("lamp").addEventListener("click", toggleLamp);

document.querySelectorAll("[data-act]").forEach((b) =>
  b.addEventListener("click", () => {
    if (busy) return;
    tick();
    if (stage().key === "egg") return nope("아직 알이에요! 조금만 기다려줘요");
    ACTIONS[b.dataset.act]();
  }));

// 게코를 톡 건드리면 "끽끽" 하고 반응한다. 머리를 길게 누르면 쓰다듬기 (아래 쓰다듬기 부분)
const PET_TALK = ["끽끽!", "간지러워요!", "안녕! 반가워요", "또 만져줘요!"];
let lastPetTap = 0;
function tapPet() {
  const now = Date.now();
  if (busy || now - lastPetTap < 800) return;
  lastPetTap = now;
  if (stage().key === "egg") { sfx("tap"); return say("알이 따뜻해요..."); }
  if (state.sleeping) return say("쿨쿨... (깨우지 말아요)");
  sfx("chirp");
  state.happy = clamp(state.happy + 2);
  say(PET_TALK[Math.floor(Math.random() * PET_TALK.length)]);
  if (Math.random() < 0.5) setTimeout(flickTongue, 250);
}

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
// 영양제는 횟수 제한 없이 통과할 때마다 준다. (mathClears: 오늘 받은 횟수, 보여 주기용)
const MATH_COUNT = 5, MATH_PASS = 4;
const MATH_GROW_MIN = 60, MATH_HAPPY = 15;
// 자동 난이도: 유형마다 레벨 1~3. 처음엔 2(원래 난이도). 연속 LEVEL_UP_STREAK개 맞히면 올라가고,
// 레벨이 바뀐 뒤 3문제 이상 풀었는데 최근 3문제 중 2개를 틀리면 내려간다.
const LEVEL_START = 2, LEVEL_MAX = 3, LEVEL_UP_STREAK = 4;
// 오답 노트: 틀린 문제는 다음 미션에 그대로 다시 나오고(1차 복습), 맞히면 REVIEW_GAP_MS 뒤
// 숫자만 바뀐 비슷한 문제가 나온다(2차 복습). 그것도 맞히면 졸업. 미션마다 최대 REVIEW_PER_QUIZ개.
const REVIEW_PER_QUIZ = 2, REVIEW_KEEP = 30, REVIEW_GAP_MS = 20 * 3600000;
// 보상: 레벨 업 / 오답 졸업 / 만점마다 누에 간식 1개 (밥주기에서 준다)
const MAX_TREATS = 9;
const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const today = () => new Date().toDateString();
const mathToday = () => (state.mathDay === today() ? state.mathClears : 0);
let quiz = null, mathSay = "";

// 학년별 문제 유형 (초등 교육과정 기준). fam이 같은 유형끼리는 묶어서 비율을 맞춘다
// (2학년 구구단이 8개 유형이어도 덧셈·뺄셈·곱셈이 비슷하게 나오게).
// v0.11.0: 아이 요청으로 2학년은 한 자리 곱셈(구구단)만 나온다
const MATH_TYPES = {
  2: [2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ id: "m" + n, fam: "×", name: `구구단 ${n}단` })),
  3: [
    { id: "add3", fam: "+", name: "세 자리 덧셈" },
    { id: "sub3", fam: "-", name: "세 자리 뺄셈" },
    { id: "mul", fam: "×", name: "곱셈" },
    { id: "div", fam: "÷", name: "나눗셈" },
  ],
};
const ALL_TYPES = Object.values(MATH_TYPES).flat();
const typeName = (id) => (ALL_TYPES.find((t) => t.id === id) || { name: "" }).name;
const stars = (lvl) => "★".repeat(lvl) + "☆".repeat(LEVEL_MAX - lvl);

// 자릿수 계산 도우미 (일의 자리부터)
const digitsOf = (n) => String(n).split("").reverse().map(Number);
function carries(a, b) {
  const da = digitsOf(a), db = digitsOf(b);
  let c = 0, n = 0;
  for (let i = 0; i < Math.max(da.length, db.length); i++) { c = (da[i] || 0) + (db[i] || 0) + c >= 10 ? 1 : 0; n += c; }
  return n;
}
function borrows(a, b) {
  const da = digitsOf(a), db = digitsOf(b);
  let br = 0, n = 0;
  for (let i = 0; i < da.length; i++) { br = (da[i] || 0) - (db[i] || 0) - br < 0 ? 1 : 0; n += br; }
  return n;
}
// 조건에 맞는 숫자 쌍이 나올 때까지 다시 뽑는다
function pick(gen, ok) {
  for (let i = 0; i < 300; i++) { const r = gen(); if (ok(r[0], r[1])) return r; }
  return gen();
}
const blankSide = () => (Math.random() < 0.5 ? "a" : "b");

// 문제 만들기. blank가 있으면 "38 + □ = 65" 같은 빈칸 문제 (덧셈↔뺄셈, 곱셈↔나눗셈 관계를 익힌다)
function mk(a, op, b, blank) {
  const res = { "+": a + b, "-": a - b, "×": a * b, "÷": a / b }[op];
  const sym = op === "-" ? "−" : op;
  if (blank === "a") return { text: `□ ${sym} ${b} = ${res}`, answer: a };
  if (blank === "b") return { text: `${a} ${sym} □ = ${res}`, answer: b };
  return { text: `${a} ${sym} ${b} = ?`, answer: res };
}

// 유형별 문제 생성기. 레벨 1: 쉬운 문제, 2: 원래 난이도, 3: 빈칸 문제나 더 큰 수
const GEN = {
  add3(l) {
    const [a, b] = l === 1 ? pick(() => [rand(100, 899), rand(100, 899)], (a, b) => carries(a, b) === 1 && a + b < 1000)
      : pick(() => [rand(100, 999), rand(100, 999)], (a, b) => carries(a, b) >= 2);
    return mk(a, "+", b, l === 3 && blankSide());
  },
  sub3(l) {
    const [a, b] = pick(() => { const a = rand(200, 999); return [a, rand(100, a - 1)]; },
      (a, b) => (l === 1 ? borrows(a, b) === 1 : borrows(a, b) >= 2));
    return mk(a, "-", b, l === 3 && blankSide());
  },
  mul(l) {
    if (l === 3) return mk(rand(100, 999), "×", rand(2, 9));           // 세 자리 × 한 자리
    const [a, b] = pick(() => [rand(11, 99), rand(2, 9)],
      (a, b) => (l === 1) === digitsOf(a).every((d) => d * b < 10));   // 1: 올림 없음, 2: 올림 있음
    return mk(a, "×", b);
  },
  div(l) {
    const b = l === 1 ? rand(2, 5) : rand(6, 9), q = rand(1, 9);
    return mk(b * q, "÷", b, l === 3 && blankSide());
  },
};
// 구구단 n단. 1: ×1~5, 2: ×1~9 (순서도 섞어서 바꿔 곱해도 같다는 걸 익힌다), 3: n × □ = 값
for (let n = 2; n <= 9; n++) {
  GEN["m" + n] = (l) => {
    const k = l === 1 ? rand(1, 5) : rand(1, 9);
    if (l === 3) return mk(n, "×", k, "b");
    return Math.random() < 0.5 || l === 1 ? mk(n, "×", k) : mk(k, "×", n);
  };
}

// 유형별 실력: lvl(레벨), streak(연속 정답), since(레벨이 바뀐 뒤 푼 수), hist(최근 10문제 1/0)
function skill(id) {
  return state.mathSkill[id] || (state.mathSkill[id] = { lvl: LEVEL_START, streak: 0, since: 0, hist: [] });
}
const accuracy = (s) => (s.hist.length ? s.hist.reduce((a, b) => a + b, 0) / s.hist.length : 0.5);

// 약한 유형일수록 자주 나온다. 아직 별로 안 풀어 본 유형도 조금 더 자주. 한 미션에 같은 유형은 2개까지.
function pickType(grade, used) {
  const types = MATH_TYPES[grade] || MATH_TYPES[2];
  const famSize = {};
  types.forEach((t) => { famSize[t.fam] = (famSize[t.fam] || 0) + 1; });
  const ws = types.map((t) => {
    if ((used[t.id] || 0) >= 2) return 0;
    const s = skill(t.id);
    return (1 / famSize[t.fam]) * (0.5 + 2 * (1 - accuracy(s)) + (s.hist.length < 3 ? 0.5 : 0));
  });
  let r = Math.random() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < types.length; i++) { r -= ws[i]; if (ws[i] > 0 && r <= 0) return types[i]; }
  return types.find((t, i) => ws[i] > 0) || types[0];
}

// 답 하나를 기록하고 레벨이 바뀌었으면 "up" / "down"
function recordSkill(q, ok) {
  const s = skill(q.type);
  s.hist.push(ok ? 1 : 0);
  if (s.hist.length > 10) s.hist.shift();
  s.since++;
  if (ok) {
    s.streak++;
    if (s.streak >= LEVEL_UP_STREAK && s.lvl < LEVEL_MAX) { s.lvl++; s.streak = 0; s.since = 0; return "up"; }
  } else {
    s.streak = 0;
    const last3 = s.hist.slice(-3);
    if (s.lvl > 1 && s.since >= 3 && last3.filter((x) => !x).length >= 2) { s.lvl--; s.since = 0; return "down"; }
  }
  return null;
}

// 오답 노트에 적기 (같은 문제는 한 번만, 오래된 것부터 지운다)
function addWrong(q) {
  if (state.mathWrong.some((w) => w.text === q.text)) return;
  state.mathWrong.push({ id: Date.now() + "-" + rand(0, 9999), type: q.type, lvl: q.lvl,
    text: q.text, answer: q.answer, fix: 0, due: Date.now() });
  if (state.mathWrong.length > REVIEW_KEEP) state.mathWrong.shift();
}

// 복습 결과 반영. 졸업하면 true
function reviewDone(id, ok) {
  const w = state.mathWrong.find((x) => x.id === id);
  if (!w) return false;
  if (!ok) { w.fix = 0; w.due = Date.now(); return false; }
  w.fix++;
  if (w.fix >= 2) { state.mathWrong = state.mathWrong.filter((x) => x !== w); return true; }
  w.due = Date.now() + REVIEW_GAP_MS;
  return false;
}

// 지금 학년에 나오는 유형의 오답만 복습한다 (예전 2학년 덧셈·뺄셈 오답은 나오지 않는다)
const gradeWrong = () => state.mathWrong.filter((w) => GEN[w.type] && (MATH_TYPES[state.mathGrade] || []).some((t) => t.id === w.type));
const dueReviews = () => gradeWrong().filter((w) => w.due <= Date.now());

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = rand(0, i); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

function makeQuiz() {
  const list = [], used = {};
  const add = (p) => { used[p.type] = (used[p.type] || 0) + 1; list.push(p); };
  // 1차 복습은 틀렸던 문제 그대로, 2차 복습은 같은 유형·레벨의 새 문제
  for (const w of dueReviews().sort((a, b) => a.due - b.due).slice(0, REVIEW_PER_QUIZ)) {
    const p = w.fix === 0 ? { text: w.text, answer: w.answer } : GEN[w.type](w.lvl);
    add(Object.assign(p, { type: w.type, lvl: w.lvl, reviewId: w.id }));
  }
  for (let guard = 0; list.length < MATH_COUNT && guard < 300; guard++) {
    const t = pickType(state.mathGrade, used);
    const lvl = skill(t.id).lvl;
    const p = GEN[t.id](lvl);
    if (list.some((q) => q.text === p.text)) continue;
    add(Object.assign(p, { type: t.id, lvl }));
  }
  return shuffle(list);
}

// 수학 미션 첫 화면: 오답 노트 개수 + 유형별 레벨
function renderSkills() {
  const due = dueReviews().length, total = gradeWrong().length;
  $("mathReview").textContent = !total ? "📒 오답 노트가 비어 있어요"
    : due ? `📒 오답 노트: 복습할 문제 ${due}개가 이번 미션에 나와요`
    : `📒 오답 노트: ${total}개 (내일 다시 확인해요)`;
  const box = $("mathSkills");
  box.innerHTML = "";
  for (const t of MATH_TYPES[state.mathGrade] || []) {
    const s = state.mathSkill[t.id];
    const el = document.createElement("span");
    const weak = s && s.hist.length >= 3 && accuracy(s) < 0.6;
    el.className = weak ? "weak" : "";
    el.textContent = `${t.name.replace("구구단 ", "")} ${stars(s ? s.lvl : LEVEL_START)}`;
    el.title = s && s.hist.length ? `최근 정답률 ${Math.round(accuracy(s) * 100)}%` : "아직 안 풀어 봤어요";
    box.appendChild(el);
  }
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
  const done = mathToday();
  $("mathToday").textContent = "통과할 때마다 🦴 영양제를 받아요" + (done ? ` (오늘 ${done}번 받았어요)` : "");
  renderSkills();
  showMathView("mathIntro");
}

function startQuiz() {
  const list = makeQuiz();
  quiz = { list, i: 0, input: "", results: [], locked: false, ups: [], grads: 0 };
  sfx("start");
  showMathView("mathQuiz");
  renderQuiz();
}

function renderQuiz() {
  const q = quiz.list[quiz.i];
  $("mathDots").innerHTML = quiz.list.map((_, i) =>
    `<span class="${quiz.results[i] === true ? "ok" : quiz.results[i] === false ? "no" : i === quiz.i ? "now" : ""}"></span>`).join("");
  $("mathTag").textContent = (q.reviewId ? "🔁 복습 · " : "") + `${typeName(q.type)} ${stars(q.lvl)}`;
  $("mathTag").classList.toggle("review", !!q.reviewId);
  $("mathQ").textContent = q.text;
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
  // 실력 기록 → 오답 노트 → 레벨 업 순서로 반영한다
  const lv = recordSkill(q, ok);
  const grad = q.reviewId ? reviewDone(q.reviewId, ok) : false;
  if (!ok && !q.reviewId) addWrong(q);
  if (grad) { cur.grads++; bump("grads"); }
  if (lv === "up") cur.ups.push(q.type);
  save();
  sfx(lv === "up" ? "grow" : ok ? "catch" : "nope");
  // 틀리면 정답을 보여 줘서 바로 배우게 한다
  let fb = ok ? "딩동댕! ⭕" : `아쉬워요! 정답은 ${q.answer}`;
  if (grad) fb += "\n🎓 오답 졸업!";
  if (lv === "up") fb += `\n🎉 ${typeName(q.type)} 레벨 업! ${stars(skill(q.type).lvl)}`;
  if (!ok) fb += q.reviewId ? "\n다음에 한 번 더 나와요" : "\n📒 오답 노트에 적었어요";
  $("mathFeedback").textContent = fb;
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
  }, ok ? (grad || lv === "up" ? 1600 : 900) : 2000);
}

function finishQuiz() {
  const score = quiz.results.filter(Boolean).length;
  $("mathScore").textContent = "⭐".repeat(score) + "☆".repeat(MATH_COUNT - score) + `\n${score} / ${MATH_COUNT}`;
  let msg;
  if (score < MATH_PASS) {
    msg = `아깝다! ${MATH_PASS}개 이상 맞히면 영양제를 받아요`;
    sfx("tap");
  } else {
    bump("mathPass");
    msg = giveCalcium();
  }
  // 누에 간식: 레벨 업, 오답 졸업, 만점마다 1개
  const earned = quiz.ups.length + quiz.grads + (score === MATH_COUNT ? 1 : 0);
  const got = Math.min(earned, MAX_TREATS - state.treats);
  if (got > 0) {
    state.treats += got;
    save();
    const why = [quiz.ups.length && `레벨 업 ${quiz.ups.length}`, quiz.grads && `오답 졸업 ${quiz.grads}`,
      score === MATH_COUNT && "만점"].filter(Boolean).join(" · ");
    msg += `\n\n🪱 누에 간식 +${got} (${why})\n밥주기에서 줄 수 있어요`;
    if (!mathSay) mathSay = "누에 간식 받았어요! 밥주기에서 주세요";
  } else if (earned > 0) {
    msg += `\n\n🪱 누에 간식이 가득 찼어요 (${MAX_TREATS}개). 먼저 게코에게 주세요!`;
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
  pickMorph();
  save();
  const grew = stage() !== before;
  sfx(grew ? "grow" : "yay");
  mathSay = grew ? grewText(before, stage()) : "칼슘 먹고 뼈가 튼튼해졌어요!";
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
let albumNews = false; // 방금 알을 낳아서 열린 앨범인지

// "도마" → "도마 2세", "도마 2세" → "도마 3세" (이름 칸 최대 10글자에 맞춘다)
function babyName(name, gen) {
  const suffix = ` ${gen}세`;
  return name.replace(/\s*\d+세$/, "").slice(0, 10 - suffix.length) + suffix;
}

function layEgg() {
  const parent = { name: state.name, gen: state.gen, morph: state.morph || "normal", born: state.born, laid: Date.now() };
  const keep = {
    history: state.history.concat(parent), gen: state.gen + 1, name: babyName(state.name, state.gen + 1),
    mathGrade: state.mathGrade, mathDay: state.mathDay, mathClears: state.mathClears,
    mathSkill: state.mathSkill, mathWrong: state.mathWrong, treats: state.treats, // 아이의 실력은 이어진다
    lampOn: state.lampOn, temp: state.temp, water: state.water, humidity: state.humidity,
    stats: state.stats, decor: state.decor, decorGot: state.decorGot, decorSeen: state.decorSeen, // 꾸민 사육장은 그대로
    coins: state.coins, upgrades: state.upgrades, // 코인과 업그레이드한 사육장도 그대로
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
    img.src = morphDir(h.morph) + "adult_happy.png";
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
    cap.innerHTML = `<b></b><span>${h.gen}대 · ${morphOf(h.morph).name} · 함께한 시간 ${days}일</span><small>${fmtDate(h.born)} ~ ${fmtDate(h.laid)}</small>`;
    cap.querySelector("b").textContent = h.name; // 이름은 아이가 입력한 글자라 textContent로
    card.append(img, cap);
    list.appendChild(card);
  }
}

// ---- 도감: 지금까지 키운 게코(앨범 + 지금 게코)의 모프를 모아 본다 ----
// 모프 key → 그 모프를 처음 만난 게코 이름
function dexFound() {
  const found = new Map();
  const all = state.history.map((h) => ({ name: h.name, morph: morphOf(h.morph).key }));
  if (state.morph) all.push({ name: state.name, morph: state.morph });
  for (const g of all) if (!found.has(g.morph)) found.set(g.morph, g.name);
  return found;
}

function renderDex() {
  const found = dexFound(), list = $("dexList");
  $("dexCount").textContent = `${found.size}/${MORPHS.length}`;
  list.innerHTML = "";
  MORPHS.forEach((m, i) => {
    const known = found.has(m.key);
    const card = document.createElement("figure");
    card.className = "dex-card" + (known ? "" : " unknown");
    const img = document.createElement("img");
    img.src = morphDir(m.key) + "adult_happy.png";
    img.alt = known ? m.name : "아직 못 만난 게코";
    const cap = document.createElement("figcaption");
    cap.innerHTML = `<span class="no">No.${i + 1}</span><b></b><small></small>`;
    cap.querySelector("b").textContent = known ? m.name : "???";
    // 이름은 아이가 입력한 글자라 textContent로
    cap.querySelector("small").textContent = known ? `처음 만난 게코: ${found.get(m.key)}` : "알에서 만날 수 있어요";
    card.append(img, cap);
    list.appendChild(card);
  });
}

function showAlbumTab(dex) {
  $("photoView").hidden = dex;
  $("dexView").hidden = !dex;
  $("tabPhotos").setAttribute("aria-selected", String(!dex));
  $("tabDex").setAttribute("aria-selected", String(dex));
}
$("tabPhotos").addEventListener("click", () => { sfx("tap"); showAlbumTab(false); });
$("tabDex").addEventListener("click", () => { sfx("tap"); showAlbumTab(true); });

function openAlbum(news) {
  if (busy) return;
  busy = true;
  albumNews = news;
  const last = state.history[state.history.length - 1];
  $("albumNews").hidden = !news;
  if (news) $("albumNews").textContent = `🥚 ${last.name}${josa(last.name, "이", "가")} 알을 낳고 앨범에 남았어요!\n새 아기 ${state.name}${josa(state.name, "을", "를")} 잘 키워 주세요`;
  renderAlbum();
  renderDex();
  showAlbumTab(false);
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
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("resetPanel").hidden) closeReset();
  else if (!$("albumPanel").hidden) closeAlbum();
});

$("nameInput").addEventListener("input", (e) => {
  state.name = e.target.value.trim() || "도마";
  save();
});
// ---- 황금 열쇠 (어른용): 아기·어린·어른 단계로 바로 건너뛴다 ----
// 고른 뒤 3자리 × 3자리 곱셈을 맞혀야 열린다 (아이들이 마음대로 못 쓰게)
let keyTarget = null, keyAnswer = 0;
const rand3 = () => 100 + Math.floor(Math.random() * 900);

function openKey() {
  if (busy) return;
  busy = true;
  sfx("tap");
  showKeyPick();
  $("keyPanel").hidden = false;
}
function closeKey() {
  $("keyPanel").hidden = true;
  busy = false;
  render();
}
function showKeyPick() {
  const now = stageNo();
  const box = $("keyStages");
  box.innerHTML = "";
  STAGES.slice(1).forEach((s) => {
    const i = STAGES.indexOf(s);
    const b = document.createElement("button");
    b.disabled = i <= now; // 지금 단계나 이미 지난 단계로는 못 간다
    b.innerHTML = `${s.name}<small>${i === now ? "지금 단계예요" : i < now ? "이미 지났어요" : "여기까지 건너뛰기"}</small>`;
    b.addEventListener("click", () => { sfx("tap"); showKeyLock(s); });
    box.appendChild(b);
  });
  $("keyPick").hidden = false;
  $("keyLock").hidden = true;
}
function newKeyQuestion() {
  const a = rand3(), b = rand3();
  keyAnswer = a * b;
  $("keyQ").textContent = `${a} × ${b} = ?`;
  $("keyAns").value = "";
}
function showKeyLock(s) {
  keyTarget = s;
  $("keyGoal").innerHTML = `<b>${s.name}</b>로 건너뛸까요?`;
  $("keyMsg").textContent = "";
  newKeyQuestion();
  $("keyPick").hidden = true;
  $("keyLock").hidden = false;
  $("keyAns").focus();
}
function tryKey() {
  const v = Number($("keyAns").value.replace(/[^0-9]/g, ""));
  if (v !== keyAnswer) {
    sfx("tap");
    $("keyMsg").textContent = "틀렸어요. 새 문제로 다시 해 보세요";
    newKeyQuestion();
    $("keyAns").focus();
    return;
  }
  tick();
  const before = stage();
  if (state.careMin < keyTarget.care) state.careMin = keyTarget.care;
  pickMorph();
  save();
  closeKey();
  const after = stage();
  if (after !== before) { sfx("grow"); say(grewText(before, after)); }
}
$("keyBtn").addEventListener("click", openKey);
$("keyClose").addEventListener("click", closeKey);
$("keyBack").addEventListener("click", () => { sfx("tap"); showKeyPick(); });
$("keyOk").addEventListener("click", tryKey);
$("keyAns").addEventListener("keydown", (e) => { if (e.key === "Enter") tryKey(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("keyPanel").hidden) closeKey(); });

// 처음부터 다시: 가족 앨범 안에만 버튼이 있고, 확인 창에서 한 번 더 묻는다.
// 실수로 누르지 않게 큰 버튼은 "아니요" 쪽이다.
function closeReset() {
  $("resetPanel").hidden = true;
  $("resetBtn").focus();
}
$("resetBtn").addEventListener("click", () => {
  sfx("tap");
  $("resetPanel").hidden = false;
  $("resetNo").focus();
});
$("resetNo").addEventListener("click", () => { sfx("tap"); closeReset(); });
$("resetPanel").addEventListener("click", (e) => { if (e.target === $("resetPanel")) closeReset(); });
$("resetYes").addEventListener("click", () => {
  state = newState();
  save();
  $("resetPanel").hidden = true;
  albumNews = false;
  closeAlbum();
  say("새 알이 도착했어요! 이름을 지어 주세요.");
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

// ================= 살아있는 사육장 =================

// ---- 실제 시간에 따른 조명: 새벽 / 낮(햇살) / 해질녘 / 밤(나이트 글로 램프) ----
function timeOfDay(d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  return h >= 6 && h < 8 ? "dawn" : h >= 8 && h < 17 ? "day" : h >= 17 && h < 19.5 ? "dusk" : "night";
}
function renderLight() {
  const tod = timeOfDay();
  if (document.body.dataset.tod !== tod) document.body.dataset.tod = tod;
}

// ---- 그림 좌표(0~100) ↔ 화면 좌표. 왼쪽을 보고 있으면 좌우가 뒤집힌다 ----
function petBox() {
  const r = $("petBody").getBoundingClientRect();
  const size = Math.min(r.width, r.height);
  return { left: r.left + (r.width - size) / 2, top: r.bottom - size, size };
}
function toImg(clientX, clientY) {
  const b = petBox();
  const u = (clientX - b.left) / b.size * 100;
  return [facing < 0 ? 100 - u : u, (clientY - b.top) / b.size * 100];
}
function imgToRoom(u, v) {
  const b = petBox(), room = $("room").getBoundingClientRect();
  const x = b.left + (facing < 0 ? 100 - u : u) / 100 * b.size, y = b.top + v / 100 * b.size;
  return [(x - room.left) / room.width * 100, (y - room.top) / room.height * 100];
}

// ---- 혀 날름 / 혀로 눈 핥기 (레오파드 게코는 혀로 눈을 닦는다) ----
let petting = false;
function canFidget() {
  return head && !state.sleeping && !busy && !action && !petting && stage().key !== "egg"
    && !$("pet").classList.contains("walking") && $("petFx").style.display !== "none" && !document.hidden;
}
function animTongue(d, dur, hold) {
  const t = $("tongue");
  t.setAttribute("d", d);
  const L = t.getTotalLength();
  if (!L || !t.animate) return;
  t.style.strokeDasharray = `${L} ${L}`;
  t.style.strokeDashoffset = L;
  t.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0, offset: 0.4 }, { strokeDashoffset: 0, offset: 0.4 + hold },
    { strokeDashoffset: L }], { duration: dur, easing: "ease-in-out" });
}
function flickTongue() {
  if (!head || petting || state.sleeping) return;
  const [mx, my] = head.mouth;
  animTongue(`M${mx} ${my}l5 .6`, 380, 0.05);
}
function lickEye() {
  const [mx, my] = head.mouth, [ex, ey, r] = head.eye;
  animTongue(`M${mx} ${my}Q${mx + 7} ${ey - 2} ${ex + r * 0.5} ${ey - r * 0.3}`, 1100, 0.15);
}
(function fidget() {
  setTimeout(() => { if (canFidget()) (Math.random() < 0.55 ? lickEye : flickTongue)(); fidget(); }, 6000 + Math.random() * 12000);
})();

// 눈꺼풀 색: 그림에서 눈 둘레 피부색을 뽑아 쓴다 (검은 점무늬는 뺀다)
const lidColors = {};
function tintLids(img) {
  const apply = (c) => document.querySelectorAll("#lids .lid").forEach((e) => e.setAttribute("fill", c));
  if (lidColors[img.src]) return apply(lidColors[img.src]);
  apply("#efcf6a");
  try {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 100;
    const cx = cv.getContext("2d");
    cx.drawImage(img, 0, 0, 100, 100);
    const [ex, ey, r] = head.eye;
    let n = 0, R = 0, G = 0, B = 0;
    for (let a = 0; a < 16; a++) {
      const ang = a / 16 * Math.PI * 2;
      const p = cx.getImageData(Math.round(ex + Math.cos(ang) * r * 1.8), Math.round(ey + Math.sin(ang) * r * 1.8), 1, 1).data;
      if (p[3] > 200 && p[0] + p[1] + p[2] > 360) { R += p[0]; G += p[1]; B += p[2]; n++; }
    }
    if (n) { lidColors[img.src] = `rgb(${(R / n) | 0},${(G / n) | 0},${(B / n) | 0})`; apply(lidColors[img.src]); }
  } catch (e) { /* 그림을 읽을 수 없으면 기본색 */ }
}

// ---- 쓰다듬기: 머리를 길게 누르면 눈을 지그시 감고 턱을 바닥에 댄다 ----
const PET_HOLD_MS = 450;
let press = null, pressTimer, petTick, petGain = 0;
function isHead(e) {
  if (!head || state.sleeping || stage().key === "egg") return false;
  const [u, v] = toImg(e.clientX, e.clientY);
  return u > head.eye[0] - 15 && v > head.eye[1] - 18 && v < head.eye[1] + 16;
}
function startPetting() {
  if (busy || action || state.sleeping || stage().key === "egg" || !head) return;
  petting = true;
  stopWalk();
  $("pet").classList.add("petting");
  shownKey = "";
  render();
  sfx("content");
  say("스르르... 기분 좋아요 😌");
  petTick = setInterval(() => {
    if (!head) return;
    const [x, y] = imgToRoom(head.eye[0], head.eye[1] - 14);
    const h = spawn("rise-fx", "💗", x + Math.random() * 8 - 4, y);
    setTimeout(() => h.remove(), 1800);
    if (petGain < 10) { state.happy = clamp(state.happy + 1); petGain++; renderBars(); }
  }, 700);
}
function endPetting() {
  petting = false;
  clearInterval(petTick);
  petGain = 0;
  $("pet").classList.remove("petting");
  save();
  shownKey = "";
  render();
  clearTimeout(wanderTimer);
  wanderTimer = setTimeout(wander, 1500);
}
const petEl = $("pet");
petEl.addEventListener("contextmenu", (e) => e.preventDefault()); // 길게 누를 때 메뉴가 뜨지 않게
petEl.addEventListener("pointerdown", (e) => {
  press = { x: e.clientX, y: e.clientY, t: Date.now(), head: isHead(e) };
  try { petEl.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => { if (press && press.head) startPetting(); }, PET_HOLD_MS);
});
petEl.addEventListener("pointermove", (e) => {
  if (press && !petting && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 12) press.head = false;
});
function endPress(cancelled) {
  if (!press) return;
  clearTimeout(pressTimer);
  const p = press;
  press = null;
  if (petting) return endPetting();
  if (!cancelled && Date.now() - p.t < PET_HOLD_MS) tapPet();
}
petEl.addEventListener("pointerup", () => endPress(false));
petEl.addEventListener("pointercancel", () => endPress(true));

// ---- 유리 두드리기: 둔탁한 소리 + 파문, 게코가 그쪽을 쳐다본다 ----
let knocks = [], lookTimer;
function glassKnock(clientX, clientY) {
  const room = $("room").getBoundingClientRect();
  const x = (clientX - room.left) / room.width * 100, y = (clientY - room.top) / room.height * 100;
  sfx("knock");
  const fx = spawn("knock-fx", "", x, y);
  setTimeout(() => fx.remove(), 600);
  const now = Date.now();
  knocks = knocks.filter((t) => now - t < 5000);
  knocks.push(now);
  if (stage().key === "egg") return;
  if (state.sleeping) return say("쿨쿨... (유리 소리에 뒤척여요)");
  if (busy || action || petting) return;
  // 진짜 파충류도 유리를 자꾸 두드리면 스트레스를 받는다
  if (knocks.length >= 4) {
    knocks = [];
    state.happy = clamp(state.happy - 3);
    say("유리를 자꾸 두드리면 깜짝 놀라요! 😣");
    const sec = walkTo(HIDE_X, 14);
    clearTimeout(wanderTimer);
    wanderTimer = setTimeout(wander, sec * 1000 + 3000);
    return;
  }
  stopWalk();
  facing = x > petX + 27.5 ? 1 : -1; // #pet 너비 55%의 가운데 기준
  $("pet").style.setProperty("--face", facing);
  $("pet").classList.add("look");
  clearTimeout(lookTimer);
  lookTimer = setTimeout(() => $("pet").classList.remove("look"), 1400);
  if (Math.random() < 0.6) setTimeout(flickTongue, 350);
  clearTimeout(wanderTimer);
  wanderTimer = setTimeout(wander, 2500);
}

// ---- 결로: 습도가 높으면 유리 가장자리부터 김이 서리고 물방울이 맺힌다. 문지르면 닦인다 ----
// 유리를 FOG_W×FOG_H 칸으로 나눠 칸마다 김의 짙기(0~1)를 기억한다
const FOG_W = 40, FOG_H = 30;
const FOG_FILL_SEC = [600, 300]; // [조금 습할 때, 아주 습할 때] 다 서리는 데 걸리는 초
const FOG_CLEAR_SEC = 180;       // 마른 뒤 걷히는 데 걸리는 초 (대략)
const fogCells = new Float32Array(FOG_W * FOG_H), fogEdge = new Float32Array(FOG_W * FOG_H);
for (let y = 0; y < FOG_H; y++) for (let x = 0; x < FOG_W; x++) {
  const e = Math.min(x / (FOG_W - 1), 1 - x / (FOG_W - 1), y / (FOG_H - 1), 1 - y / (FOG_H - 1)); // 0 = 가장자리
  const t = Math.min(1, e / 0.32);
  fogEdge[y * FOG_W + x] = 0.25 + 0.75 * (1 - t * t * (3 - 2 * t)); // 가장자리일수록 짙게
}
const fogCanvas = $("fog"), fctx = fogCanvas.getContext("2d");
const fogSmall = document.createElement("canvas");
fogSmall.width = FOG_W;
fogSmall.height = FOG_H;
const sctx = fogSmall.getContext("2d"), fogImg = sctx.createImageData(FOG_W, FOG_H);
let fogDrops = [], fogRAF = 0, fogLast = 0, wipedSum = 0, wipeCheered = false, lastSqueak = 0;
const fogLevel = () => Math.max(0, Math.min(1, (state.humidity - 55) / 35)); // 습도 55%부터 서리기 시작
const cellAt = (x, y) => {
  const cx = Math.floor(x * FOG_W), cy = Math.floor(y * FOG_H);
  return cx < 0 || cy < 0 || cx >= FOG_W || cy >= FOG_H ? -1 : cy * FOG_W + cx;
};

function fogKick() {
  if (!fogRAF && !document.hidden) { fogLast = performance.now(); fogRAF = requestAnimationFrame(fogFrame); }
}
function fogFrame(now) {
  fogRAF = 0;
  const dt = Math.min(0.1, (now - fogLast) / 1000);
  fogLast = now;
  const lvl = fogLevel();
  // 김이 다 서리는 데 걸리는 시간: 습도가 서리기 시작할 때 10분, 아주 습하면 5분 (닦은 뒤 다시 서릴 때도 같다)
  const fill = FOG_FILL_SEC[0] - (FOG_FILL_SEC[0] - FOG_FILL_SEC[1]) * lvl;
  let sum = 0;
  for (let i = 0; i < fogCells.length; i++) {
    const t = lvl * fogEdge[i], c = fogCells[i];
    fogCells[i] = c < t ? Math.min(t, c + dt * t / fill) // 모든 칸이 같은 때에 다 서린다
      : Math.max(t, c - dt / FOG_CLEAR_SEC); // 건조해지면 천천히 걷힌다
    sum += fogCells[i];
  }
  // 물방울: 김이 짙은 곳에 맺히고, 커지면 주르륵 흘러내리며 길을 낸다
  if (lvl > 0.15 && fogDrops.length < 45 && Math.random() < dt * lvl * 3) {
    const i = Math.floor(Math.random() * fogCells.length);
    if (fogCells[i] > 0.45) {
      fogDrops.push({ x: (i % FOG_W + Math.random()) / FOG_W, y: (Math.floor(i / FOG_W) + Math.random()) / FOG_H,
        r: 1.5 + Math.random() * 2.5, vy: 0 });
    }
  }
  for (const d of fogDrops) {
    if (d.vy === 0 && lvl > 0.3) d.r += dt * 0.15 * lvl;
    if (d.r >= 5) {
      d.vy = Math.min(0.12, d.vy + dt * 0.05);
      d.y += d.vy * dt;
      d.r -= dt * 0.25;
      const ci = cellAt(d.x, d.y);
      if (ci >= 0) fogCells[ci] *= 0.6;
    }
  }
  fogDrops = fogDrops.filter((d) => d.y < 1 && d.r > 1.2 && (d.vy > 0 || fogCells[cellAt(d.x, d.y)] > 0.12));
  drawFog();
  $("room").classList.toggle("foggy", sum > 20);
  if (sum > 0.5 || lvl > 0 || fogDrops.length) fogRAF = requestAnimationFrame(fogFrame);
  else { fctx.clearRect(0, 0, fogCanvas.width, fogCanvas.height); wipeCheered = false; wipedSum = 0; }
}
function drawFog() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(fogCanvas.clientWidth * dpr), h = Math.round(fogCanvas.clientHeight * dpr);
  if (!w || !h) return;
  if (fogCanvas.width !== w || fogCanvas.height !== h) { fogCanvas.width = w; fogCanvas.height = h; }
  const px = fogImg.data;
  for (let i = 0; i < fogCells.length; i++) {
    px[i * 4] = 232; px[i * 4 + 1] = 238; px[i * 4 + 2] = 240;
    px[i * 4 + 3] = Math.min(255, fogCells[i] * 215);
  }
  sctx.putImageData(fogImg, 0, 0);
  fctx.clearRect(0, 0, w, h);
  fctx.imageSmoothingEnabled = true;
  fctx.imageSmoothingQuality = "high";
  fctx.drawImage(fogSmall, 0, 0, w, h);
  const big = Math.max(1, fogCanvas.clientWidth / 380); // 사육장이 크면 물방울도 크게
  for (const d of fogDrops) {
    const x = d.x * w, y = d.y * h, r = d.r * dpr * big;
    const g = fctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,.9)");
    g.addColorStop(0.35, "rgba(220,235,245,.25)");
    g.addColorStop(1, "rgba(110,140,160,.5)");
    fctx.fillStyle = g;
    fctx.beginPath();
    fctx.ellipse(x, y, r * 0.9, r, 0, 0, Math.PI * 2);
    fctx.fill();
  }
}
function wipeFog(x0, y0, x1, y1) {
  const r = fogCanvas.getBoundingClientRect();
  if (!r.width) return;
  const R = 26 * Math.max(1, r.width / 380); // 문지르는 손가락 굵기(px), 사육장이 크면 넓게
  const cw = r.width / FOG_W, ch = r.height / FOG_H;
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6));
  let wiped = 0;
  for (let s = 0; s <= steps; s++) {
    const px = x0 + (x1 - x0) * s / steps - r.left, py = y0 + (y1 - y0) * s / steps - r.top;
    for (let cy = Math.max(0, Math.floor((py - R) / ch)); cy < Math.min(FOG_H, Math.ceil((py + R) / ch)); cy++) {
      for (let cx = Math.max(0, Math.floor((px - R) / cw)); cx < Math.min(FOG_W, Math.ceil((px + R) / cw)); cx++) {
        const d = Math.hypot((cx + 0.5) * cw - px, (cy + 0.5) * ch - py) / R;
        if (d < 1) { const i = cy * FOG_W + cx, before = fogCells[i]; fogCells[i] *= d * d; wiped += before - fogCells[i]; }
      }
    }
    fogDrops = fogDrops.filter((d) => Math.hypot(d.x * r.width - px, d.y * r.height - py) > R);
  }
  if (wiped > 0.05) {
    wipedSum += wiped;
    const now = Date.now();
    if (now - lastSqueak > 140) { lastSqueak = now; sfx("squeak"); }
    if (!wipeCheered && wipedSum > 60) { wipeCheered = true; say("뽀득뽀득! 유리가 깨끗해졌어요 ✨"); }
  }
  fogKick();
}

// 유리 위에서: 톡 누르면 두드리기, 문지르면 김 닦기
const roomEl = $("room");
let gesture = null;
roomEl.addEventListener("pointerdown", (e) => {
  if (hunt || hideGame || decorating) return; // 놀이·꾸미기 중에는 유리 두드리기·닦기를 하지 않는다
  if (e.target.closest("#pet, #dish, #lamp, .poop, .bug, #foodPicker, #playPicker, button")) return;
  gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: Date.now(), moved: false };
  if (roomEl.classList.contains("foggy")) { try { roomEl.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ } }
});
roomEl.addEventListener("pointermove", (e) => {
  if (!gesture || e.pointerId !== gesture.id) return;
  if (!gesture.moved && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 8) gesture.moved = true;
  if (gesture.moved) wipeFog(gesture.lx, gesture.ly, e.clientX, e.clientY);
  gesture.lx = e.clientX;
  gesture.ly = e.clientY;
});
roomEl.addEventListener("pointerup", (e) => {
  if (!gesture || e.pointerId !== gesture.id) return;
  const g = gesture;
  gesture = null;
  if (!g.moved && Date.now() - g.t < 450) glassKnock(e.clientX, e.clientY);
});
roomEl.addEventListener("pointercancel", () => { gesture = null; });

// ================= 놀아주기 =================
function choosePlay(kind) {
  $("playPicker").style.display = "none";
  if (!kind) { busy = false; render(); return; }
  sfx("tap");
  if (kind === "bugs") startBugGame();
  else if (kind === "hunt") startHunt();
  else if (kind === "hide") startHide();
}
document.querySelectorAll("[data-play]").forEach((b) => b.addEventListener("click", () => choosePlay(b.dataset.play)));

// 게코 입 위치 (방 기준 %)
function mouthRoom() {
  if (head) return imgToRoom(head.mouth[0], head.mouth[1]);
  return [petX + 27.5 + facing * 22, 75];
}

// ---- 사냥 놀이: 집게로 밀웜을 천천히 움직이면 게코가 살금살금 다가가 꼬리를 떨다가 덥석! ----
// 실제 레오파드 게코는 먹이를 발견하면 몸을 낮추고 꼬리 끝을 부르르 떨다가 덮친다.
const HUNT_MS = 20000, HUNT_GOAL = 3; // 원래 25초
const HUNT_FAST = 60;  // 밀웜이 이보다 빠르면(방 너비 %/초) 깜짝 놀라 멈춘다
const HUNT_FLOOR = 55;  // 이보다 아래(방 높이 %)로 내려와야 닿는다
const HUNT_REACH = 8;   // 입과 밀웜 사이가 이 안이면 덮칠 수 있다
let hunt = null;

function startHunt() {
  if (state.hunger > 92) { busy = false; render(); return nope("배가 불러서 사냥할 기분이 아니에요"); }
  busy = true;
  stopWalk();
  const lure = spawn("lure", "", 50, 30);
  // 먹이 집게(핀셋): 위에서 내려온 금속 집게 끝에 밀웜이 물려 있다
  lure.innerHTML = `<svg class="lure-tongs" viewBox="0 0 40 200" aria-hidden="true">
      <path d="M10 0L18 196M30 0L22 196" stroke="#8d969e" stroke-width="5" stroke-linecap="round" fill="none"/>
      <path d="M11 0L18.5 190M29 0L21.5 190" stroke="#e3e8ec" stroke-width="1.6" stroke-linecap="round" fill="none"/>
    </svg><span class="worm">🐛</span>`;
  const t = performance.now();
  hunt = { lure, x: 50, y: 30, lastX: 50, lastY: 30, v: 0, dragging: false, caught: 0, stalk: 0, cool: 0,
    striking: false, end: t + HUNT_MS, last: t, frozen: 0, mode: "" };
  $("room").classList.add("hunting");
  $("bubble").textContent = "밀웜을 바닥 가까이, 천천히 움직여 봐요!";
  sfx("start");
  requestAnimationFrame(huntFrame);
}

function moveLure(e, jump) {
  const r = $("room").getBoundingClientRect();
  hunt.x = Math.max(4, Math.min(96, (e.clientX - r.left) / r.width * 100));
  hunt.y = Math.max(14, Math.min(92, (e.clientY - r.top) / r.height * 100));
  if (jump) { hunt.lastX = hunt.x; hunt.lastY = hunt.y; } // 처음 짚은 곳으로 순간이동한 건 속도로 치지 않는다
}
roomEl.addEventListener("pointerdown", (e) => {
  if (!hunt) return;
  hunt.dragging = true;
  moveLure(e, true);
  try { roomEl.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
});
roomEl.addEventListener("pointermove", (e) => { if (hunt && (hunt.dragging || e.pointerType === "mouse")) moveLure(e, false); });
roomEl.addEventListener("pointerup", () => { if (hunt) hunt.dragging = false; });

function huntFrame(now) {
  const h = hunt;
  if (!h) return;
  const dt = Math.min(0.1, Math.max(0.001, (now - h.last) / 1000));
  h.last = now;
  const sp = Math.hypot(h.x - h.lastX, h.y - h.lastY) / dt;
  h.v = h.v * 0.8 + sp * 0.2;
  h.lastX = h.x;
  h.lastY = h.y;
  h.lure.style.left = h.x + "%";
  h.lure.style.top = h.y + "%";
  if (h.cool > 0) h.cool -= dt;
  const pet = $("pet");
  // 상황이 바뀔 때만 말풍선을 바꾼다
  const mode = (m, text) => { if (h.mode !== m) { h.mode = m; $("bubble").textContent = text; } };
  if (h.v > HUNT_FAST) h.frozen = now + 1200; // 휙휙 움직이면 깜짝 놀라 잠깐 얼어붙는다
  if (!h.striking && h.cool <= 0 && !h.lure.classList.contains("empty")) {
    // 방향은 몸 가운데 기준으로 정한다 (입 기준이면 돌아설 때마다 좌우가 바뀌어 덜덜 떤다)
    const dir = h.x > petX + 27.5 ? 1 : -1;
    if (dir !== facing && now >= h.frozen) { facing = dir; pet.style.setProperty("--face", facing); }
    const dx = h.x - mouthRoom()[0];
    if (now < h.frozen) {
      h.stalk = 0;
      pet.classList.remove("crouch", "walking");
      mode("fast", "깜짝! 너무 빨라요. 천천히~");
    } else if (Math.abs(dx) > HUNT_REACH - 1) {
      h.stalk = 0;
      pet.classList.remove("crouch", "look");
      mode("near", "살금살금 다가가는 중...");
      const before = petX;
      petX = Math.max(PET_MIN_X, Math.min(PET_MAX_X, petX + Math.sign(dx) * Math.min(Math.abs(dx), 9 * dt))); // 살금살금
      pet.style.transition = "none";
      pet.style.left = petX + "%";
      pet.classList.toggle("walking", petX !== before);
    } else if (h.y < HUNT_FLOOR) {
      h.stalk = 0;
      pet.classList.remove("crouch", "walking");
      pet.classList.add("look"); // 고개를 들고 올려다본다
      mode("high", "너무 높아요! 바닥 가까이 내려 주세요");
    } else {
      pet.classList.remove("walking", "look");
      h.stalk += dt;
      if (h.stalk > 0.3) { pet.classList.add("crouch"); mode("stalk", "몸을 낮추고 꼬리를 부르르… 쉿!"); }
      if (h.stalk > 1.5) huntStrike();
    }
  } else if (!h.striking) {
    pet.classList.remove("crouch", "walking");
  }
  if ((now > h.end || h.caught >= HUNT_GOAL) && !h.striking) return endHunt();
  requestAnimationFrame(huntFrame);
}

function huntStrike() {
  const h = hunt, pet = $("pet");
  h.striking = true;
  h.stalk = 0;
  h.mode = ""; // 덮친 결과를 말한 뒤 다음 상황에서 다시 말풍선을 바꾼다
  pet.classList.remove("crouch");
  pet.classList.add("strike");
  flickTongue();
  setTimeout(() => {
    if (hunt !== h) return;
    const hit = Math.abs(h.x - mouthRoom()[0]) < HUNT_REACH + 1 && h.y >= HUNT_FLOOR && h.v < HUNT_FAST;
    if (hit) {
      h.caught++;
      sfx("catch");
      setTimeout(() => sfx("eat"), 150);
      h.lure.classList.add("empty");
      $("bubble").textContent = `덥석! ${h.caught}마리 냠냠`;
      setTimeout(() => { if (hunt === h && h.caught < HUNT_GOAL) h.lure.classList.remove("empty"); }, 1300);
      h.cool = 1.4;
    } else {
      sfx("nope");
      $("bubble").textContent = "휙! 놓쳤어요. 가만히 기다려 줘요";
      h.cool = 1;
    }
  }, 180);
  setTimeout(() => { pet.classList.remove("strike"); if (hunt === h) h.striking = false; }, 350);
}

function endHunt() {
  const h = hunt;
  hunt = null;
  h.lure.remove();
  $("room").classList.remove("hunting");
  $("pet").classList.remove("crouch", "strike", "walking", "look");
  tick();
  state.happy = clamp(state.happy + 8 + h.caught * 4);
  state.hunger = clamp(state.hunger + h.caught * 6);
  state.energy = clamp(state.energy - 8);
  if (h.caught >= HUNT_GOAL) bump("huntPerfect");
  addDigest(h.caught);
  const got = earnCoins(h.caught * COIN.hunt + (h.caught >= HUNT_GOAL ? COIN.perfect : 0));
  busy = false;
  sfx(h.caught ? "yay" : "tap");
  say(h.caught >= HUNT_GOAL ? `사냥 대성공! 덥석! 🪙 +${got}` : h.caught ? `${h.caught}마리 잡았어요! 🪙 +${got}` : "다음엔 천천히 움직여 봐요");
  wander();
}

// ---- 숨바꼭질: 게코가 돌·통나무·화분 중 하나에 숨고 자리가 섞인다. 맞히면 더 빨리 섞는다 ----
// 숨는 곳은 셋 다 똑같은 바위 동굴이어야 한다 (모양이 다르면 섞어도 어디 있는지 외워 버린다)
const HIDE_XS = [20, 50, 80], HIDE_ROUNDS = 3;
const SPOT_SVG = `<svg viewBox="0 0 140 80" aria-hidden="true">
  <defs><linearGradient id="spotG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a08b76"/><stop offset="1" stop-color="#5a4a3c"/></linearGradient></defs>
  <path d="M3 80C1 54 12 32 32 21 48 11 66 6 84 9c23 4 41 18 49 38 5 12 6 22 6 33z" fill="url(#spotG)" stroke="#45382c" stroke-width="1.5"/>
  <path d="M22 42c10-15 26-23 44-25M98 22c10 4 18 12 22 21" stroke="#cdb9a1" stroke-width="3.5" stroke-linecap="round" fill="none" opacity=".55"/>
  <path d="M44 80c0-23 11-35 26-35s27 12 27 35z" fill="#1c140e"/></svg>`;
let hideGame = null;
const spotX = (el) => parseFloat(el.style.left);
const petXAt = (x) => Math.max(PET_MIN_X, Math.min(PET_MAX_X, x - 27.5)); // 그 자리 위에 게코 몸 가운데가 오게

function startHide() {
  busy = true;
  stopWalk();
  const spots = HIDE_XS.map((x) => {
    const el = spawn("hide-spot", "", x, 84);
    el.innerHTML = SPOT_SVG;
    el.addEventListener("pointerdown", (e) => { e.stopPropagation(); pickSpot(el); });
    return el;
  });
  hideGame = { spots, round: 0, found: 0, gecko: null, ready: false, swaps: 4, speed: 500 }; // 원래 3번, 600ms
  $("room").classList.add("hiding");
  sfx("start");
  hideRound();
}

function hideRound() {
  const g = hideGame;
  g.ready = false;
  g.spots.forEach((s) => { s.classList.remove("lift", "right", "wrong"); s.style.transition = ""; });
  $("pet").classList.remove("gone");
  g.gecko = g.spots[Math.floor(Math.random() * g.spots.length)];
  $("bubble").textContent = `${g.round + 1}번째! 어디에 숨는지 잘 봐요 👀`;
  const sec = walkTo(petXAt(spotX(g.gecko)), 18);
  setTimeout(() => {
    if (hideGame !== g) return;
    g.gecko.classList.add("lift"); // 들추고
    setTimeout(() => {
      if (hideGame !== g) return;
      $("pet").classList.add("gone"); // 쏙 들어간 뒤 덮는다
      setTimeout(() => {
        if (hideGame !== g) return;
        g.gecko.classList.remove("lift");
        setTimeout(() => shuffleSpots(g), 700);
      }, 400);
    }, 450);
  }, sec * 1000 + 300);
}

function shuffleSpots(g) {
  $("bubble").textContent = "섞는다~ 섞는다~";
  let k = 0;
  (function swapOnce() {
    if (hideGame !== g) return;
    if (k++ >= g.swaps) {
      g.spots.forEach((s) => { s.style.transition = ""; });
      g.ready = true;
      $("bubble").textContent = "게코는 어디에 있을까요? 톡!";
      return;
    }
    const a = Math.floor(Math.random() * 3);
    let b = Math.floor(Math.random() * 2);
    if (b >= a) b++;
    const A = g.spots[a], B = g.spots[b], ax = A.style.left;
    A.style.transition = B.style.transition = `left ${g.speed}ms ease-in-out`;
    A.style.animationDuration = g.speed + "ms";
    A.classList.add("over"); // 하나는 위로 넘어가며 자리를 바꾼다
    A.style.left = B.style.left;
    B.style.left = ax;
    sfx("tap");
    setTimeout(() => { A.classList.remove("over"); swapOnce(); }, g.speed + 60);
  })();
}

function pickSpot(el) {
  const g = hideGame;
  if (!g || !g.ready) return;
  g.ready = false;
  el.classList.add("lift");
  const ok = el === g.gecko;
  const showGecko = () => {
    g.gecko.classList.add("lift");
    placeAt(petXAt(spotX(g.gecko)));
    $("pet").classList.remove("gone");
  };
  if (ok) {
    g.found++;
    sfx("yay");
    showGecko();
    el.classList.add("right");
    $("bubble").textContent = "찾았다! 🎉";
    sparkle(6, spotX(el), 70, 20);
    g.swaps += 2; // 맞히면 더 많이, 더 빨리 섞는다
    g.speed = Math.max(230, g.speed - 120);
  } else {
    sfx("nope");
    el.classList.add("wrong");
    $("bubble").textContent = "여기는 없어요!";
    setTimeout(() => { if (hideGame === g) { showGecko(); $("bubble").textContent = "여기 숨어 있었어요!"; } }, 700);
  }
  setTimeout(() => {
    if (hideGame !== g) return;
    g.round++;
    if (g.round >= HIDE_ROUNDS) endHide();
    else hideRound();
  }, ok ? 1600 : 2300);
}

function endHide() {
  const g = hideGame;
  hideGame = null;
  g.spots.forEach((s) => s.remove());
  $("pet").classList.remove("gone");
  $("room").classList.remove("hiding");
  tick();
  state.happy = clamp(state.happy + 8 + g.found * 5);
  state.energy = clamp(state.energy - 6);
  if (g.found === HIDE_ROUNDS) bump("hidePerfect");
  const got = earnCoins(g.found * COIN.hide + (g.found === HIDE_ROUNDS ? COIN.perfect : 0));
  busy = false;
  sfx(g.found ? "yay" : "tap");
  say((g.found === HIDE_ROUNDS ? "3번 모두 찾았어요! 눈이 정말 좋아요 👀" : `${HIDE_ROUNDS}번 중 ${g.found}번 찾았어요!`)
    + (got ? ` 🪙 +${got}` : ""));
  wander();
}

// ================= 사육장 꾸미기 =================
// 장식은 돌보기·수학·놀이를 하면서 하나씩 열린다. size: 사육장 너비에 대한 크기(%)
// how: 얻는 방법, ok: 열리는 조건, goal: [지금, 목표] (진행 막대를 보여 준다)
const stat = (k) => state.stats[k] || 0;
const stageNo = () => STAGES.indexOf(stage());
const DECOR = [
  { id: "rock", icon: "🪨", name: "돌", size: 13, how: "처음부터 있어요" },
  { id: "grass", icon: "", svg: "grass", name: "뾰족 풀", size: 12, how: "처음부터 있어요" },
  { id: "log", icon: "🪵", name: "통나무", size: 18, how: "알에서 태어나면", ok: () => stageNo() >= 1 },
  { id: "shell", icon: "🐚", name: "조개껍데기", size: 9, how: "수학 미션 통과 1번", goal: () => [stat("mathPass"), 1] },
  { id: "mushroom", icon: "🍄", name: "버섯", size: 10, how: "응가 치우기 10번", goal: () => [stat("poop"), 10] },
  { id: "cactus", icon: "🌵", name: "선인장", size: 15, how: "물 갈아주기 7번", goal: () => [stat("water"), 7] },
  { id: "bone", icon: "🦴", name: "뼈 화석", size: 13, how: "어린 게코로 자라기", ok: () => stageNo() >= 2 },
  { id: "flower", icon: "🌺", name: "꽃", size: 11, how: "수학 한 종류 ★★★ 만들기",
    ok: () => Object.values(state.mathSkill).some((s) => s && s.lvl >= 3) },
  { id: "amphora", icon: "🏺", name: "항아리", size: 15, how: "허물 벗기 1번", goal: () => [stat("shed"), 1] },
  { id: "crystal", icon: "💎", name: "수정", size: 10, how: "오답 노트 졸업 5개", goal: () => [stat("grads"), 5] },
  { id: "palm", icon: "🌴", name: "야자나무", size: 22, how: "사냥 놀이 3마리 모두 잡기", goal: () => [stat("huntPerfect"), 1] },
  { id: "moai", icon: "🗿", name: "석상", size: 16, how: "숨바꼭질 3번 모두 찾기", goal: () => [stat("hidePerfect"), 1] },
  { id: "castle", icon: "🏰", name: "성", size: 22, how: "어른 게코로 자라기", ok: () => stageNo() >= 3 },
  { id: "crown", icon: "👑", name: "왕관", size: 9, how: "2대 게코 키우기", ok: () => state.gen >= 2 },
  // 상점에서 코인으로 사는 장식 (price). svg가 있으면 이모지 대신 그림을 쓴다
  { id: "tuft", icon: "🌾", name: "풀숲", size: 13, price: 15 },
  { id: "tree", icon: "🌳", name: "장식 나무", size: 24, price: 30 },
  { id: "ruby", icon: "", svg: "ruby", name: "루비", size: 10, price: 45 },
  { id: "dragon", icon: "", svg: "dragon", name: "아기 드래곤 모형", size: 17, price: 70 },
];
// 장식 그림 (그라디언트는 쓰지 않는다: 같은 id가 여러 번 나오면 숨겨진 쪽을 가리켜 안 보일 수 있다)
const DECOR_SVG = {
  // 뾰족뾰족한 풀 덤불: 바깥쪽은 진한 잎, 안쪽은 밝은 잎을 겹친다
  grass: `<svg class="dsvg" viewBox="0 0 100 100" aria-hidden="true">
    <ellipse cx="50" cy="92" rx="38" ry="6" fill="#7d6a58"/>
    <polygon points="14,92 6,40 26,90" fill="#2e7d32"/>
    <polygon points="22,92 24,18 36,90" fill="#388e3c"/>
    <polygon points="34,92 44,6 50,90" fill="#2e7d32"/>
    <polygon points="50,92 60,10 64,90" fill="#388e3c"/>
    <polygon points="62,92 80,22 76,90" fill="#2e7d32"/>
    <polygon points="72,92 96,44 86,90" fill="#388e3c"/>
    <polygon points="20,92 14,52 32,90" fill="#4caf50"/>
    <polygon points="30,92 34,32 44,90" fill="#66bb6a"/>
    <polygon points="42,92 54,24 56,90" fill="#4caf50"/>
    <polygon points="54,92 70,36 68,90" fill="#66bb6a"/>
    <polygon points="64,92 86,56 78,90" fill="#4caf50"/>
    <polygon points="38,92 28,58 48,90" fill="#81c784"/>
    <polygon points="52,92 46,48 62,90" fill="#8bc34a"/>
  </svg>`,
  ruby: `<svg class="dsvg" viewBox="0 0 100 100" aria-hidden="true">
    <path d="M14 96c3-9 17-13 36-13s33 4 36 13z" fill="#7d6a58"/><path d="M24 92c6-4 16-5 26-5" stroke="#a8957f" stroke-width="3" stroke-linecap="round" fill="none"/>
    <polygon points="30,26 70,26 88,46 50,90 12,46" fill="#c8102e"/>
    <polygon points="30,26 70,26 62,46 38,46" fill="#ff4d6d"/>
    <polygon points="30,26 38,46 12,46" fill="#ff7a90"/>
    <polygon points="70,26 88,46 62,46" fill="#d81b3c"/>
    <polygon points="12,46 38,46 50,90" fill="#9e0b26"/>
    <polygon points="38,46 62,46 50,90" fill="#e01e44"/>
    <polygon points="62,46 88,46 50,90" fill="#b00d2e"/>
    <path d="M36 30h10l-5 9z" fill="#fff" opacity=".85"/><circle cx="78" cy="18" r="3" fill="#fff"/><path d="M78 10v16M70 18h16" stroke="#fff" stroke-width="1.5"/>
  </svg>`,
  dragon: `<svg class="dsvg" viewBox="0 0 100 100" aria-hidden="true">
    <path d="M14 88h72v5c0 4-16 7-36 7s-36-3-36-7z" fill="#6d4c41"/><ellipse cx="50" cy="88" rx="36" ry="6" fill="#a1887f"/>
    <path d="M66 80c14 1 22-7 20-17-1-5-7-6-8-1 2 6-4 11-13 11z" fill="#6cbf65"/><path d="M80 60l8-6-1 10z" fill="#ffd54f"/>
    <path d="M31 58c-12-8-22-4-24 5 6-3 11-1 13 4 4-5 8-5 11-3z" fill="#4fa34a"/>
    <path d="M69 58c12-8 22-4 24 5-6-3-11-1-13 4-4-5-8-5-11-3z" fill="#4fa34a"/>
    <ellipse cx="50" cy="70" rx="21" ry="16" fill="#7cc576"/><ellipse cx="50" cy="74" rx="12" ry="10" fill="#fff3c4"/>
    <ellipse cx="38" cy="84" rx="7" ry="4" fill="#6cbf65"/><ellipse cx="62" cy="84" rx="7" ry="4" fill="#6cbf65"/>
    <ellipse cx="34" cy="70" rx="4" ry="6" fill="#6cbf65" transform="rotate(25 34 70)"/><ellipse cx="66" cy="70" rx="4" ry="6" fill="#6cbf65" transform="rotate(-25 66 70)"/>
    <path d="M35 22l-5-14 12 9zM65 22l5-14-12 9z" fill="#ffd54f"/><path d="M45 17l5-7 5 7z" fill="#ffb300"/>
    <circle cx="50" cy="38" r="22" fill="#7cc576"/>
    <circle cx="41" cy="37" r="5.5" fill="#222"/><circle cx="59" cy="37" r="5.5" fill="#222"/>
    <circle cx="43" cy="35" r="2" fill="#fff"/><circle cx="61" cy="35" r="2" fill="#fff"/>
    <ellipse cx="33" cy="46" rx="4.5" ry="2.6" fill="#ff8fab" opacity=".8"/><ellipse cx="67" cy="46" rx="4.5" ry="2.6" fill="#ff8fab" opacity=".8"/>
    <path d="M44 48q6 5 12 0" stroke="#2e5e2a" stroke-width="2.2" stroke-linecap="round" fill="none"/>
  </svg>`,
};
const decorIcon = (d) => (d.svg ? DECOR_SVG[d.svg] : d.icon);
const MAX_DECOR = 12, DECOR_SCALE = [0.6, 1.8];
const decorDef = (id) => DECOR.find((d) => d.id === id);
function decorReady(d) {
  if (d.price) return false; // 상점 장식은 사야만 생긴다
  if (d.ok) return d.ok();
  if (d.goal) { const [now, need] = d.goal(); return now >= need; }
  return true;
}
function bump(k) { state.stats[k] = stat(k) + 1; }

// 새로 열린 장식이 있으면 알려 준다 (놀이·미션 중에는 끝난 뒤에)
function checkDecor() {
  if (busy) return;
  const fresh = DECOR.filter((d) => !state.decorGot.includes(d.id) && decorReady(d));
  if (!fresh.length) return;
  fresh.forEach((d) => state.decorGot.push(d.id));
  save();
  sfx("yay");
  say(fresh.length === 1 ? `🎁 새 장식을 얻었어요! ${fresh[0].icon} ${fresh[0].name}` : `🎁 새 장식 ${fresh.length}개! 🎨 꾸미기를 눌러 봐요`);
}

// 놓은 장식 그리기. 크기는 사육장 너비를 기준으로 정한다 (가로·세로 화면 모두 같은 비율)
let decorating = false, selDecor = -1;
function decorPx(item) {
  const d = decorDef(item.id);
  return $("room").clientWidth * (d ? d.size : 12) / 100 * (item.s || 1);
}
function renderDecor() {
  const layer = $("decorLayer");
  layer.innerHTML = "";
  state.decor.forEach((item, i) => {
    const d = decorDef(item.id);
    if (!d) return;
    const el = document.createElement("div");
    el.className = "decor-item" + (decorating && i === selDecor ? " sel" : "");
    el.innerHTML = decorIcon(d);
    el.dataset.i = i;
    el.style.left = item.x + "%";
    el.style.top = item.y + "%";
    el.style.fontSize = decorPx(item).toFixed(1) + "px";
    el.style.setProperty("--flip", item.f || 1);
    layer.appendChild(el);
  });
  placeTools();
}
if (window.ResizeObserver) new ResizeObserver(() => renderDecor()).observe($("room"));
else window.addEventListener("resize", renderDecor);

// 고른 장식 위에 도구(뒤집기·작게·크게·빼기)를 띄운다
function placeTools() {
  const tools = $("decorTools"), item = state.decor[selDecor];
  if (!decorating || !item) { tools.hidden = true; return; }
  tools.hidden = false;
  const h = decorPx(item), roomH = $("room").clientHeight;
  const topPx = item.y / 100 * roomH - h - 10;
  tools.style.left = Math.max(18, Math.min(82, item.x)) + "%";
  if (topPx > 60) { tools.style.top = topPx + "px"; tools.style.transform = "translate(-50%, -100%)"; }
  else { tools.style.top = `calc(${item.y}% + 8px)`; tools.style.transform = "translate(-50%, 0)"; }
}
document.querySelectorAll("[data-tool]").forEach((b) => b.addEventListener("click", (e) => {
  e.stopPropagation();
  const item = state.decor[selDecor];
  if (!item) return;
  const t = b.dataset.tool;
  if (t === "flip") item.f = -(item.f || 1);
  else if (t === "smaller") item.s = Math.max(DECOR_SCALE[0], +((item.s || 1) - 0.2).toFixed(1));
  else if (t === "bigger") item.s = Math.min(DECOR_SCALE[1], +((item.s || 1) + 0.2).toFixed(1));
  else if (t === "remove") { state.decor.splice(selDecor, 1); selDecor = -1; }
  sfx(t === "remove" ? "pick" : "tap");
  save();
  renderDecor();
  renderTray();
}));

// 장식함
function renderTray() {
  const list = $("decorList");
  list.innerHTML = "";
  $("decorCount").textContent = `놓은 장식 ${state.decor.length}/${MAX_DECOR}`;
  for (const d of DECOR) {
    const got = state.decorGot.includes(d.id);
    const el = document.createElement("div");
    el.className = "tray-item" + (got ? "" : " locked");
    el.dataset.id = d.id;
    let html = `<span class="ti-icon">${decorIcon(d)}</span><span class="ti-name">${got ? d.name : "🔒 " + d.name}</span>`;
    if (!got) {
      html += `<span class="ti-how">${d.price ? `🛒 상점에서 🪙 ${d.price}` : d.how}</span>`;
      if (d.goal) {
        const [now, need] = d.goal();
        html += `<span class="ti-bar"><i style="width:${Math.min(100, now / need * 100)}%"></i></span>`;
      }
    } else if (!state.decorSeen.includes(d.id)) html += `<span class="ti-new">NEW</span>`;
    el.innerHTML = html;
    if (got) el.addEventListener("pointerdown", (e) => startTrayDrag(e, d));
    list.appendChild(el);
  }
}

function openDecor() {
  if (busy) return;
  tick();
  busy = true;
  decorating = true;
  selDecor = -1;
  stopWalk();
  $("room").classList.add("decorating");
  renderTray();
  $("decorTray").hidden = false;
  state.decorSeen = state.decorGot.slice(); // 장식함을 열었으니 NEW 표시는 이번까지만
  save();
  renderDecor();
  render();
  $("bubble").textContent = "어떻게 꾸며 줄까요? 🎨";
  sfx("tap");
}
function closeDecor() {
  decorating = false;
  selDecor = -1;
  $("room").classList.remove("decorating");
  $("decorTray").hidden = true;
  busy = false;
  save();
  renderDecor();
  render();
  say(state.decor.length ? "멋진 집이 됐어요! 고마워요 🦎" : "다음에 꾸며 줘요!");
  wander();
}
$("decorBtn").addEventListener("click", openDecor);
$("decorDone").addEventListener("click", closeDecor);

// 장식함에서 끌어다 사육장에 놓기
function startTrayDrag(e, d) {
  e.preventDefault();
  if (state.decor.length >= MAX_DECOR) { nope(`장식은 ${MAX_DECOR}개까지 놓을 수 있어요`); return; }
  const src = e.currentTarget;
  const ghost = document.createElement("div");
  ghost.className = "decor-ghost";
  ghost.innerHTML = decorIcon(d);
  ghost.style.fontSize = decorPx({ id: d.id }) + "px";
  document.body.appendChild(ghost);
  const move = (ev) => { ghost.style.left = ev.clientX + "px"; ghost.style.top = ev.clientY + "px"; };
  move(e);
  sfx("tap");
  try { src.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
  const up = (ev) => {
    src.removeEventListener("pointermove", move);
    src.removeEventListener("pointerup", up);
    src.removeEventListener("pointercancel", up);
    ghost.remove();
    const r = $("room").getBoundingClientRect();
    if (ev.type === "pointerup" && ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom) {
      state.decor.push({ id: d.id, x: decorX((ev.clientX - r.left) / r.width * 100), y: decorY((ev.clientY - r.top) / r.height * 100), s: 1, f: 1 });
      selDecor = state.decor.length - 1;
      sfx("pick");
      save();
      renderDecor();
      renderTray();
    }
  };
  src.addEventListener("pointermove", move);
  src.addEventListener("pointerup", up);
  src.addEventListener("pointercancel", up);
}
const decorX = (x) => Math.max(3, Math.min(97, +x.toFixed(1)));
const decorY = (y) => Math.max(14, Math.min(99, +y.toFixed(1)));

// 놓은 장식: 톡 누르면 고르기, 끌면 옮기기, 장식함 위에 놓으면 빼기
$("decorLayer").addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".decor-item");
  if (!decorating || !el) return;
  e.stopPropagation();
  const i = +el.dataset.i, item = state.decor[i];
  const start = { x: e.clientX, y: e.clientY }, r = $("room").getBoundingClientRect();
  let moved = false;
  try { el.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
  const move = (ev) => {
    if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
    moved = true;
    el.classList.add("dragging");
    $("decorTools").hidden = true;
    item.x = decorX((ev.clientX - r.left) / r.width * 100);
    item.y = decorY((ev.clientY - r.top) / r.height * 100);
    el.style.left = item.x + "%";
    el.style.top = item.y + "%";
  };
  const up = (ev) => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    const tr = $("decorTray").getBoundingClientRect();
    if (moved && ev.clientX > tr.left && ev.clientX < tr.right && ev.clientY > tr.top && ev.clientY < tr.bottom) {
      state.decor.splice(i, 1); // 장식함으로 되돌려 놓으면 뺀다
      selDecor = -1;
      sfx("pick");
    } else if (moved) {
      selDecor = i;
      sfx("tap");
    } else {
      selDecor = selDecor === i ? -1 : i;
    }
    save();
    renderDecor();
    renderTray();
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
});
// 빈 곳을 누르면 고른 것을 놓아준다
$("room").addEventListener("pointerdown", (e) => {
  if (decorating && !e.target.closest(".decor-item, #decorTools") && selDecor >= 0) { selDecor = -1; renderDecor(); }
});

// ================= 상점 =================
// 놀아주기로 모은 코인으로 은신처·물그릇·바닥재를 업그레이드하고 장식을 산다.
// 업그레이드 단계는 #room의 data-hide / data-dish / data-floor로 그림에 반영된다 (style.css)
function renderUpgrades() {
  const room = $("room");
  for (const u of UPGRADES) {
    const lv = String(upLv(u.id));
    if (room.dataset[u.id] !== lv) room.dataset[u.id] = lv;
  }
  $("coinLabel").textContent = "🪙 " + state.coins;
}

let shopSay = "";
function renderShop(msg) {
  $("shopCoins").textContent = "🪙 " + state.coins;
  renderUpgrades();
  if (msg !== undefined) $("shopMsg").textContent = msg;
  const ups = $("shopUps");
  ups.innerHTML = "";
  for (const u of UPGRADES) {
    const lv = upLv(u.id), next = u.levels[lv];
    const row = document.createElement("div");
    row.className = "shop-up";
    row.innerHTML = `<span class="si">${u.icon}</span><span class="st"><b></b><span class="shop-lv"></span><small></small></span>`;
    row.querySelector("b").textContent = `${u.name}: ${u.levels[lv - 1].name}`;
    row.querySelector(".shop-lv").textContent = "★".repeat(lv) + "☆".repeat(u.levels.length - lv);
    row.querySelector("small").textContent = next ? `다음: ${next.name} — ${next.desc}` : "최고 단계예요! 👑";
    const b = document.createElement("button");
    b.className = "buy" + (!next ? " done" : state.coins < next.price ? " poor" : "");
    b.textContent = next ? `🪙 ${next.price}` : "완성";
    if (next) b.addEventListener("click", () => buyUpgrade(u));
    else b.disabled = true;
    row.appendChild(b);
    ups.appendChild(row);
  }
  const decs = $("shopDecor");
  decs.innerHTML = "";
  for (const d of DECOR.filter((x) => x.price)) {
    const owned = state.decorGot.includes(d.id);
    const card = document.createElement("div");
    card.className = "shop-dec";
    card.innerHTML = `<span class="si">${decorIcon(d)}</span><b></b>`;
    card.querySelector("b").textContent = d.name;
    const b = document.createElement("button");
    b.className = "buy" + (owned ? " done" : state.coins < d.price ? " poor" : "");
    b.textContent = owned ? "✅ 샀어요" : `🪙 ${d.price}`;
    if (owned) b.disabled = true;
    else b.addEventListener("click", () => buyDecor(d));
    card.appendChild(b);
    decs.appendChild(card);
  }
}

// 코인이 모자라면 몇 개 더 필요한지 알려 준다. 살 수 있으면 true
function pay(price) {
  if (state.coins >= price) { state.coins -= price; return true; }
  sfx("nope");
  renderShop(`코인이 ${price - state.coins}개 더 필요해요! ⚽ 놀아주기로 모아요`);
  return false;
}

function buyUpgrade(u) {
  const lv = upLv(u.id), next = u.levels[lv];
  if (!next || !pay(next.price)) return;
  tick(); // 지금까지는 예전 단계로 계산하고, 지금부터 새 단계
  state.upgrades[u.id] = lv + 1;
  save();
  sfx("buy");
  renderUpgrades();
  shopSay = `${u.name}${josa(u.name, "이", "가")} ${next.name}${josa(next.name, "이", "가")} 됐어요! 고마워요 🦎`;
  renderShop(`🎉 업그레이드 성공! ${u.icon} ${next.name}`);
}

function buyDecor(d) {
  if (state.decorGot.includes(d.id) || !pay(d.price)) return;
  state.decorGot.push(d.id); // decorSeen에는 넣지 않아서 꾸미기 버튼에 NEW가 뜬다
  save();
  sfx("buy");
  shopSay = `${d.name}${josa(d.name, "을", "를")} 샀어요! 🎨 꾸미기에서 놓아 봐요`;
  renderShop(`🎁 ${d.name}${josa(d.name, "을", "를")} 샀어요! 🎨 꾸미기에서 놓을 수 있어요`);
}

function openShop() {
  if (busy) return;
  tick();
  busy = true;
  shopSay = "";
  renderShop("");
  $("shopPanel").hidden = false;
  render();
  sfx("tap");
}
function closeShop() {
  $("shopPanel").hidden = true;
  busy = false;
  render();
  if (shopSay) { say(shopSay); shopSay = ""; }
}
$("shopBtn").addEventListener("click", openShop);
$("shopClose").addEventListener("click", closeShop);
$("shopDone").addEventListener("click", closeShop);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("shopPanel").hidden) closeShop(); });

// ---- 탈피: 벽에 몸을 비벼 허물을 벗고, 벗은 허물을 먹는다 ----
const SKIN_SVG = `<svg viewBox="0 0 80 30" aria-hidden="true">
  <path d="M3 22c6-9 15-12 25-9 7 2 12-4 20-5 9-1 17 3 24 9-6 5-14 5-21 3-8-2-12 4-21 5C20 26 10 27 3 22z" fill="#f3efe2" fill-opacity=".85" stroke="#cfc6ae"/>
  <path d="M14 20c5-3 10-3 14-1M36 15c4-2 9-2 13 0M55 13c3 1 6 3 8 5" stroke="#d8cfb8" fill="none"/></svg>`;

function maybeShed() {
  if (state.shedPhase === "ready" && !busy && !action && !petting && !state.sleeping && !document.hidden
    && stage().key !== "egg") playShed();
}
function playShed() {
  busy = true;
  render();
  $("bubble").textContent = "허물 벗을 시간! 벽에 몸을 비벼요";
  const sec = walkTo(PET_MIN_X, 8);
  setTimeout(() => {
    $("pet").classList.add("rubbing");
    sfx("rustle");
    let n = 0;
    const flakes = setInterval(() => {
      const [x, y] = imgToRoom(25 + Math.random() * 55, 45 + Math.random() * 22);
      const f = spawn("flake", "", x, y);
      f.style.setProperty("--dx", (Math.random() * 30 - 15).toFixed(0) + "px");
      setTimeout(() => f.remove(), 1600);
      n++;
      if (n === 4) { state.shedPhase = "done"; bump("shed"); save(); render(); } // 하얀 허물이 벗겨지며 원래 색으로
      if (n % 4 === 0) sfx("rustle");
    }, 220);
    setTimeout(() => {
      clearInterval(flakes);
      $("pet").classList.remove("rubbing");
      // 벗은 허물은 꼬리 쪽에 남는다 → 뒤돌아서 먹는다
      const [sx, sy] = imgToRoom(10, 86);
      const skin = spawn("skin", "", sx, sy);
      skin.innerHTML = SKIN_SVG;
      setTimeout(() => {
        facing = -facing;
        $("pet").style.setProperty("--face", facing);
        $("bubble").textContent = "벗은 허물을 냠냠! 🦎";
        setTimeout(() => {
          setAction("eat", 1800);
          sfx("eat");
          skin.classList.add("eaten");
          setTimeout(() => {
            skin.remove();
            state.happy = clamp(state.happy + 10);
            busy = false;
            sfx("grow");
            const [hx, hy] = imgToRoom(50, 55);
            sparkle(8, hx, hy, 30);
            say("반짝반짝 새 피부! ✨");
            setTimeout(() => { if (!busy) say("게코는 벗은 허물을 먹어서 영양을 챙겨요"); }, 2300);
            wander();
          }, 1800);
        }, 500);
      }, 600);
    }, 2600);
  }, sec * 1000 + 200);
}

if (TEST) {
  $("testShed").addEventListener("click", () => {
    state.shedPhase = "pre"; state.shedFor = nextGoal().key; state.shedWet = 0;
    save(); render();
  });
  $("testShedNow").addEventListener("click", () => { state.shedPhase = "ready"; maybeShed(); });
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
  renderDecor(); // 서버에서 불러온 꾸미기 반영
  tick();
});
