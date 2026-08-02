// ============================================================
// 강릉 뭐먹지 — app.js (E열 주소 기준 지오코딩 우대 적용)
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
  visitCounter: document.getElementById("visitCounter"),
  verDate: document.getElementById("verDate"),
  detailSheet: document.getElementById("detailSheet"),
  detailBody: document.getElementById("detailBody"),
  detailClose: document.getElementById("detailClose"),
};

let ALL_ITEMS = [];      
let CURRENT_CATEGORY = "전체";
let map, places, geocoder;
let markers = {};        
let overlays = {};       
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// 캐시 키 버전 업 (이전의 잘못 검색된 엉뚱한 위치 캐시 완전 초기화)
const COORD_CACHE_KEY = "gnfood_coord_cache_v4_colE";

function loadCoordCache() {
  try { return JSON.parse(localStorage.getItem(COORD_CACHE_KEY)) || {}; }
  catch { return {}; }
}
function saveCoordCache(cache) {
  try { localStorage.setItem(COORD_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

// 1. 구글시트 CSV 불러오기 (E열 = 주소 인식)
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

async function fetchLastUpdatedDate() {
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/edit`);
    if (res.ok) {
      const today = new Date();
      return `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')} 업데이트`;
    }
  } catch (e) {}
  const now = new Date();
  return `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')} 업데이트`;
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

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 4) continue;
    
    // E열(index 4)을 주소(Address)로 매핑
    const [star, category, menu, name, address, note, visited, blog] = r;
    if (!name || !name.trim()) continue; 

    const cleanAddress = (address || "").trim();

    items.push({
      id: `${name.trim()}__${cleanAddress}`,
      starred: !!(star && star.trim()),
      category: (category || "").trim() || "기타",
      menu: (menu || "").trim(),
      name: name.trim(),
      address: cleanAddress, // E열 주소
      note: (note || "").trim(),
      visited: (visited || "").trim() === "O",
      blog: (blog || "").trim(),
      lat: null,
      lng: null,
    });
  }
  return items;
}

// 2. 카카오 주소/키워드 검색 (주소 검색 1순위 적용)
function geocodeAddressOnce(address) {
  return new Promise((resolve) => {
    geocoder.addressSearch(address, (result, status) => {
      if (status === kakao.maps.services.Status.OK && result.length > 0) {
        resolve({ lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) });
      } else {
        resolve(null);
      }
    });
  });
}

