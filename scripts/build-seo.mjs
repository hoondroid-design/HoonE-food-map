#!/usr/bin/env node
// ============================================================
// 강릉 뭐먹지 — 검색엔진용 정적 페이지 생성기
//
// 구글 시트(config.js와 같은 시트)를 읽어서 아래 파일을 만듭니다.
//   /place/<식당>/index.html     맛집별 상세 페이지
//   /area/<동네>/index.html      지역별 모음 페이지
//   /category/<구분>/index.html  종류별 모음 페이지
//   /data/places.json            app.js가 쓰는 식당 ↔ 페이지 주소 목록
//   /sitemap.xml, /robots.txt
//   index.html 안의 <!-- SEO:... --> 표시 사이 (전체 목록, 구조화 데이터)
//
// 실행:  node scripts/build-seo.mjs
// 로컬 테스트:  node scripts/build-seo.mjs --csv 파일.csv
// 의존성 없음 (Node 18 이상)
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------- 사이트 설정 ----------
const SITE = {
  origin: "https://www.gangneungmatzip.com",
  name: "강릉 뭐먹지",
  author: "HoonE",
  ogImage: "https://www.gangneungmatzip.com/thumbnail.png",
  kakaoJsKey: "0470fb23303f174ae3f6cc6b82426f77",
  gaId: "G-GLHEB5P95Z",
  adsenseClient: "ca-pub-4761567002853346",
};

// 지번 주소의 '리'를 상위 읍/면으로 묶을 때 사용
const RI_TO_EUP = {
  주문리: "주문진읍", 교항리: "주문진읍", 향호리: "주문진읍", 장덕리: "주문진읍",
  삼교리: "주문진읍", 향호동: "주문진읍",
};

// 지역 허브 페이지 소개 문구 (없으면 기본 문구 사용)
const AREA_INTRO = {
  교동: "강릉역과 교동택지가 있는 강릉 시내 중심. 술집·고깃집·횟집이 몰려 있어 저녁 약속 잡기 좋은 동네.",
  포남동: "강릉 시내 동쪽 생활권. 관광객보다 동네 사람들이 오래 다닌 식당이 많은 곳.",
  옥천동: "강릉역에서 중앙시장 가는 길목. 오래된 분식·만두집과 시내 식당이 섞여 있다.",
  성남동: "강릉중앙시장이 있는 구도심. 시장 먹거리와 오래된 노포가 모여 있다.",
  임당동: "중앙시장 바로 옆 구도심. 시내에서 오래 버틴 식당들이 있는 동네.",
  명주동: "강릉 구도심 골목. 옛 건물을 고친 카페와 조용한 식당이 많다.",
  초당동: "초당순두부마을이 있는 곳. 경포호와 가까워 순두부·카페 들르기 좋은 동네.",
  견소동: "안목해변 커피거리가 있는 곳. 바다 보이는 카페가 줄지어 있다.",
  송정동: "송정해변·안목해변 사이 솔밭 동네. 해변 산책 전후로 들르기 좋다.",
  강문동: "경포해변과 강문해변 사이. 바다 쪽 식당과 카페가 많다.",
  안현동: "경포해변 북쪽. 바다 근처 식당과 횟집이 있는 동네.",
  주문진읍: "주문진항과 수산시장이 있는 강릉 북쪽 항구 마을. 대게·회 먹으러 가는 곳.",
  강동면: "정동진·안인 쪽 바닷가 마을. 갓 잡은 생선으로 하는 식당이 많다.",
  사천면: "사천진해변이 있는 강릉 북쪽 바닷가. 물회와 바다 보는 카페가 많다.",
};

const CATEGORY_SCHEMA = {
  "카페/커피": "CafeOrCoffeeShop",
  베이커리: "Bakery",
  술집: "BarOrPub",
};

// ---------- 유틸 ----------
const esc = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const slugify = (s) =>
  String(s).normalize("NFC").trim()
    .replace(/[\/\\]+/g, "-")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "place";

