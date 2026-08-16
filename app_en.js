// ============================================================
// What to Eat in Gangneung — app_en.js (Safe Error-Free Version)
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
  const ENGLISH_GID = "1598641787";
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
    throw new Error(`Failed to load sheet data (HTTP ${res.status}).`);
  }
  const csvText = await res.text();
  const parsed = Papa.parse(csvText.trim(), { skipEmptyLines: false });
  const rows = parsed.data || [];

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !Array.isArray(r) || r.length < 5) continue;
    
    // Safety guard against undefined values
    const category = String(r[0] || "").trim() || "Others";
    const menu = String(r[1] || "").trim();
    const nameKo = String(r[2] || "").trim();
    const nameEn = String(r[3] || "").trim();
    const addressKo = String(r[4] || "").trim();
    const addressEn = String(r[5] || "").trim();
    const noteEn = String(r[7] || "").trim();
    const visited = String(r[8] || "").trim() === "O";
    const blog = String(r[9] || "").trim();

    const displayName = nameEn || nameKo;
    if (!displayName) continue;

    items.push({
      id: `${displayName}__${addressKo}`,
      starred: false,
      category: category,       // B열 영문 카테고리
      menu: menu,               // C열 영문 대표메뉴
      name: displayName,        // E열 영문 상호명 (메인)
      nameKo: nameKo,           // D열 한글 상호명 (보조)
      address: addressEn || addressKo, // G열 영문 주소
      addressKo: addressKo,     // F열 한글 주소 (지도용)
      note: noteEn,             // I열 영문 한줄평
      visited: visited,         // J열 방문 여부
      blog: blog,               // K열 리뷰 링크
      lat: null,
      lng: null,
    });
  }
  return items;
}

// 2. Geocoding
function geocodeAddressOnce(address) {
  return new Promise((resolve) => {
    if (!geocoder || !address) return resolve(null);
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
    if (!places || !query) return resolve(null);
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
    if (!coord && it.nameKo) {
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
  if (!els.map || typeof kakao === "undefined" || !kakao.maps) return;
  map = new kakao.maps.Map(els.map, {
    center: new kakao.maps.LatLng(CONFIG.MAP_CENTER.lat, CONFIG.MAP_CENTER.lng),
    level: CONFIG.MAP_LEVEL,
  });
  places = new kakao.maps.services.Places();
  geocoder = new kakao.maps.services.Geocoder();
}

function addOrUpdateMarker(item) {
  if (!map || !item.lat || !item.lng || markers[item.id]) return;
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

// 4. Category Chips & List
function renderChips(items) {
  if (!els.chips) return;
  const rawCats = items.map((i) => i.category).filter(Boolean);
  const cats = ["All", ...Array.from(new Set(rawCats))];
  
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
    item.nameKo.toLowerCase().includes(q) ||
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
          <span class="name">${escapeHtml(item.name)} <small style="font-weight:normal; font-size:12px; color:#888;">(${escapeHtml(item.nameKo)})</small></span>
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
      if (map && item.lat && item.lng) {
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
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// 5. Detail Sheet
function buildDirectionLinks(item) {
  if (!item.lat || !item.lng) return "";
  const kakaoUrl = `https://map.kakao.com/link/to/${encodeURIComponent(item.nameKo || item.name)},${item.lat},${item.lng}`;
  const tmapUrl = `tmap://route?goalname=${encodeURIComponent(item.nameKo || item.name)}&goalx=${item.lng}&goaly=${item.lat}`;
  
  let html = `<a class="detail-link" href="${kakaoUrl}" target="_blank" rel="noopener">🚗 Kakao Map Route</a>`;
  if (IS_MOBILE) {
    html += `<a class="detail-link detail-link--alt" href="${tmapUrl}">🚕 TMAP Route</a>`;
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

if (els.detailClose) {
  els.detailClose.addEventListener("click", () => {
    if (els.detailSheet) els.detailSheet.hidden = true;
  });
}

// 6. Initialization
if (els.search) els.search.addEventListener("input", renderAll);
if (els.starOnly) els.starOnly.addEventListener("change", renderAll);
if (els.reviewOnly) els.reviewOnly.addEventListener("change", renderAll);

async function bootstrap() {
  initMap();

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
