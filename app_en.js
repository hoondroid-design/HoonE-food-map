// ============================================================
// What to Eat in Gangneung — app_en.js (English Version)
// ============================================================

const els = {
  map: document.getElementById("map"),
  mapStatus: document.getElementById("mapStatus"),
  list: document.getElementById("list"),
  emptyState: document.getElementById("emptyState"),
  chips: document.getElementById("categoryChips"),
  search: document.getElementById("searchInput"),
  starOnly: document.getElementById("starOnly"),
  reviewOnly: document.getElementById("reviewOnly"),
  totalCount: document.getElementById("totalCount"),
  visitCounter: document.getElementById("visitCounter"),
  detailSheet: document.getElementById("detailSheet"),
  detailBody: document.getElementById("detailBody"),
  detailClose: document.getElementById("detailClose"),
};

let ALL_ITEMS = [];      
let CURRENT_CATEGORY = "All";
let map, places, geocoder;
let markers = {};        
let overlays = {};       
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const COORD_CACHE_KEY = "gnfood_coord_cache_v4_colE";

function loadCoordCache() {
  try { return JSON.parse(localStorage.getItem(COORD_CACHE_KEY)) || {}; }
  catch { return {}; }
}
function saveCoordCache(cache) {
  try { localStorage.setItem(COORD_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

// 1. Fetch Google Sheet CSV (Using English Sheet GID: 1598641787)
function buildSheetUrl() {
  const { SHEET_ID, SHEET_RANGE } = CONFIG;
  const ENGLISH_GID = "1598641787"; // English Sheet GID
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq`;
  const params = new URLSearchParams({
    tqx: "out:csv",
    gid: ENGLISH_GID,
    range: SHEET_RANGE,
  });
  return `${base}?${params.toString()}`;
}

async function loadSheetData() {
  const url = buildSheetUrl();
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load sheet data (HTTP ${res.status}). Check sheet permissions.`);
  }
  const csvText = await res.text();
  const parsed = Papa.parse(csvText.trim(), { skipEmptyLines: false });
  const rows = parsed.data;

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 4) continue;
    
    // 이미지 열 매핑 기준
    // A: Category(En), B: Menu(En), C: Name(Ko), D: Name(En), E: Address(Ko), F: Address(En), G: Pick(Ko), H: Pick(En), I: Visited, J: Review
    const category = (r[0] || "").trim() || "Others";
    const menu = (r[1] || "").trim();
    const nameKo = (r[2] || "").trim();
    const nameEn = (r[3] || "").trim();
    const addressKo = (r[4] || "").trim();
    const addressEn = (r[5] || "").trim();
    const noteEn = (r[7] || "").trim();
    const visited = (r[8] || "").trim() === "O";
    const blog = (r[9] || "").trim();

    // 메인 표시 이름은 영문, 없으면 한글 사용
    const displayName = nameEn || nameKo;
    if (!displayName) continue;

    items.push({
      id: `${displayName}__${addressKo}`,
      starred: false, // 별점 항목이 시트에 없으므로 기본값 false
      category: category,
      menu: menu,
      name: displayName,        // 메인 상호명 (영문)
      nameKo: nameKo,           // 보조 상호명 (한글)
      address: addressEn || addressKo, // 화면 표시용 주소 (영문)
      addressKo: addressKo,     // 지도 검색용 주소 (한글)
      note: noteEn,             // 한줄평 (영문)
      visited: visited,
      blog: blog,
      lat: null,
      lng: null,
    });
  }
  return items;
}

// 2. Kakao Geocoding & Search
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
    if (it.addressKo) {
      coord = await geocodeAddressOnce(it.addressKo);
    }
    if (!coord) {
      coord = await keywordSearchOnce(`강릉 ${it.addressKo} ${it.nameKo}`.trim())
        || await keywordSearchOnce(`강릉 ${it.nameKo}`);
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
  if (!els.mapStatus) return;
  const failed = total - resolved;
  els.mapStatus.textContent = loading
    ? `Locating spots… (${resolved}/${total})`
    : `${resolved} spots mapped ${failed > 0 ? `(${failed} unmapped)` : ''}`;
}