// 페이지 링크 / 전체 URL (한글은 퍼센트 인코딩)
const hrefOf = (kind, slug) => `/${kind}/${encodeURIComponent(slug)}/`;
const urlOf = (kind, slug) => SITE.origin + hrefOf(kind, slug);

const cut = (s, n) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};

const todayKST = () => {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
};

const jsonLd = (obj) =>
  `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2).replace(/</g, "\\u003c")}\n</script>`;

// ---------- CSV ----------
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function readConfig() {
  const src = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
  const pick = (k) => (src.match(new RegExp(`${k}\\s*:\\s*"([^"]*)"`)) || [])[1];
  return { SHEET_ID: pick("SHEET_ID"), SHEET_NAME: pick("SHEET_NAME"), SHEET_RANGE: pick("SHEET_RANGE") };
}

async function loadCSV() {
  const i = process.argv.indexOf("--csv");
  if (i > -1) return fs.readFileSync(process.argv[i + 1], "utf8");
  const { SHEET_ID, SHEET_NAME, SHEET_RANGE } = readConfig();
  const params = new URLSearchParams({ tqx: "out:csv", sheet: SHEET_NAME, range: SHEET_RANGE });
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`시트를 불러오지 못했습니다 (HTTP ${res.status})`);
  const text = await res.text();
  if (/<html/i.test(text.slice(0, 200))) throw new Error("시트가 '링크가 있는 모든 사용자 보기'로 공유되어 있는지 확인하세요.");
  return text;
}

// ---------- 데이터 ----------
function areaOf(address) {
  const m = address.match(/강릉시\s+(\S+?(?:동|읍|면|리))(?=\s|$|\d)/);
  if (!m) return "";
  const a = m[1];
  return RI_TO_EUP[a] || a;
}

function toItems(rows) {
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 4) continue;
    const [star, category, menu, name, address, note, visited, blog] = r.map((v) => (v || "").trim());
    if (!name) continue;
    items.push({
      id: `${name}__${address}`,               // app.js와 같은 규칙
      starred: !!star,
      category: category || "기타",
      menu, name, address, note,
      visited: visited === "O",
      blog: /^https?:\/\//.test(blog) ? blog : "",
      area: areaOf(address),
    });
  }
  // 슬러그 (같은 이름이면 동네/번호를 붙여 구분)
  const used = new Map();
  for (const it of items) {
    let s = slugify(it.name);
    if (used.has(s)) s = it.area ? `${s}-${slugify(it.area)}` : s;
    let n = 2, base = s;
    while (used.has(s)) s = `${base}-${n++}`;
    used.set(s, true);
    it.slug = s;
  }
  return items;
}

const groupBy = (items, key) => {
  const m = new Map();
  for (const it of items) {
    const k = it[key];
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
};

const sortItems = (arr) => [...arr].sort((a, b) =>
  (b.starred - a.starred) || (!!b.blog - !!a.blog) || a.name.localeCompare(b.name, "ko"));

// ---------- 공통 레이아웃 ----------
function layout({ title, description, canonical, body, ld = [], ogType = "website" }) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(canonical)}" />
<meta property="og:type" content="${ogType}" />
<meta property="og:site_name" content="${esc(SITE.name)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${esc(SITE.ogImage)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:locale" content="ko_KR" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="google-adsense-account" content="${SITE.adsenseClient}">
<link rel="icon" type="image/png" href="/그림1.png" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css" />
<link rel="stylesheet" href="/seo.css" />
<script async src="https://www.googletagmanager.com/gtag/js?id=${SITE.gaId}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${SITE.gaId}');</script>
${ld.map(jsonLd).join("\n")}
</head>
<body>
<header class="s-top">
  <a class="s-brand" href="/">강릉 뭐먹지<span>현지인 출신의 로컬 맛집 지도</span></a>
  <a class="s-mapbtn" href="/">🗺️ 지도로 보기</a>
</header>
<main class="s-wrap">
${body}
</main>
<footer class="s-foot">
  <p>맛 평가는 주관적입니다. 폐업·영업시간 변동이 있을 수 있으니 방문 전 네이버·카카오에서 한 번 더 확인하세요.</p>
  <p>Copyright © 2017–${new Date().getFullYear()} ${esc(SITE.author)} · ${esc(SITE.name)}. 리뷰와 글의 무단 복제·재배포를 금지합니다.</p>
  <p class="s-orig">원본 사이트: <a href="${SITE.origin}/">${SITE.origin.replace("https://", "")}</a></p>
