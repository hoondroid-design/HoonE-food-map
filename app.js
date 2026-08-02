// ============================================================
// 강릉 뭐먹지 — app.js
// 구글시트(CSV) 로드 → 카카오맵 마커 표시 → 검색/필터 → 클릭 로깅
// 수정이 필요한 값은 대부분 config.js 에 있습니다.
// ============================================================

const els = {
  map: document.getElementById("map"),
  mapStatus: document.getElementById("mapStatus"),
  list: document.getElementById("list"),
  emptyState: document.getElementById("emptyState"),
  chips: document.getElementById("categoryChips"),
  search: document.getElementById("searchInput"),
  starOnly: document.getElementById("starOnly"),
  totalCount: document.getElementById("totalCount"),
  verDate: document.getElementById("verDate"),
  detailSheet: document.getElementById("detailSheet"),
  detailBody: document.getElementById("detailBody"),
  detailClose: document.getElementById("detailClose"),
};

let ALL_ITEMS = [];      // 시트에서 파싱한 전체 데이터
let CURRENT_CATEGORY = "전체";
let map, geocoder;
let markers = {};        // id -> kakao marker
let overlays = {};       // id -> kakao label overlay

const COORD_CACHE_KEY = "gnfood_coord_cache_v1";
function loadCoordCache() {
  try { return JSON.parse(localStorage.getItem(COORD_CACHE_KEY)) || {}; }
  catch { return {}; }
}
function saveCoordCache(cache) {
  try { localStorage.setItem(COORD_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

// ---------------------------------------------------------
// 1. 구글시트 CSV 불러오기 (gviz range 쿼리 — 시트 공유 설정만 해두면 별도 게시 불필요)
// ---------------------------------------------------------
function buildSheetUrl() {
  const { SHEET_ID, SHEET_NAME, SHEET_RANGE } = CONFIG;
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`;
  const params = new URLSearchParams({
    tqx: "out:csv",
    sheet: SHEET_NAME,
    range: SHEET_RANGE,
  });
  return `${base}?${params.toString()}`;
}

async function loadSheetData() {
  const url = buildSheetUrl();
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`시트를 불러오지 못했습니다 (HTTP ${res.status}). 시트 공유 설정을 확인하세요.`);
  }
  const csvText = await res.text();
  const parsed = Papa.parse(csvText.trim(), { skipEmptyLines: false });
  const rows = parsed.data;

  // 첫 행은 헤더(구분/주요메뉴/식당/소재지/비고/방문/작성자 후기) → 건너뜀
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 4) continue;
    const [star, category, menu, name, location, note, visited, blog] = r;
    if (!name || !name.trim()) continue; // 식당명 없는 빈 행 skip
    items.push({
      id: `${name.trim()}__${location ? location.trim() : ""}`,
      starred: !!(star && star.trim()),
      category: (category || "").trim() || "기타",
      menu: (menu || "").trim(),
      name: name.trim(),
      location: (location || "").trim(),
      note: (note || "").trim(),
      visited: (visited || "").trim() === "O",
      blog: (blog || "").trim(),
      lat: null,
      lng: null,
    });
  }
  return items;
}

// ---------------------------------------------------------
// 2. 카카오 장소검색으로 좌표 자동 추정 (식당명 기준, localStorage 캐시)
// ---------------------------------------------------------
function keywordSearchOnce(query) {
  return new Promise((resolve) => {
    geocoder.keywordSearch(query, (result, status) => {
      if (status === kakao.maps.services.Status.OK && result.length > 0) {
        resolve({ lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) });
      } else {
        resolve(null);
      }
    });
  });
}

async function resolveCoordinates(items) {
  const cache = loadCoordCache();
  let resolvedCount = 0;
  const toLookup = [];

  items.forEach((it) => {
    const cached = cache[it.id];
    if (cached) {
      it.lat = cached.lat;
      it.lng = cached.lng;
      resolvedCount++;
    } else {
      toLookup.push(it);
    }
  });
  renderMapStatus(resolvedCount, items.length, toLookup.length > 0);

  for (const it of toLookup) {
    const query = `강릉 ${it.location} ${it.name}`.trim();
    const coord = await keywordSearchOnce(query) || await keywordSearchOnce(`강릉 ${it.name}`);
    if (coord) {
      it.lat = coord.lat;
      it.lng = coord.lng;
      cache[it.id] = coord;
      resolvedCount++;
      addOrUpdateMarker(it);
    }
    renderMapStatus(resolvedCount, items.length, true);
    await new Promise((r) => setTimeout(r, 180)); // API 과호출 방지
  }
  saveCoordCache(cache);
  renderMapStatus(resolvedCount, items.length, false);
}

function renderMapStatus(resolved, total, loading) {
  els.mapStatus.textContent = loading
    ? `위치 확인 중… (${resolved}/${total})`
    : `지도에 ${resolved}곳 표시됨 (총 ${total}곳 중 위치 확인 실패 ${total - resolved}곳)`;
}

// ---------------------------------------------------------
// 3. 카카오맵 초기화 & 마커
// ---------------------------------------------------------
function initMap() {
  map = new kakao.maps.Map(els.map, {
    center: new kakao.maps.LatLng(CONFIG.MAP_CENTER.lat, CONFIG.MAP_CENTER.lng),
    level: CONFIG.MAP_LEVEL,
  });
  geocoder = new kakao.maps.services.Places();
}

function addOrUpdateMarker(item) {
  if (!item.lat || !item.lng) return;
  const pos = new kakao.maps.LatLng(item.lat, item.lng);

  const marker = new kakao.maps.Marker({ position: pos, map });
  kakao.maps.event.addListener(marker, "click", () => openDetail(item));
  markers[item.id] = marker;

  const content = document.createElement("div");
  content.className = "marker-label" + (item.starred ? " starred" : "");
  content.textContent = (item.starred ? "★ " : "") + item.name;
  content.addEventListener("click", () => openDetail(item));

  const overlay = new kakao.maps.CustomOverlay({
    position: pos,
    content,
    yAnchor: 1,
  });
  overlays[item.id] = overlay;
  applyVisibility(item, isItemVisible(item));
}

function applyVisibility(item, visible) {
  const m = markers[item.id];
  const o = overlays[item.id];
  if (m) m.setMap(visible ? map : null);
  if (o) o.setMap(visible ? map : null);
}

// ---------------------------------------------------------
// 4. 카테고리 칩 / 검색 / 필터
// ---------------------------------------------------------
function renderChips(items) {
  const cats = ["전체", ...Array.from(new Set(items.map((i) => i.category)))];
  els.chips.innerHTML = "";
  cats.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.textContent = cat;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(cat === CURRENT_CATEGORY));
    btn.addEventListener("click", () => {
      CURRENT_CATEGORY = cat;
      [...els.chips.children].forEach((c) =>
        c.setAttribute("aria-selected", String(c.textContent === cat))
      );
      renderAll();
    });
    els.chips.appendChild(btn);
  });
}

function isItemVisible(item) {
  const q = els.search.value.trim().toLowerCase();
  const matchesQuery =
    !q ||
    item.name.toLowerCase().includes(q) ||
    item.menu.toLowerCase().includes(q) ||
    item.location.toLowerCase().includes(q) ||
    item.note.toLowerCase().includes(q);
  const matchesCategory = CURRENT_CATEGORY === "전체" || item.category === CURRENT_CATEGORY;
  const matchesStar = !els.starOnly.checked || item.starred;
  return matchesQuery && matchesCategory && matchesStar;
}

function renderList(items) {
  const visible = items.filter(isItemVisible);
  els.list.innerHTML = "";
  els.emptyState.hidden = visible.length > 0;

  visible.forEach((item, idx) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <span class="idx">no.${String(idx + 1).padStart(3, "0")}</span>
      <div class="body">
        <div class="row1">
          <span class="name">${escapeHtml(item.name)}</span>
          ${item.starred ? '<span class="star-badge">★</span>' : ""}
          <span class="tag">${escapeHtml(item.category)}</span>
        </div>
        <div class="menu">${escapeHtml(item.menu)}</div>
        <div class="loc">${escapeHtml(item.location)}</div>
      </div>
    `;
    li.addEventListener("click", () => {
      openDetail(item);
      if (item.lat && item.lng) {
        map.panTo(new kakao.maps.LatLng(item.lat, item.lng));
      }
    });
    els.list.appendChild(li);
  });

  // 지도 위 마커 표시 여부 갱신
  ALL_ITEMS.forEach((item) => applyVisibility(item, isItemVisible(item)));
}

function renderAll() {
  renderList(ALL_ITEMS);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------
// 5. 상세 시트 + 클릭 로깅
// ---------------------------------------------------------
function openDetail(item) {
  els.detailBody.innerHTML = `
    <div class="detail-eyebrow">${escapeHtml(item.category)} · ${escapeHtml(item.menu)}</div>
    <div class="detail-title">${item.starred ? "★ " : ""}${escapeHtml(item.name)}</div>
    <div class="detail-row"><b>위치</b> · ${escapeHtml(item.location)}</div>
    <div class="detail-row"><b>방문 여부</b> · ${item.visited ? "직접 방문함" : "미방문/전언"}</div>
    ${item.note ? `<div class="detail-note">${escapeHtml(item.note)}</div>` : ""}
    ${item.blog ? `<a class="detail-link" href="${item.blog}" target="_blank" rel="noopener">작성자 후기 보러가기 →</a>` : ""}
  `;
  els.detailSheet.hidden = false;
  logClick(item.name);
}

els.detailClose.addEventListener("click", () => {
  els.detailSheet.hidden = true;
});

function logClick(restaurantName) {
  const url = CONFIG.CLICK_LOG_URL;
  if (!url || url.includes("여기에_배포된_스크립트_ID")) return; // 미설정 상태면 스킵
  const query = new URLSearchParams({ name: restaurantName }).toString();
  // Apps Script 웹앱은 CORS 응답을 안 주는 경우가 많아 no-cors 로 fire-and-forget
  fetch(`${url}?${query}`, { mode: "no-cors" }).catch(() => {});
}

// ---------------------------------------------------------
// 6. 이벤트 바인딩 & 부트스트랩
// ---------------------------------------------------------
els.search.addEventListener("input", renderAll);
els.starOnly.addEventListener("change", renderAll);

async function bootstrap() {
  els.verDate.textContent = new Date().toLocaleDateString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
  }) + " 갱신";

  initMap();

  try {
    ALL_ITEMS = await loadSheetData();
  } catch (err) {
    els.mapStatus.textContent = err.message;
    els.emptyState.hidden = false;
    els.emptyState.textContent = "데이터를 불러오지 못했습니다. config.js의 시트 설정과 공유 권한을 확인하세요.";
    return;
  }

  els.totalCount.textContent = `${ALL_ITEMS.length}곳 수록`;
  renderChips(ALL_ITEMS);
  renderList(ALL_ITEMS);
  resolveCoordinates(ALL_ITEMS); // 백그라운드로 진행, 완료되는 대로 마커 추가
}

bootstrap();