function keywordSearchOnce(query) {
  return new Promise((resolve) => {
    places.keywordSearch(query, (result, status) => {
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
      addOrUpdateMarker(it);
    } else {
      toLookup.push(it);
    }
  });

  renderMapStatus(resolvedCount, items.length, toLookup.length > 0);

  for (const it of toLookup) {
    let coord = null;
    
    // 1순위: E열에 입력된 주소를 정확한 지오코더 주소로 찾기
    if (it.address) {
      coord = await geocodeAddressOnce(it.address);
    }
    
    // 2순위: 주소로 도저히 못 찾을 경우 상호명으로 보조 검색
    if (!coord) {
      coord = await keywordSearchOnce(`강릉 ${it.address} ${it.name}`.trim())
        || await keywordSearchOnce(`강릉 ${it.name}`);
    }

    if (coord) {
      it.lat = coord.lat;
      it.lng = coord.lng;
      cache[it.id] = coord;
      resolvedCount++;
      addOrUpdateMarker(it);
    }
    renderMapStatus(resolvedCount, items.length, true);
    await new Promise((r) => setTimeout(r, 150));
  }
  saveCoordCache(cache);
  renderMapStatus(resolvedCount, items.length, false);
}

function renderMapStatus(resolved, total, loading) {
  const failed = total - resolved;
  els.mapStatus.textContent = loading
    ? `위치 확인 중… (${resolved}/${total})`
    : `지도에 ${resolved}곳 정확히 표시됨 ${failed > 0 ? `(주소 미확인 ${failed}곳)` : ''}`;
}

// 3. 지도 및 마커 제어
function initMap() {
  map = new kakao.maps.Map(els.map, {
    center: new kakao.maps.LatLng(CONFIG.MAP_CENTER.lat, CONFIG.MAP_CENTER.lng),
    level: CONFIG.MAP_LEVEL,
  });
  places = new kakao.maps.services.Places();
  geocoder = new kakao.maps.services.Geocoder();
}

function addOrUpdateMarker(item) {
  if (!item.lat || !item.lng || markers[item.id]) return;
  const pos = new kakao.maps.LatLng(item.lat, item.lng);

  const marker = new kakao.maps.Marker({ position: pos, map: map });
  kakao.maps.event.addListener(marker, "click", () => {
    openDetail(item);
    map.panTo(pos);
  });
  markers[item.id] = marker;

  const content = document.createElement("div");
  content.className = "marker-label" + (item.starred ? " starred" : "");
  content.innerHTML = (item.starred ? "★ " : "") + escapeHtml(item.name);
  content.onclick = (e) => {
    e.stopPropagation();
    openDetail(item);
    map.panTo(pos);
  };

  const overlay = new kakao.maps.CustomOverlay({
    position: pos,
    content: content,
    yAnchor: 1.45,
    zIndex: item.starred ? 3 : 2
  });
  overlay.setMap(map);
  overlays[item.id] = overlay;

  applyVisibility(item, isItemVisible(item));
}

function applyVisibility(item, visible) {
  const m = markers[item.id];
  const o = overlays[item.id];
  if (m) m.setVisible(visible);
  if (o) o.setMap(visible ? map : null);
}

// 4. 식당 목록 및 카테고리
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
    item.address.toLowerCase().includes(q) ||
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
    
    const reviewBadge = item.blog ? `<span class="review-badge" title="리뷰 있음">N</span>` : "";
    const starIcon = item.starred ? `<span class="star-badge">★</span>` : "";

    li.innerHTML = `
      <span class="idx">no.${String(idx + 1).padStart(3, "0")}</span>
      <div class="body">
        <div class="row1">
          <span class="name">${escapeHtml(item.name)}</span>
          <span class="tag">${escapeHtml(item.category)}</span>
          ${starIcon}
          ${reviewBadge}
        </div>
        <div class="menu">${escapeHtml(item.menu)}</div>
        <div class="loc">${escapeHtml(item.address)}</div>
      </div>
      <div class="arrow-btn" aria-label="상세보기">›</div>
    `;

    li.addEventListener("click", () => {
      openDetail(item);
      if (item.lat && item.lng) {
        map.panTo(new kakao.maps.LatLng(item.lat, item.lng));
      }
    });
    els.list.appendChild(li);
  });

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

// 5. 상세 시트 및 유틸
function buildDirectionLinks(item) {
  if (!item.lat || !item.lng) return "";
  const kakaoUrl = `https://map.kakao.com/link/to/${encodeURIComponent(item.name)},${item.lat},${item.lng}`;
  const tmapUrl = `tmap://route?goalname=${encodeURIComponent(item.name)}&goalx=${item.lng}&goaly=${item.lat}`;
  
  let html = `<a class="detail-link" href="${kakaoUrl}" target="_blank" rel="noopener">🚗 카카오맵 길찾기</a>`;
  if (IS_MOBILE) {
    html += `<a class="detail-link detail-link--alt" href="${tmapUrl}">🚕 티맵 길찾기</a>`;
  }
  return html;
}

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

function openDetail(item) {
  els.detailBody.innerHTML = `
    <div class="detail-eyebrow">${escapeHtml(item.category)} · ${escapeHtml(item.menu)}</div>
    <div class="detail-title">${item.starred ? "★ " : ""}${escapeHtml(item.name)}</div>
    <div class="detail-row detail-row--address">
      <span><b>주소</b> · ${escapeHtml(item.address)}</span>
      ${item.address ? `<button type="button" class="copy-btn" id="copyAddressBtn">📋 주소복사</button>` : ""}
    </div>
    <div class="detail-row"><b>방문 여부</b> · ${item.visited ? "직접 방문함" : "미방문/전언"}</div>
    ${item.note ? `
      <div class="detail-note">
        <div class="detail-note-label">🙋🏻 한 줄 리뷰</div>
        ${escapeHtml(item.note)}
      </div>` : ""}
    <div class="detail-actions">
      ${item.blog ? `<a class="detail-link detail-link--naver" href="${item.blog}" target="_blank" rel="noopener">작성자 후기 보러가기 →</a>` : ""}
      ${buildDirectionLinks(item)}
    </div>
  `;
  els.detailSheet.hidden = false;

  const copyBtn = document.getElementById("copyAddressBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      copyToClipboard(item.address)
        .then(() => {
          copyBtn.textContent = "✅ 복사완료";
          copyBtn.classList.add("copy-btn--done");
          setTimeout(() => {
            copyBtn.textContent = "📋 주소복사";
            copyBtn.classList.remove("copy-btn--done");
          }, 1500);
        })
        .catch(() => {
          copyBtn.textContent = "복사 실패";
        });
    });
  }

  logClick(item.name);
}