</footer>
</body>
</html>
`;
}

const breadcrumbLd = (trail) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: trail.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, name, item: url })),
});

const crumbsHtml = (trail) =>
  `<nav class="s-crumbs" aria-label="경로">${trail
    .map(([name, url], i) => (i < trail.length - 1 ? `<a href="${esc(url.replace(SITE.origin, ""))}">${esc(name)}</a>` : `<span>${esc(name)}</span>`))
    .join(" › ")}</nav>`;

function card(it) {
  return `<li class="s-card">
  <a href="${hrefOf("place", it.slug)}">
    <div class="s-card-top"><b>${it.starred ? "★ " : ""}${esc(it.name)}</b><span class="s-tag">${esc(it.category)}</span>${it.blog ? '<span class="s-n">후기</span>' : ""}</div>
    <div class="s-card-menu">${esc(it.menu)}${it.area ? ` · ${esc(it.area)}` : ""}</div>
    ${it.note ? `<p>${esc(cut(it.note, 90))}</p>` : ""}
  </a>
</li>`;
}

// ---------- 맛집 상세 ----------
function placePage(it, all, byArea, byCat, updated) {
  const url = urlOf("place", it.slug);
  const areaTxt = it.area ? `강릉 ${it.area}` : "강릉";
  const title = `${it.name} – ${areaTxt} ${it.menu || it.category} 현지인 후기 | ${SITE.name}`;
  const description = cut(`${it.starred ? "[주인장 강추] " : ""}${it.name}(${it.category}${it.menu ? ", " + it.menu : ""}) · ${it.address}. ${it.note}`, 155);

  const trail = [
    ["홈", SITE.origin + "/"],
    ...(it.area ? [[`${it.area} 맛집`, urlOf("area", slugify(it.area))]] : []),
    [it.name, url],
  ];

  const sameArea = sortItems((byArea.get(it.area) || []).filter((x) => x !== it)).slice(0, 6);
  const sameCat = sortItems((byCat.get(it.category) || []).filter((x) => x !== it && !sameArea.includes(x))).slice(0, 6);

  const q = encodeURIComponent(`${it.name} ${it.address}`);
  const ld = {
    "@context": "https://schema.org",
    "@type": CATEGORY_SCHEMA[it.category] || "Restaurant",
    name: it.name,
    url,
    image: SITE.ogImage,
    ...(it.menu ? { servesCuisine: it.menu } : {}),
    address: {
      "@type": "PostalAddress",
      streetAddress: it.address.replace(/^강원(특별자치도)?\s*강릉시\s*/, ""),
      addressLocality: "강릉시",
      addressRegion: "강원특별자치도",
      addressCountry: "KR",
    },
    ...(it.note ? {
      review: {
        "@type": "Review",
        author: { "@type": "Person", name: SITE.author },
        reviewBody: it.note,
        publisher: { "@type": "Organization", name: SITE.name },
      },
    } : {}),
  };

  const body = `