// 3. Map & Marker Controls
function initMap() {
  if (!els.map) return;
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

// 4. List & Categories
function renderChips(items) {
  if (!els.chips) return;
  const cats = ["All", ...Array.from(new Set(items.map((i) => i.category)))];
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
  const q = els.search ? els.search.value.trim().toLowerCase() : "";
  const matchesQuery =
    !q ||
    item.name.toLowerCase().includes(q) ||
    item.menu.toLowerCase().includes(q) ||
    item.address.toLowerCase().includes(q) ||
    item.note.toLowerCase().includes(q);
  const matchesCategory = CURRENT_CATEGORY === "All" || item.category === CURRENT_CATEGORY;
  const matchesStar = !els.starOnly || !els.starOnly.checked || item.starred;
  const matchesReview = !els.reviewOnly || !els.reviewOnly.checked || !!(item.blog && item.blog.trim());

  return matchesQuery && matchesCategory && matchesStar && matchesReview;
}

function renderList(items) {
  if (!els.list) return;
  const visible = items.filter(isItemVisible);
  els.list.innerHTML = "";
  if (els.emptyState) els.emptyState.hidden = visible.length > 0;

  visible.forEach((item, idx) => {
    const li = document.createElement("li");
    li.className = "list-item";
    
    const reviewBadge = item.blog ? `<span class="review-badge" title="Has Review">N</span>` : "";

    li.innerHTML = `
      <span class="idx">no.${String(idx + 1).padStart(3, "0")}</span>
      <div class="body">
        <div class="row1">
          <!-- 영문 상호명 메인 표시 + 한글 상호명 보조 표시 -->
          <span class="name">${escapeHtml(item.name)} <small style="font-weight:normal; font-size:13px; color:#888;">(${escapeHtml(item.nameKo)})</small></span>
          <span class="tag">${escapeHtml(item.category)}</span>
          ${reviewBadge}
        </div>
        <div class="menu">${escapeHtml(item.menu)}</div>
        <div class="loc">${escapeHtml(item.address)}</div>
      </div>
      <div class="arrow-btn" aria-label="Details">›</div>
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

// 상세페이지 팝업 렌더링 부분
function openDetail(item) {
  if (!els.detailBody || !els.detailSheet) return;
  els.detailBody.innerHTML = `
    <div class="detail-eyebrow">${escapeHtml(item.category)} · ${escapeHtml(item.menu)}</div>
    <div class="detail-title">${escapeHtml(item.name)} <span style="font-size:16px; color:#666; font-weight:normal;">(${escapeHtml(item.nameKo)})</span></div>
    <div class="detail-row detail-row--address">
      <span><b>Address</b> · ${escapeHtml(item.address)}</span>
      ${item.addressKo ? `<button type="button" class="copy-btn" id="copyAddressBtn">📋 Copy Korean Address</button>` : ""}
    </div>
    <div class="detail-row"><b>Visited</b> · ${item.visited ? "Visited in Person" : "Not Visited / Word of Mouth"}</div>
    ${item.note ? `
      <div class="detail-note">
        <div class="detail-note-label">🙋🏻 Owner's Review</div>
        ${escapeHtml(item.note)}
      </div>` : ""}
    <div class="detail-actions">
      <button type="button" class="detail-link detail-link--alt" id="shareDetailBtn">🔗 Share This Place</button>
      ${item.blog ? `<a class="detail-link detail-link--naver" href="${item.blog}" target="_blank" rel="noopener">Read Full Review →</a>` : ""}
      ${buildDirectionLinks(item)}
    </div>
  `;
  els.detailSheet.hidden = false;

  // 주소 복사 버튼 누르면 카카오 택시나 내비에 치기 좋게 '한글 주소'가 복사되도록 설정
  const copyBtn = document.getElementById("copyAddressBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      copyToClipboard(item.addressKo)
        .then(() => {
          copyBtn.textContent = "✅ Copied (Korean)";
          copyBtn.classList.add("copy-btn--done");
          setTimeout(() => {
            copyBtn.textContent = "📋 Copy Korean Address";
            copyBtn.classList.remove("copy-btn--done");
          }, 1500);
        });
    });
  }
}

  const shareDetailBtn = document.getElementById("shareDetailBtn");
  if (shareDetailBtn) {
    shareDetailBtn.addEventListener("click", () => {
      executeShare(
        `[What to Eat in Gangneung] ${item.name}`,
        `${item.name} (${item.category}) - ${item.menu}\nAddress: ${item.address}`,
        window.location.href,
        item.name
      );
    });
  }

  logClick(item.name);
}

if (els.detailClose) {
  els.detailClose.addEventListener("click", () => {
    if (els.detailSheet) els.detailSheet.hidden = true;
  });
}

function logClick(restaurantName) {
  const url = CONFIG.CLICK_LOG_URL;
  if (!url || !restaurantName) return;
  
  const query = new URLSearchParams({
    type: "click",
    name: restaurantName
  }).toString();
  
  fetch(`${url}?${query}`, { mode: "no-cors" }).catch(() => {});
}

function logShare(targetName = "EntireSite") {
  const url = CONFIG.CLICK_LOG_URL;
  if (!url) return;
  
  const params = new URLSearchParams({
    type: "share",
    target: targetName
  }).toString();
  
  fetch(`${url}?${params}`, { mode: "no-cors" }).catch(() => {});
}

function executeShare(title, text, url, targetName) {
  if (navigator.share) {
    navigator.share({
      title: title,
      text: text,
      url: url,
    }).then(() => {
      logShare(targetName);
    }).catch(() => {});
  } else {
    copyToClipboard(url).then(() => {
      alert("Link copied to clipboard! Share it anywhere you like.");
      logShare(targetName);
    });
  }
}

const VISITOR_ID_KEY = "gnfood_visitor_id";
const LAST_VISIT_DATE_KEY = "gnfood_last_visit_date";

async function trackVisit() {
  const url = CONFIG.CLICK_LOG_URL;
  if (!url) return;

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

  fetch(`${url}?${params.toString()}`, { mode: "no-cors" }).catch(() => {});
}

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

  if (dotsContainer) {
    dotsContainer.innerHTML = "";
    slides.forEach((_, idx) => {
      const dot = document.createElement("div");
      dot.className = "banner-dot" + (idx === 0 ? " active" : "");
      dot.addEventListener("click", () => goToSlide(idx));
      dotsContainer.appendChild(dot);
    });
  }

  const dots = dotsContainer ? dotsContainer.querySelectorAll(".banner-dot") : [];

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

if (els.search) els.search.addEventListener("input", renderAll);
if (els.starOnly) els.starOnly.addEventListener("change", renderAll);
if (els.reviewOnly) els.reviewOnly.addEventListener("change", renderAll);

const mainShareBtn = document.getElementById("mainShareBtn");
if (mainShareBtn) {
  mainShareBtn.addEventListener("click", () => {
    executeShare(
      "What to Eat in Gangneung — Local Food Map",
      "Discover authentic local favorites instead of tourist traps!",
      window.location.href,
      "EntireSite"
    );
  });
}

async function bootstrap() {
  initMap();
  trackVisit();
  initBannerSlider();

  try {
    ALL_ITEMS = await loadSheetData();
  } catch (err) {
    if (els.mapStatus) els.mapStatus.textContent = err.message;
    if (els.emptyState) {
      els.emptyState.hidden = false;
      els.emptyState.textContent = "Failed to load data. Please check connection and sheet permissions.";
    }
    return;
  }

  if (els.totalCount) els.totalCount.textContent = `${ALL_ITEMS.length} Spots`;
  renderChips(ALL_ITEMS);
  renderList(ALL_ITEMS);
  resolveCoordinates(ALL_ITEMS);
}

bootstrap();

document.addEventListener("DOMContentLoaded", () => {
  const introText = document.getElementById("introText");
  if (introText) {
    introText.classList.add("clamp");
  }
});

function toggleIntro() {
  const introText = document.getElementById("introText");
  const moreBtn = document.getElementById("moreBtn");

  if (!introText || !moreBtn) return;

  if (introText.classList.contains("clamp")) {
    introText.classList.remove("clamp");
    moreBtn.textContent = "Collapse";
  } else {
    introText.classList.add("clamp");
    moreBtn.textContent = "...Read More";
  }
}