els.detailClose.addEventListener("click", () => {
  els.detailSheet.hidden = true;
});

function logClick(restaurantName) {
  const url = CONFIG.CLICK_LOG_URL;
  if (!url || url.includes("여기에_배포된_스크립트_ID")) return;
  const query = new URLSearchParams({ name: restaurantName }).toString();
  fetch(`${url}?${query}`, { mode: "no-cors" }).catch(() => {});
}

// 방문자수 집계
const VISITOR_ID_KEY = "gnfood_visitor_id";
const LAST_VISIT_DATE_KEY = "gnfood_last_visit_date";

async function trackVisit() {
  const url = CONFIG.CLICK_LOG_URL;
  if (!url || url.includes("여기에_배포된_스크립트_ID")) {
    if (els.visitCounter) els.visitCounter.textContent = "방문자 집계 미설정";
    return;
  }

  let visitorId = localStorage.getItem(VISITOR_ID_KEY);
  const isNewVisitor = !visitorId;
  if (isNewVisitor) {
    visitorId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(VISITOR_ID_KEY, visitorId);
  }

  const today = new Date().toISOString().slice(0, 10);
  const isNewToday = localStorage.getItem(LAST_VISIT_DATE_KEY) !== today;
  if (isNewToday) localStorage.setItem(LAST_VISIT_DATE_KEY, today);

  const params = new URLSearchParams({
    type: "visit",
    newVisitor: isNewVisitor ? "1" : "0",
    newToday: isNewToday ? "1" : "0",
  });

  try {
    const res = await fetch(`${url}?${params.toString()}`);
    const data = await res.json();
    if (els.visitCounter && typeof data.total === "number") {
      els.visitCounter.textContent = `오늘 ${data.today.toLocaleString()} · 누적 ${data.total.toLocaleString()}`;
    }
  } catch (err) {
    if (els.visitCounter) els.visitCounter.textContent = "방문자수 로드 완료";
  }
}

// 6. 롤링 배너
function initBannerSlider() {
  const slider = document.getElementById("bannerSlider");
  if (!slider) return;
  const slides = slider.querySelectorAll(".banner-slide");
  const prevBtn = document.getElementById("bannerPrev");
  const nextBtn = document.getElementById("bannerNext");
  const dotsContainer = document.getElementById("bannerDots");

  if (!slides.length) return;

  let currentIndex = 0;
  let timer = null;

  dotsContainer.innerHTML = "";
  slides.forEach((_, idx) => {
    const dot = document.createElement("div");
    dot.className = "banner-dot" + (idx === 0 ? " active" : "");
    dot.addEventListener("click", () => goToSlide(idx));
    dotsContainer.appendChild(dot);
  });

  const dots = dotsContainer.querySelectorAll(".banner-dot");

  function goToSlide(index) {
    currentIndex = index;
    if (currentIndex >= slides.length) currentIndex = 0;
    if (currentIndex < 0) currentIndex = slides.length - 1;

    slider.style.transform = `translateX(-${currentIndex * 100}%)`;

    dots.forEach((dot, idx) => {
      dot.classList.toggle("active", idx === currentIndex);
    });
    
    resetTimer();
  }

  function nextSlide() { goToSlide(currentIndex + 1); }
  function prevSlide() { goToSlide(currentIndex - 1); }

  function startTimer() { timer = setInterval(nextSlide, 4000); }
  function resetTimer() { clearInterval(timer); startTimer(); }

  if (prevBtn) prevBtn.onclick = prevSlide;
  if (nextBtn) nextBtn.onclick = nextSlide;

  startTimer();
}

// 7. 부트스트랩
els.search.addEventListener("input", renderAll);
els.starOnly.addEventListener("change", renderAll);

async function bootstrap() {
  const updatedText = await fetchLastUpdatedDate();
  els.verDate.textContent = updatedText;

  initMap();
  trackVisit();
  initBannerSlider();

  try {
    ALL_ITEMS = await loadSheetData();
  } catch (err) {
    els.mapStatus.textContent = err.message;
    els.emptyState.hidden = false;
    els.emptyState.textContent = "데이터를 불러오지 못했습니다. config.js 및 시트 공유 권한을 확인해주세요.";
    return;
  }

  els.totalCount.textContent = `${ALL_ITEMS.length}곳 수록`;
  renderChips(ALL_ITEMS);
  renderList(ALL_ITEMS);
  resolveCoordinates(ALL_ITEMS);
}

bootstrap();