${crumbsHtml(trail)}
<article class="s-place">
  <div class="s-eyebrow">${esc(it.category)}${it.menu ? ` · ${esc(it.menu)}` : ""}${it.area ? ` · ${esc(it.area)}` : ""}</div>
  <h1>${esc(it.name)}</h1>
  <div class="s-badges">
    ${it.starred ? '<span class="s-badge s-badge--star">★ 주인장 강추</span>' : ""}
    <span class="s-badge">${it.visited ? "✔ 직접 방문" : "미방문 · 전해 들은 곳"}</span>
    ${it.blog ? '<span class="s-badge s-badge--n">N 후기 있음</span>' : ""}
  </div>

  ${it.note ? `<section class="s-review">
    <h2>🙋🏻 주인장 한 줄 평</h2>
    <p>${esc(it.note)}</p>
    <div class="s-by">— ${esc(SITE.author)}, 강릉에서 25년 넘게 산 현지인 출신</div>
  </section>` : ""}

  <section class="s-info">
    <h2>위치 · 찾아가기</h2>
    <dl>
      <dt>주소</dt><dd>${esc(it.address)}</dd>
      ${it.menu ? `<dt>주요 메뉴</dt><dd>${esc(it.menu)}</dd>` : ""}
      <dt>구분</dt><dd><a href="${hrefOf("category", slugify(it.category))}">${esc(it.category)}</a></dd>
      ${it.area ? `<dt>동네</dt><dd><a href="${hrefOf("area", slugify(it.area))}">${esc(it.area)}</a></dd>` : ""}
    </dl>
    <div id="s-map" class="s-map" data-address="${esc(it.address)}" data-name="${esc(it.name)}"></div>
    <div class="s-actions">
      <a class="s-btn" href="https://map.kakao.com/?q=${q}" target="_blank" rel="noopener">카카오맵에서 보기</a>
      <a class="s-btn" href="https://map.naver.com/p/search/${q}" target="_blank" rel="noopener">네이버지도에서 보기</a>
      ${it.blog ? `<a class="s-btn s-btn--n" href="${esc(it.blog)}" target="_blank" rel="noopener">주인장 상세 후기 →</a>` : ""}
      <a class="s-btn s-btn--main" href="/?place=${encodeURIComponent(it.slug)}">🗺️ 강릉 맛집 지도에서 보기</a>
    </div>
    <p class="s-note">영업시간·휴무일은 자주 바뀝니다. 방문 전 지도 앱에서 꼭 확인하세요. (목록 갱신: ${updated})</p>
  </section>

  ${sameArea.length ? `<section class="s-more">
    <h2>${esc(it.area)} 근처 다른 맛집</h2>
    <ul class="s-cards">${sameArea.map(card).join("")}</ul>
    <a class="s-all" href="${hrefOf("area", slugify(it.area))}">${esc(it.area)} 맛집 전체 보기 →</a>
  </section>` : ""}

  ${sameCat.length ? `<section class="s-more">
    <h2>강릉 ${esc(it.category)} 더 보기</h2>
    <ul class="s-cards">${sameCat.map(card).join("")}</ul>
    <a class="s-all" href="${hrefOf("category", slugify(it.category))}">강릉 ${esc(it.category)} 전체 보기 →</a>
  </section>` : ""}
</article>

<script src="//dapi.kakao.com/v2/maps/sdk.js?appkey=${SITE.kakaoJsKey}&libraries=services&autoload=false"></script>
<script>
(function(){
  var el=document.getElementById("s-map");
  if(!el||!window.kakao||!kakao.maps){if(el)el.remove();return;}
  kakao.maps.load(function(){
    var addr=el.dataset.address,name=el.dataset.name;
    function draw(y,x){
      var pos=new kakao.maps.LatLng(y,x);
      var map=new kakao.maps.Map(el,{center:pos,level:4});
      new kakao.maps.Marker({position:pos,map:map});
    }
    new kakao.maps.services.Geocoder().addressSearch(addr,function(r,s){
      if(s===kakao.maps.services.Status.OK&&r.length){draw(r[0].y,r[0].x);return;}
      new kakao.maps.services.Places().keywordSearch("강릉 "+name,function(p,s2){
        if(s2===kakao.maps.services.Status.OK&&p.length)draw(p[0].y,p[0].x);else el.remove();
      });
    });
  });
})();
</script>`;

  return layout({ title, description, canonical: url, body, ld: [ld, breadcrumbLd(trail)], ogType: "article" });
}

// ---------- 모음(허브) 페이지 ----------
function hubPage({ kind, label, h1, intro, items, all, updated, otherLinks }) {
  const slug = slugify(label);
  const url = urlOf(kind, slug);
  const sorted = sortItems(items);
  const starred = sorted.filter((x) => x.starred).length;
  const title = `${h1} ${sorted.length}곳 – 현지인 추천 리스트 | ${SITE.name}`;
  const description = cut(`${intro} ${sorted.slice(0, 5).map((x) => x.name).join(", ")} 등 ${sorted.length}곳. 강릉 현지인 출신이 직접 고른 로컬 맛집.`, 155);
  const trail = [["홈", SITE.origin + "/"], [h1, url]];

  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: h1,
    url,
    numberOfItems: sorted.length,
    itemListElement: sorted.map((it, i) => ({ "@type": "ListItem", position: i + 1, url: urlOf("place", it.slug), name: it.name })),
  };

  const body = `
