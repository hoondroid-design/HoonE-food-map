// ============================================================
// What to Eat in Gangneung — app_en.js (Fixed Column Direct Mapping)
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

// 1. Fetch Google Sheet Data (A~K Direct Column Access)
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
  const parsed = Papa.parse(csvText.trim(), { skipEmptyLines: true });
  const rows = parsed.data || [];

  if (rows.length < 2) return [];

  const items = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !Array.isArray(r) || r.length < 3) continue;

    // 헤더 행 스킵
    const firstCell = String(r[0] || "").toLowerCase();
    const secondCell = String(r[1] || "").toLowerCase();
    const thirdCell = String(r[2] || "").toLowerCase();
    if (firstCell.includes("구분") || secondCell.includes("category") || thirdCell.includes("featured menu")) {
      continue;
    }

    // 배열 내 데이터 안전 추출 함수
    const val = (idx) => (r[idx] !== undefined && r[idx] !== null) ? String(r[idx]).trim() : "";

    /* 구글 시트 알파벳 열 1:1 고정 매핑
       ----------------------------------
       A열 (r[0]) : 별점 (Star)
       B열 (r[1]) : 구분 (Category - En)
       C열 (r[2]) : Featured Menu (En)
       D열 (r[3]) : Name (Ko)
       E열 (r[4]) : Name (En)
       F열 (r[5]) : Address (Ko)
       G열 (r[6]) : Address (En)
       H열 (r[7]) : Owner's Pick (Ko)
       I열 (r[8]) : Owner's Pick (En) - 영문 한줄리뷰!
       J열 (r[9]) : Visited in Person - 방문 여부 O!
       K열 (r[10]): Owner's Review - 블로그 링크
    */

    const starVal = val(0);
    const category = val(1) || "Others";
    const menu = val(2);
    const nameKo = val(3);
    const nameEn = val(4);
    const addressKo = val(5);
    const addressEn = val(6);
    
    // ★ I열 (r[8]) = 영문 한줄 리뷰
    const noteEn = val(8);
    
    // ★ J열 (r[9]) = 방문 여부 ('O', 'o', '0', 'Yes' 감지)
    const visitedRaw = val(9).toUpperCase();
    const visited = (visitedRaw === "O" || visitedRaw === "0" || visitedRaw.includes("YES"));
    
    // K열 (r[10]) = 블로그 후기 링크
    const blog = val(10);

    const displayName = nameEn || nameKo;
    if (!displayName) continue;

    items.push({
      id: `${displayName}__${addressKo}`,
      starred: !!starVal,
      category: category,
      menu: menu,
      name: displayName,
      nameKo: nameKo,
      address: addressEn || addressKo,
      addressKo: addressKo,
      note: noteEn,             // I열 매핑
      visited: visited,         // J열 매핑
      blog: blog,
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

// 3. Map Controls
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

// 4. Category Chips & List Render
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
    const starBadge = item.starred ? `<span class="star-badge">★</span>` : "";

    li.innerHTML = `
      <span class="idx">no.${String(idx + 1).padStart(3, "0")}</span>
      <div class="body">
        <div class="row1">
          <span class="name">${escapeHtml(item.name)} <small style="font-weight:normal; font-size:12px; color:#888;">(${escapeHtml(item.nameKo)})</small></span>
          <span class="tag">${escapeHtml(item.category)}</span>
          ${starBadge}
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

// 5. Utility & Sharing
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

function executeShare(title, text, url) {
  if (navigator.share) {
    navigator.share({
      title: title,
      text: text,
      url: url,
    }).catch(() => {});
  } else {
    copyToClipboard(url).then(() => {
      alert("Link copied to clipboard! Share it anywhere you like.");
    });
  }
}

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

// 6. Detail Sheet Modal (I열 & J열 반영)
function openDetail(item) {
  if (!els.detailBody || !els.detailSheet) return;
  els.detailBody.innerHTML = `
    <div class="detail-eyebrow">${escapeHtml(item.category)} · ${escapeHtml(item.menu)}</div>
    <div class="detail-title">${item.starred ? "★ " : ""}${escapeHtml(item.name)} <span style="font-size:16px; color:#666; font-weight:normal;">(${escapeHtml(item.nameKo)})</span></div>
    <div class="detail-row detail-row--address">
      <span><b>Address</b> · ${escapeHtml(item.address)}</span>
      ${item.addressKo ? `<button type="button" class="copy-btn" id="copyAddressBtn">📋 Copy Korean Address</button>` : ""}
    </div>
    <div class="detail-row"><b>Visited</b> · ${item.visited ? "Visited in Person" : "Not Visited Yet"}</div>
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

  const shareDetailBtn = document.getElementById("shareDetailBtn");
  if (shareDetailBtn) {
    shareDetailBtn.addEventListener("click", () => {
      executeShare(
        `[What to Eat in Gangneung] ${item.name}`,
        `${item.name} (${item.category}) - ${item.menu}\nAddress: ${item.address}`,
        window.location.href
      );
    });
  }
}

if (els.detailClose) {
  els.detailClose.addEventListener("click", () => {
    if (els.detailSheet) els.detailSheet.hidden = true;
  });
}

// 7. Event Listeners & Bootstrap
if (els.search) els.search.addEventListener("input", renderAll);
if (els.starOnly) els.starOnly.addEventListener("change", renderAll);
if (els.reviewOnly) els.reviewOnly.addEventListener("change", renderAll);

const mainShareBtn = document.getElementById("mainShareBtn");
if (mainShareBtn) {
  mainShareBtn.addEventListener("click", () => {
    executeShare(
      "What to Eat in Gangneung — Local Food Map",
      "Discover authentic local favorites instead of tourist traps!",
      window.location.href
    );
  });
}

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