${crumbsHtml(trail)}
<section class="s-hub">
  <h1>${esc(h1)}</h1>
  <p class="s-lead">${esc(intro)}</p>
  <p class="s-meta">${sorted.length}곳 수록${starred ? ` · 주인장 강추 ${starred}곳` : ""} · 목록 갱신 ${updated}</p>
  <ul class="s-cards">${sorted.map(card).join("")}</ul>
</section>
<section class="s-more">
  <h2>${kind === "area" ? "다른 동네 맛집" : "다른 종류 맛집"}</h2>
  <div class="s-chips">${otherLinks}</div>
  <a class="s-btn s-btn--main" href="/">🗺️ 전체 맛집 지도에서 보기</a>
</section>`;
  return layout({ title, description, canonical: url, body, ld: [ld, breadcrumbLd(trail)] });
}

// ---------- index.html 갱신 ----------
function replaceBetween(html, key, content) {
  const re = new RegExp(`(<!-- SEO:${key}:START -->)[\\s\\S]*?(<!-- SEO:${key}:END -->)`);
  if (!re.test(html)) {
    console.warn(`  ! index.html에 <!-- SEO:${key}:START/END --> 표시가 없어 건너뜀`);
    return html;
  }
  return html.replace(re, `$1\n${content}\n$2`);
}

function updateIndex(items, byArea, byCat, updated) {
  const file = path.join(ROOT, "index.html");
  let html = fs.readFileSync(file, "utf8");

  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "강릉 현지인 추천 로컬 맛집 지도",
    description: "강릉 현지인 출신이 직접 고른 로컬 맛집·카페·술집 리스트",
    url: SITE.origin + "/",
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, url: urlOf("place", it.slug), name: it.name })),
  };
  const site = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.name,
    alternateName: ["강릉 맛집 지도", "강릉뭐먹지"],
    url: SITE.origin + "/",
    author: { "@type": "Person", name: SITE.author },
    inLanguage: "ko-KR",
  };
  html = replaceBetween(html, "JSONLD", `${jsonLd(site)}\n${jsonLd(ld)}`);

  const areaLinks = [...byArea.entries()].sort((a, b) => b[1].length - a[1].length)
    .map(([a, arr]) => `<a href="${hrefOf("area", slugify(a))}">${esc(a)} <small>${arr.length}</small></a>`).join("");
  const catLinks = [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)
    .map(([c, arr]) => `<a href="${hrefOf("category", slugify(c))}">${esc(c)} <small>${arr.length}</small></a>`).join("");
  const rows = sortItems(items).map((it) =>
    `<li><a href="${hrefOf("place", it.slug)}">${it.starred ? "★ " : ""}${esc(it.name)}</a> <span>${esc(it.category)}${it.menu ? " · " + esc(it.menu) : ""}${it.area ? " · " + esc(it.area) : ""}</span></li>`).join("\n");

  html = replaceBetween(html, "DIRECTORY", `<section class="seo-directory" aria-label="강릉 맛집 전체 목록">
  <h2>동네별 강릉 맛집</h2>
  <div class="seo-chips">${areaLinks}</div>
  <h2>종류별 강릉 맛집</h2>
  <div class="seo-chips">${catLinks}</div>
  <details class="seo-all">
    <summary>강릉 맛집 전체 목록 ${items.length}곳 펼치기</summary>
    <ul>${rows}</ul>
  </details>
  <p class="seo-updated">목록 갱신: ${updated}</p>
</section>`);

  html = html.replace(/<span id="totalCount" class="meta-pill">[^<]*<\/span>/,
    `<span id="totalCount" class="meta-pill">${items.length}곳 수록</span>`);

  fs.writeFileSync(file, html);
}

// ---------- 실행 ----------
function writeFile(rel, content) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

async function main() {
  const items = toItems(parseCSV((await loadCSV()).replace(/^\uFEFF/, "")));
  if (items.length < 5) throw new Error(`맛집이 ${items.length}곳뿐이라 중단합니다. 시트 범위/공유 설정을 확인하세요.`);

  // 시트 내용이 바뀐 날만 '갱신일'을 바꿈 (매일 의미 없는 커밋·sitemap 날짜 변경 방지)
  const metaFile = path.join(ROOT, "data/build-meta.json");
  const hash = crypto.createHash("sha1").update(JSON.stringify(items) + fs.readFileSync(fileURLToPath(import.meta.url))).digest("hex");
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(metaFile, "utf8")); } catch {}
  const updated = prev.hash === hash && prev.updated ? prev.updated : todayKST();

  const byArea = groupBy(items, "area");
  const byCat = groupBy(items, "category");

  // 이전에 만든 페이지 정리 (삭제된 식당 페이지가 남지 않도록)
  for (const d of ["place", "area", "category"]) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });

  for (const it of items) writeFile(`place/${it.slug}/index.html`, placePage(it, items, byArea, byCat, updated));

  const areaChips = [...byArea.keys()].map((a) => `<a href="${hrefOf("area", slugify(a))}">${esc(a)}</a>`).join("");
  for (const [area, arr] of byArea) {
    writeFile(`area/${slugify(area)}/index.html`, hubPage({
      kind: "area", label: area, h1: `강릉 ${area} 맛집`,
      intro: AREA_INTRO[area] || `강릉 ${area}에서 현지인이 오래 다닌 식당·카페·술집 모음.`,
      items: arr, all: items, updated, otherLinks: areaChips,
    }));
  }
  const catChips = [...byCat.keys()].map((c) => `<a href="${hrefOf("category", slugify(c))}">${esc(c)}</a>`).join("");
  for (const [cat, arr] of byCat) {
    writeFile(`category/${slugify(cat)}/index.html`, hubPage({
      kind: "category", label: cat, h1: `강릉 ${cat} 맛집`,
      intro: `광고 없이 강릉 현지인 출신이 직접 다녀온 ${cat} 리스트. 10년 넘은 단골집 위주.`,
      items: arr, all: items, updated, otherLinks: catChips,
    }));
  }

  // app.js용 데이터 (식당 ↔ 페이지 주소)
  writeFile("data/places.json", JSON.stringify(
    items.map(({ id, slug, name, area }) => ({ id, slug, name, area })), null, 0));

  writeFile("data/build-meta.json", JSON.stringify({ hash, updated }) + "\n");

  // sitemap / robots
  const urls = [
    [SITE.origin + "/", "1.0"],
    ...(fs.existsSync(path.join(ROOT, "en.html")) ? [[SITE.origin + "/en.html", "0.6"]] : []),
    ...[...byArea.keys()].map((a) => [urlOf("area", slugify(a)), "0.8"]),
    ...[...byCat.keys()].map((c) => [urlOf("category", slugify(c)), "0.8"]),
    ...items.map((it) => [urlOf("place", it.slug), "0.7"]),
  ];
  writeFile("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, p]) => `  <url><loc>${esc(u)}</loc><lastmod>${updated}</lastmod><priority>${p}</priority></url>`).join("\n")}
</urlset>
`);
  writeFile("robots.txt", `User-agent: *
Allow: /

Sitemap: ${SITE.origin}/sitemap.xml
`);

  updateIndex(items, byArea, byCat, updated);

  console.log(`✔ 맛집 ${items.length} · 동네 ${byArea.size} · 종류 ${byCat.size} · sitemap URL ${urls.length}개 생성 (${updated})`);
  const noArea = items.filter((x) => !x.area);
  if (noArea.length) console.log(`  · 동네를 못 읽은 주소 ${noArea.length}곳: ${noArea.map((x) => x.name).join(", ")}`);
}

main().catch((e) => { console.error("✖", e.message); process.exit(1); });
