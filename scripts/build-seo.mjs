#!/usr/bin/env node
// ============================================================
// 강릉 뭐먹지 — 검색엔진용 정적 페이지 생성기 (v2)
//
// 구글 시트(config.js와 같은 시트)를 읽어서 아래 파일을 만듭니다.
//   /place/<식당>/          맛집별 상세 페이지
//   /area/<생활권>/         생활권(강릉역·교동, 경포, 안목·송정 …) 모음 페이지
//   /category/<구분>/       종류별 모음 페이지
//   /about/, /privacy/      소개 · 개인정보처리방침
//   /sitemap.xml, /rss.xml, /robots.txt
//   /data/places.json       app.js가 쓰는 식당 ↔ 페이지 주소 목록
//   index.html 안의 <!-- SEO:... --> 표시 사이 (전체 목록, 구조화 데이터)
//
// 시트 열 (A~H는 지금과 동일, I열부터는 '제목'으로 찾음)
//   A 강추(★)  B 구분  C 주요메뉴  D 식당  E 주소  F 한줄평  G 방문(O)  H 후기 링크
//   제목에 '상세'가 들어간 열 → 상세 후기 (긴 글)
//   제목에 '팁'이 들어간 열   → 현지인 팁
//
// 사진: 저장소의 photos 폴더에 "식당이름.jpg" (여러 장이면 "식당이름-2.jpg") 로 올리면 자동 연결
//
// 실행:  node scripts/build-seo.mjs        로컬 테스트:  node scripts/build-seo.mjs --csv 파일.csv
// 의존성 없음 (Node 18 이상)
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------- 사이트 설정 (필요하면 여기만 고치세요) ----------
const SITE = {
  origin: "https://www.gangneungmatzip.com",
  name: "강릉 뭐먹지",
  author: "HoonE",
  ogImage: "https://www.gangneungmatzip.com/thumbnail.png",
  kakaoJsKey: "0470fb23303f174ae3f6cc6b82426f77",
  gaId: "G-GLHEB5P95Z",
  adsenseClient: "ca-pub-4761567002853346",
  // 다음 웹마스터도구 인증 문구 (robots.txt 맨 위에 자동으로 들어감)
  daumPin: "#DaumWebMasterTool:b8346c685654289e4e721848b7e9803cdbb6c3ca0cf95be346decc5514b5f7d1:TEcOMIBivQMU4H7qOlp5xQ==",
  // 광고·제휴 문의 (카카오톡 오픈채팅). 모든 페이지의 "광고·제휴 문의" 링크가 여기로 연결됨
  contactUrl: "https://open.kakao.com/o/s5woUyRi",
  since: "2017",
};

// 모음 페이지를 만들 최소 맛집 수 (이보다 적으면 페이지를 만들지 않음 → 빈약한 페이지 방지)
const MIN_HUB = 3;

// ---------- 생활권 (사람들이 실제로 검색하는 단위) ----------
const ZONES = [
  { slug: "강릉역-교동", h1: "강릉역·교동 맛집", short: "강릉역·교동",
    dongs: ["교동", "포남동", "옥천동"],
    intro: "강릉역과 교동택지, 포남동이 이어진 강릉 시내 중심. KTX에서 내려 바로 갈 수 있고, 고깃집·횟집·술집이 몰려 있어 저녁 약속 잡기 좋은 곳." },
  { slug: "중앙시장-구도심", h1: "강릉 중앙시장·구도심 맛집", short: "중앙시장·구도심",
    dongs: ["성남동", "임당동", "명주동", "남문동", "금학동", "용강동", "성내동", "중앙동"],
    intro: "강릉중앙시장과 월화거리, 명주동 골목이 있는 구도심. 시장 먹거리와 오래된 노포, 옛 건물을 고친 카페가 모여 있다." },
  { slug: "강릉-시내", h1: "강릉 시내 맛집 (홍제·유천·입암·노암)", short: "강릉 시내",
    dongs: ["홍제동", "유천동", "지변동", "회산동", "입암동", "노암동", "내곡동", "두산동", "장현동", "박월동", "담산동", "청량동", "학동", "신석동", "월호평동", "구정면"],
    intro: "시청이 있는 홍제동부터 유천택지, 남대천 건너 입암·노암동까지 강릉 사람들의 생활권. 관광지보다 동네 단골이 많은 식당들." },
  { slug: "경포", h1: "강릉 경포 맛집", short: "경포",
    dongs: ["강문동", "안현동", "저동", "운정동", "난곡동", "죽헌동", "대전동"],
    intro: "경포호와 경포해변, 강문해변 주변. 바다 보며 먹는 식당과 카페, 횟집이 많은 강릉 대표 관광지." },
  { slug: "초당", h1: "강릉 초당 맛집", short: "초당",
    dongs: ["초당동"],
    intro: "초당순두부마을이 있는 동네. 경포호와 가까워 순두부 먹고 호수 산책하거나 카페 들르기 좋다." },
  { slug: "안목-송정", h1: "강릉 안목해변·송정 맛집", short: "안목·송정",
    dongs: ["견소동", "송정동", "남항진동", "병산동"],
    intro: "안목해변 커피거리와 송정해변 솔밭, 남항진까지 이어지는 바닷가. 바다 보이는 카페가 줄지어 있다." },
  { slug: "주문진", h1: "강릉 주문진 맛집", short: "주문진",
    dongs: ["주문진읍", "연곡면"],
    intro: "주문진항과 수산시장이 있는 강릉 북쪽 항구 마을. 대게·회 먹으러 가는 곳." },
  { slug: "사천", h1: "강릉 사천진·사천해변 맛집", short: "사천",
    dongs: ["사천면"],
    intro: "사천진해변과 사천항이 있는 강릉 북쪽 바닷가. 물회와 바다 보는 카페가 많다." },
  { slug: "정동진-강동", h1: "강릉 정동진·안인 맛집", short: "정동진·안인",
    dongs: ["강동면", "옥계면"],
    intro: "정동진과 안인, 옥계로 이어지는 강릉 남쪽 바닷가. 갓 잡은 생선으로 하는 식당이 많다." },
  { slug: "성산-왕산", h1: "강릉 성산·왕산 맛집", short: "성산·왕산",
    dongs: ["성산면", "왕산면"],
    intro: "대관령 쪽으로 향하는 성산·왕산 방면. 시내를 벗어나 한적하게 들르는 식당들." },
];
const ZONE_BY_DONG = new Map(ZONES.flatMap((z) => z.dongs.map((d) => [d, z])));

// 지번 주소의 '리'를 읍/면으로 묶음
const RI_TO_EUP = {
  주문리: "주문진읍", 교항리: "주문진읍", 향호리: "주문진읍", 장덕리: "주문진읍", 삼교리: "주문진읍",
  영진리: "연곡면", 동덕리: "연곡면", 송림리: "연곡면", 방내리: "연곡면",
  사천진리: "사천면", 산대월리: "사천면", 판교리: "사천면", 미노리: "사천면", 방동리: "사천면",
  안인리: "강동면", 안인진리: "강동면", 정동진리: "강동면", 심곡리: "강동면", 언별리: "강동면", 하시동리: "강동면",
  금진리: "옥계면", 도직리: "옥계면", 현내리: "옥계면",
  구산리: "성산면", 금산리: "성산면", 위촌리: "성산면", 송암리: "성산면",
  학산리: "구정면", 덕현리: "구정면", 어단리: "구정면",
};

const CATEGORY_SCHEMA = { "카페/커피": "CafeOrCoffeeShop", 베이커리: "Bakery", 술집: "BarOrPub" };

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

const hrefOf = (kind, slug) => `/${kind}/${encodeURIComponent(slug)}/`;
const urlOf = (kind, slug) => SITE.origin + hrefOf(kind, slug);

const cut = (s, n) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
};

const todayKST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

const jsonLd = (obj) =>
  `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2).replace(/</g, "\\u003c")}\n</script>`;

// ---------- CSV ----------
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
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
  // 지도(app.js)는 A~H만 쓰지만, 생성기는 추가 열(상세 후기, 팁)까지 읽음
  const range = (SHEET_RANGE || "A7:H1000").replace(/:([A-Z]+)(\d+)$/, ":Z$2");
  const params = new URLSearchParams({ tqx: "out:csv", sheet: SHEET_NAME, range });
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`시트를 불러오지 못했습니다 (HTTP ${res.status})`);
  const text = await res.text();
  if (/<html/i.test(text.slice(0, 200))) throw new Error("시트가 '링크가 있는 모든 사용자 보기'로 공유되어 있는지 확인하세요.");
  return text;
}

// ---------- 사진 ----------
function loadPhotos() {
  const dir = path.join(ROOT, "photos");
  const map = new Map();
  if (!fs.existsSync(dir)) return map;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(jpe?g|png|webp)$/i.test(f)) continue;
    const base = f.normalize("NFC").replace(/\.[^.]+$/, "");
    const m = base.match(/^(.*?)[-_ ](\d+)$/);
    const key = slugify(m ? m[1] : base);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ f, n: m ? Number(m[2]) : 1 });
  }
  // "식당이름.jpg"가 첫 번째(대표), 그다음 -2, -3 … 순서
  for (const [k, arr] of map) map.set(k, arr.sort((a, b) => a.n - b.n).map((x) => x.f));
  return map;
}
const photoUrl = (f) => `/photos/${encodeURIComponent(f)}`;

// ---------- 데이터 ----------
function dongOf(address) {
  const m = address.match(/강릉시\s+(\S+?(?:동|읍|면|리))(?=\s|$|\d)/);
  if (!m) return { raw: "", dong: "" };
  return { raw: m[1], dong: RI_TO_EUP[m[1]] || m[1] };
}

function toItems(rows, photos) {
  const header = (rows[0] || []).map((h) => (h || "").trim());
  const col = (re) => header.findIndex((h, i) => i >= 8 && re.test(h));
  const iDetail = col(/상세/), iTip = col(/팁|tip/i);

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 4) continue;
    const v = r.map((x) => (x || "").trim());
    const [star, category, menu, name, address, note, visited, blog] = v;
    if (!name) continue;
    const { raw, dong } = dongOf(address);
    items.push({
      id: `${name}__${address}`,               // app.js와 같은 규칙
      starred: !!star,
      category: category || "기타",
      menu, name, address, note,
      visited: visited === "O",
      blog: /^https?:\/\//.test(blog) ? blog : "",
      detail: iDetail > -1 ? v[iDetail] || "" : "",
      tip: iTip > -1 ? v[iTip] || "" : "",
      rawDong: raw, dong,
      zone: ZONE_BY_DONG.get(dong) || null,
      photos: photos.get(slugify(name)) || [],
    });
  }
  const used = new Set();
  for (const it of items) {
    let s = slugify(it.name);
    if (used.has(s) && it.dong) s = `${s}-${slugify(it.dong)}`;
    let n = 2; const base = s;
    while (used.has(s)) s = `${base}-${n++}`;
    used.add(s);
    it.slug = s;
  }
  return items;
}

const sortItems = (arr) => [...arr].sort((a, b) =>
  (b.starred - a.starred) || (!!b.detail - !!a.detail) || (!!b.blog - !!a.blog) || a.name.localeCompare(b.name, "ko"));

// ---------- 공통 레이아웃 ----------
function layout({ title, description, canonical, body, ld = [], ogType = "website", ogImage = SITE.ogImage, robots = "" }) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
${robots ? `<meta name="robots" content="${robots}" />\n` : ""}<link rel="canonical" href="${esc(canonical)}" />
<link rel="alternate" type="application/rss+xml" title="${esc(SITE.name)}" href="${SITE.origin}/rss.xml" />
<meta property="og:type" content="${ogType}" />
<meta property="og:site_name" content="${esc(SITE.name)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${esc(ogImage)}" />
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
  <p><a href="/about/">사이트 소개</a> · <a href="/privacy/">개인정보처리방침</a> · <a href="/">맛집 지도</a>${SITE.contactUrl ? ` · <a href="${esc(SITE.contactUrl)}" target="_blank" rel="noopener">광고·제휴 문의</a>` : ""}</p>
  <p>Copyright © ${SITE.since}–${new Date().getFullYear()} ${esc(SITE.author)} · ${esc(SITE.name)}. 리뷰·사진·글의 무단 복제와 재배포를 금지합니다.</p>
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

const placeLoc = (it) => it.zone ? it.zone.short : it.dong;

function card(it) {
  const thumb = it.photos[0] ? `<img class="s-thumb" src="${photoUrl(it.photos[0])}" alt="${esc(it.name)}" loading="lazy" />` : "";
  return `<li class="s-card">
  <a href="${hrefOf("place", it.slug)}">${thumb}
    <div class="s-card-top"><b>${it.starred ? "★ " : ""}${esc(it.name)}</b><span class="s-tag">${esc(it.category)}</span>${it.blog ? '<span class="s-n">후기</span>' : ""}</div>
    <div class="s-card-menu">${esc(it.menu)}${placeLoc(it) ? ` · ${esc(placeLoc(it))}` : ""}</div>
    ${it.note ? `<p>${esc(cut(it.note, 90))}</p>` : ""}
  </a>
</li>`;
}

// ---------- 맛집 상세 ----------
function placePage(it, ctx) {
  const { hubZones, hubCats, byZone, byCat, updated } = ctx;
  const url = urlOf("place", it.slug);
  const zoneHub = it.zone && hubZones.has(it.zone.slug) ? it.zone : null;
  const catHub = hubCats.has(it.category);
  const locTxt = it.zone ? it.zone.short : it.dong;
  const title = `${it.name} – 강릉${locTxt ? " " + locTxt : ""} ${it.menu || it.category} 현지인 후기 | ${SITE.name}`;
  const description = cut(`${it.starred ? "[주인장 강추] " : ""}${it.name}(${it.category}${it.menu ? ", " + it.menu : ""}) · ${it.address}. ${it.note} ${it.detail}`, 155);

  const trail = [
    ["홈", SITE.origin + "/"],
    ...(zoneHub ? [[zoneHub.h1, urlOf("area", zoneHub.slug)]] : []),
    [it.name, url],
  ];

  const nearby = it.zone ? sortItems((byZone.get(it.zone.slug) || []).filter((x) => x !== it)).slice(0, 6) : [];
  const sameCat = sortItems((byCat.get(it.category) || []).filter((x) => x !== it && !nearby.includes(x))).slice(0, 6);

  const images = it.photos.map((f) => SITE.origin + photoUrl(f));
  const q = encodeURIComponent(`${it.name} ${it.address}`);
  const reviewText = [it.note, it.detail].filter(Boolean).join("\n\n");
  const ld = {
    "@context": "https://schema.org",
    "@type": CATEGORY_SCHEMA[it.category] || "Restaurant",
    name: it.name,
    url,
    image: images.length ? images : SITE.ogImage,
    ...(it.menu ? { servesCuisine: it.menu } : {}),
    address: {
      "@type": "PostalAddress",
      streetAddress: it.address.replace(/^강원(특별자치도)?\s*강릉시\s*/, ""),
      addressLocality: "강릉시",
      addressRegion: "강원특별자치도",
      addressCountry: "KR",
    },
    ...(reviewText ? {
      review: {
        "@type": "Review",
        author: { "@type": "Person", name: SITE.author },
        reviewBody: reviewText,
        publisher: { "@type": "Organization", name: SITE.name },
      },
    } : {}),
  };

  const gallery = it.photos.length ? `<div class="s-gallery s-gallery--${Math.min(it.photos.length, 3)}">${it.photos
    .map((f, i) => `<img src="${photoUrl(f)}" alt="${esc(`${it.name} ${it.menu || it.category} 사진 ${i + 1}`)}" loading="${i ? "lazy" : "eager"}" />`).join("")}</div>
  <p class="s-photo-note">직접 찍은 사진입니다. 무단 사용을 금지합니다.</p>` : "";

  const body = `
${crumbsHtml(trail)}
<article class="s-place">
  <div class="s-eyebrow">${esc(it.category)}${it.menu ? ` · ${esc(it.menu)}` : ""}${locTxt ? ` · ${esc(locTxt)}` : ""}</div>
  <h1>${esc(it.name)}</h1>
  <div class="s-badges">
    ${it.starred ? '<span class="s-badge s-badge--star">★ 주인장 강추</span>' : ""}
    <span class="s-badge">${it.visited ? "✔ 직접 방문" : "미방문 · 전해 들은 곳"}</span>
    ${it.blog ? '<span class="s-badge s-badge--n">N 후기 있음</span>' : ""}
  </div>
  ${gallery}

  ${it.note || it.detail ? `<section class="s-review">
    <h2>🙋🏻 주인장 평</h2>
    ${it.note ? `<p class="s-oneline">${esc(it.note)}</p>` : ""}
    ${it.detail ? `<div class="s-detail">${esc(it.detail)}</div>` : ""}
    <div class="s-by">— ${esc(SITE.author)}, 강릉에서 25년 넘게 산 현지인 출신</div>
  </section>` : ""}

  ${it.tip ? `<section class="s-tip">
    <h2>💡 현지인 팁</h2>
    <div>${esc(it.tip)}</div>
  </section>` : ""}

  <section class="s-info">
    <h2>위치 · 찾아가기</h2>
    <dl>
      <dt>주소</dt><dd>${esc(it.address)}</dd>
      ${it.menu ? `<dt>주요 메뉴</dt><dd>${esc(it.menu)}</dd>` : ""}
      <dt>구분</dt><dd>${catHub ? `<a href="${hrefOf("category", slugify(it.category))}">${esc(it.category)}</a>` : esc(it.category)}</dd>
      ${it.dong ? `<dt>동네</dt><dd>${esc(it.dong)}${zoneHub ? ` · <a href="${hrefOf("area", zoneHub.slug)}">${esc(zoneHub.short)} 맛집 모음</a>` : ""}</dd>` : ""}
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

  ${nearby.length ? `<section class="s-more">
    <h2>${esc(it.zone.short)} 근처 다른 맛집</h2>
    <ul class="s-cards">${nearby.map(card).join("")}</ul>
    ${zoneHub ? `<a class="s-all" href="${hrefOf("area", zoneHub.slug)}">${esc(zoneHub.h1)} 전체 보기 →</a>` : ""}
  </section>` : ""}

  ${sameCat.length ? `<section class="s-more">
    <h2>강릉 ${esc(it.category)} 더 보기</h2>
    <ul class="s-cards">${sameCat.map(card).join("")}</ul>
    ${catHub ? `<a class="s-all" href="${hrefOf("category", slugify(it.category))}">강릉 ${esc(it.category)} 전체 보기 →</a>` : ""}
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

  return layout({
    title, description, canonical: url, body, ogType: "article",
    ogImage: images[0] || SITE.ogImage,
    ld: [ld, breadcrumbLd(trail)],
  });
}

// ---------- 모음(허브) 페이지 ----------
function hubPage({ kind, slug, h1, intro, items, groupKey, groupLabel, updated, otherLinks }) {
  const url = urlOf(kind, slug);
  const sorted = sortItems(items);
  const starred = sorted.filter((x) => x.starred).length;
  const title = `${h1} ${sorted.length}곳 – 현지인 추천 리스트 | ${SITE.name}`;
  const description = cut(`${intro} ${sorted.slice(0, 5).map((x) => x.name).join(", ")} 등 ${sorted.length}곳. 강릉 현지인 출신이 직접 고른 로컬 맛집.`, 155);
  const trail = [["홈", SITE.origin + "/"], [h1, url]];
  const firstPhoto = sorted.find((x) => x.photos.length);

  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: h1,
    url,
    numberOfItems: sorted.length,
    itemListElement: sorted.map((it, i) => ({ "@type": "ListItem", position: i + 1, url: urlOf("place", it.slug), name: it.name })),
  };

  // 하위 묶음 (생활권 페이지 → 종류별, 종류 페이지 → 생활권별). 묶음이 1개뿐이면 그냥 목록.
  const groups = new Map();
  for (const it of sorted) {
    const g = groupLabel(it) || "기타";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(it);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "ko"));
  const list = ordered.length > 1
    ? ordered.map(([g, arr]) => `<h2 class="s-sub">${esc(g)} <small>${arr.length}</small></h2>\n<ul class="s-cards">${arr.map(card).join("")}</ul>`).join("\n")
    : `<ul class="s-cards">${sorted.map(card).join("")}</ul>`;

  const body = `
${crumbsHtml(trail)}
<section class="s-hub">
  <h1>${esc(h1)}</h1>
  <p class="s-lead">${esc(intro)}</p>
  <p class="s-meta">${sorted.length}곳 수록${starred ? ` · 주인장 강추 ${starred}곳` : ""} · 목록 갱신 ${updated}</p>
  ${list}
</section>
<section class="s-more">
  <h2>${kind === "area" ? "다른 지역 맛집" : "다른 종류 맛집"}</h2>
  <div class="s-chips">${otherLinks}</div>
  <a class="s-btn s-btn--main" href="/">🗺️ 전체 맛집 지도에서 보기</a>
</section>`;
  return layout({
    title, description, canonical: url, body,
    ogImage: firstPhoto ? SITE.origin + photoUrl(firstPhoto.photos[0]) : SITE.ogImage,
    ld: [ld, breadcrumbLd(trail)],
  });
}

// 예전 주소(동 단위 / 사라진 종류 페이지) → 새 페이지로 이동
function redirectPage(to) {
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8" />
<title>${esc(SITE.name)}</title>
<meta name="robots" content="noindex, follow" />
<link rel="canonical" href="${esc(to)}" />
<meta http-equiv="refresh" content="0; url=${esc(to)}" />
</head><body><p><a href="${esc(to)}">이동하기</a></p><script>location.replace(${JSON.stringify(to)})</script></body></html>
`;
}

// ---------- 소개 · 개인정보처리방침 ----------
function aboutPage(items, ctx) {
  const visited = items.filter((x) => x.visited).length;
  const starred = items.filter((x) => x.starred).length;
  const blogHome = (() => {
    const b = items.find((x) => /blog\.naver\.com\/[^/?#]+/.test(x.blog));
    return b ? b.blog.match(/https?:\/\/(?:m\.)?blog\.naver\.com\/[^/?#]+/)[0] : "";
  })();
  const url = SITE.origin + "/about/";
  const body = `
${crumbsHtml([["홈", SITE.origin + "/"], ["사이트 소개", url]])}
<article class="s-doc">
  <h1>강릉 뭐먹지 소개</h1>
  <p class="s-lead">"강릉 사람은 강릉 가면 뭐 먹어?" — 서울에 올라와 수백 번 받은 이 질문에 답하려고 만든 강릉 로컬 맛집 지도입니다.</p>

  <h2>누가 만들었나요</h2>
  <p>강릉에서 25년 넘게 살다 ${SITE.since}년 무렵부터 서울에서 지내고 있는 강릉 출신 ${esc(SITE.author)}가 직접 운영합니다. 친구들에게 구글 시트로 공유하던 단골집 목록을 누구나 볼 수 있는 지도로 옮겼습니다.</p>

  <h2>어떤 기준으로 고르나요</h2>
  <ul>
    <li>현재 <b>${items.length}곳</b> 수록 · 직접 방문 <b>${visited}곳</b> · 주인장 강추 <b>${starred}곳</b></li>
    <li>SNS에서 뜨는 집보다, 강릉 사람들이 10년 넘게 다닌 단골집 위주입니다.</li>
    <li>직접 가 본 곳은 "직접 방문", 주변에서 전해 들은 곳은 "미방문 · 전해 들은 곳"으로 구분해 표시합니다.</li>
    <li>맛 평가는 철저히 주관적입니다. 사장님이 바뀌면 맛도 바뀌니, 판단은 직접 해 주세요.</li>
  </ul>

  <h2>광고에 대해</h2>
  <p>리뷰와 ★강추 표시는 광고비와 관계없이 작성자가 직접 정합니다. 광고나 제휴 링크가 들어가는 영역에는 반드시 <b>광고(AD)</b> 표시를 합니다.</p>
  ${SITE.contactUrl ? `<p><a class="s-btn s-btn--kakao" href="${esc(SITE.contactUrl)}" target="_blank" rel="noopener">💬 광고·제휴 문의 (카카오톡 오픈채팅)</a></p>` : ""}

  <h2>정보는 얼마나 자주 바뀌나요</h2>
  <p>작성자가 관리하는 목록이 바뀌면 다음 날 새벽에 사이트가 자동으로 갱신됩니다. 마지막 갱신일: ${ctx.updated}. 폐업이나 영업시간 변동이 있을 수 있으니 방문 전 지도 앱에서 한 번 더 확인해 주세요.</p>

  <h2>연락처</h2>
  <ul>
    ${SITE.contactUrl ? `<li>광고·제휴·정보 수정 문의: <a href="${esc(SITE.contactUrl)}" target="_blank" rel="noopener">카카오톡 오픈채팅 (광고제휴문의)</a></li>` : ""}
    ${blogHome ? `<li>작성자 블로그: <a href="${esc(blogHome)}" target="_blank" rel="noopener">${esc(blogHome.replace(/^https?:\/\//, ""))}</a></li>` : ""}
    <li>사이트: <a href="${SITE.origin}/">${SITE.origin.replace("https://", "")}</a></li>
  </ul>
</article>`;
  return layout({
    title: `사이트 소개 – 강릉 현지인 출신이 만든 맛집 지도 | ${SITE.name}`,
    description: `강릉에서 25년 넘게 산 현지인 출신 ${SITE.author}가 직접 다닌 강릉 로컬 맛집 ${items.length}곳을 모은 지도. 선정 기준과 광고 원칙.`,
    canonical: url, body,
    ld: [{
      "@context": "https://schema.org", "@type": "AboutPage", name: `${SITE.name} 소개`, url,
      about: { "@type": "WebSite", name: SITE.name, url: SITE.origin + "/" },
      author: { "@type": "Person", name: SITE.author },
    }],
  });
}

function privacyPage(ctx) {
  const url = SITE.origin + "/privacy/";
  const body = `
${crumbsHtml([["홈", SITE.origin + "/"], ["개인정보처리방침", url]])}
<article class="s-doc">
  <h1>개인정보처리방침</h1>
  <p>${esc(SITE.name)}(${SITE.origin.replace("https://", "")}, 이하 "사이트")는 방문자의 개인정보를 소중히 다루며, 관련 법령을 지킵니다.</p>

  <h2>1. 수집하는 정보</h2>
  <p>사이트는 회원가입이 없으며, 이름·연락처 등 개인을 직접 알아볼 수 있는 정보를 받지 않습니다. 다만 사이트 운영과 개선을 위해 아래 정보가 자동으로 수집될 수 있습니다.</p>
  <ul>
    <li>방문 기록, 이용한 페이지, 접속 기기·브라우저 종류, 대략적인 지역 (Google Analytics)</li>
    <li>어떤 맛집 정보를 눌러 보았는지, 공유 버튼을 눌렀는지 (식당 이름만 기록되며 개인을 식별하지 않음)</li>
    <li>재방문 여부 확인을 위해 브라우저에 저장되는 임의의 방문자 번호와 마지막 방문 날짜, 지도 좌표 캐시 (브라우저 localStorage)</li>
  </ul>

  <h2>2. 쿠키와 광고</h2>
  <p>사이트는 Google Analytics(방문 통계)와 Google 애드센스 등 제3자 광고 서비스를 사용할 수 있습니다. 이 서비스들은 쿠키를 사용해 방문자가 이 사이트와 다른 사이트를 방문한 기록을 바탕으로 광고를 보여줄 수 있습니다.</p>
  <ul>
    <li>Google의 광고 쿠키 사용 방식: <a href="https://policies.google.com/technologies/ads?hl=ko" target="_blank" rel="noopener">policies.google.com/technologies/ads</a></li>
    <li>맞춤 광고는 <a href="https://adssettings.google.com" target="_blank" rel="noopener">Google 광고 설정</a>에서 끌 수 있습니다.</li>
    <li>브라우저 설정에서 쿠키 저장을 거부할 수 있으며, 이 경우에도 사이트 이용에는 지장이 없습니다.</li>
  </ul>

  <h2>3. 외부 서비스</h2>
  <p>지도 표시를 위해 카카오맵, 맛집 목록 관리를 위해 Google 스프레드시트, 사이트 호스팅을 위해 GitHub Pages를 사용합니다. 각 서비스의 개인정보 처리는 해당 회사의 방침을 따릅니다.</p>

  <h2>4. 보관 기간</h2>
  <p>통계 정보는 Google Analytics의 보관 설정에 따르며, 브라우저에 저장된 정보는 방문자가 브라우저의 사이트 데이터를 지우면 삭제됩니다.</p>

  <h2>5. 문의</h2>
  <p>개인정보 관련 문의는 ${SITE.contactUrl ? `<a href="${esc(SITE.contactUrl)}" target="_blank" rel="noopener">카카오톡 오픈채팅</a>` : "사이트 소개 페이지의 연락처"}으로 보내 주세요.</p>

  <p class="s-meta">시행일: ${ctx.policyDate}</p>
</article>`;
  return layout({
    title: `개인정보처리방침 | ${SITE.name}`,
    description: `${SITE.name} 개인정보처리방침. 수집 정보, 쿠키와 광고, 외부 서비스, 문의 방법.`,
    canonical: url, body,
  });
}

// ---------- index.html 갱신 ----------
function replaceBetween(html, key, content) {
  const re = new RegExp(`(<!-- SEO:${key}:START -->)[\\s\\S]*?(<!-- SEO:${key}:END -->)`);
  if (!re.test(html)) {
    console.warn(`  ! index.html에 <!-- SEO:${key}:START/END --> 표시가 없어 건너뜀`);
    return html;
  }
  return html.replace(re, () => `<!-- SEO:${key}:START -->\n${content}\n<!-- SEO:${key}:END -->`);
}

function updateIndex(items, ctx) {
  const { hubZones, hubCats, byZone, byCat, updated } = ctx;
  const file = path.join(ROOT, "index.html");
  let html = fs.readFileSync(file, "utf8");

  const list = {
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
    alternateName: ["강릉 맛집 지도", "강릉뭐먹지", "강릉 로컬 맛집 지도"],
    url: SITE.origin + "/",
    author: { "@type": "Person", name: SITE.author },
    inLanguage: "ko-KR",
  };
  html = replaceBetween(html, "JSONLD",
    `  <link rel="alternate" type="application/rss+xml" title="${esc(SITE.name)}" href="${SITE.origin}/rss.xml" />\n${jsonLd(site)}\n${jsonLd(list)}`);

  const zoneLinks = ZONES.filter((z) => hubZones.has(z.slug))
    .map((z) => `<a href="${hrefOf("area", z.slug)}">${esc(z.short)} <small>${byZone.get(z.slug).length}</small></a>`).join("");
  const catLinks = [...hubCats].sort((a, b) => byCat.get(b).length - byCat.get(a).length)
    .map((c) => `<a href="${hrefOf("category", slugify(c))}">${esc(c)} <small>${byCat.get(c).length}</small></a>`).join("");
  const rows = sortItems(items).map((it) =>
    `<li><a href="${hrefOf("place", it.slug)}">${it.starred ? "★ " : ""}${esc(it.name)}</a> <span>${esc(it.category)}${it.menu ? " · " + esc(it.menu) : ""}${placeLoc(it) ? " · " + esc(placeLoc(it)) : ""}</span></li>`).join("\n");

  html = replaceBetween(html, "DIRECTORY", `<section class="seo-directory" aria-label="강릉 맛집 전체 목록">
  <h2>지역별 강릉 맛집</h2>
  <div class="seo-chips">${zoneLinks}</div>
  <h2>종류별 강릉 맛집</h2>
  <div class="seo-chips">${catLinks}</div>
  <details class="seo-all">
    <summary>강릉 맛집 전체 목록 ${items.length}곳 펼치기</summary>
    <ul>${rows}</ul>
  </details>
  ${SITE.contactUrl ? `<a class="seo-contact" href="${esc(SITE.contactUrl)}" target="_blank" rel="noopener">💬 광고·제휴 문의 <small>카카오톡 오픈채팅</small></a>` : ""}
  <p class="seo-updated">목록 갱신: ${updated} · <a href="/about/">사이트 소개</a> · <a href="/privacy/">개인정보처리방침</a>${SITE.contactUrl ? ` · <a href="${esc(SITE.contactUrl)}" target="_blank" rel="noopener">광고·제휴 문의</a>` : ""}</p>
</section>`);

  html = html.replace(/<span id="totalCount" class="meta-pill">[^<]*<\/span>/,
    `<span id="totalCount" class="meta-pill">${items.length}곳 수록</span>`);

  // 메인 제목(h1)에 검색어 보강 (재미있는 원래 문구는 그대로 두고 아래 한 줄 추가)
  if (!html.includes('class="h1-sub"')) {
    html = html.replace(/(<h1>)([^<]*)(<\/h1>)/, `$1$2<span class="h1-sub">현지인 출신이 만든 강릉 맛집 지도</span>$3`);
  }

  // 하단 "광고비 대환영" 문구 옆에 광고·제휴 문의 링크
  if (SITE.contactUrl && !html.includes('class="footer-contact"')) {
    html = html.replace(/(대+환영\^*\.?)(\s*<\/p>)/,
      `$1 <a class="footer-contact" href="${esc(SITE.contactUrl)}" target="_blank" rel="noopener">👉 광고·제휴 문의</a>$2`);
  }

  fs.writeFileSync(file, html);
}

// ---------- 실행 ----------
function writeFile(rel, content) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const rfc822 = (ymd) => new Date(`${ymd}T03:00:00+09:00`).toUTCString();

async function main() {
  const photos = loadPhotos();
  const items = toItems(parseCSV((await loadCSV()).replace(/^\uFEFF/, "")), photos);
  if (items.length < 5) throw new Error(`맛집이 ${items.length}곳뿐이라 중단합니다. 시트 범위/공유 설정을 확인하세요.`);

  // 내용이 바뀐 날만 '갱신일'을 바꿈 (매일 의미 없는 커밋·sitemap 날짜 변경 방지)
  const metaFile = path.join(ROOT, "data/build-meta.json");
  const hash = crypto.createHash("sha1")
    .update(JSON.stringify(items) + fs.readFileSync(fileURLToPath(import.meta.url))).digest("hex");
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(metaFile, "utf8")); } catch {}
  const updated = prev.hash === hash && prev.updated ? prev.updated : todayKST();
  const policyDate = prev.policyDate || todayKST();

  const byZone = new Map(), byCat = new Map();
  for (const it of items) {
    if (it.zone) { if (!byZone.has(it.zone.slug)) byZone.set(it.zone.slug, []); byZone.get(it.zone.slug).push(it); }
    if (!byCat.has(it.category)) byCat.set(it.category, []);
    byCat.get(it.category).push(it);
  }
  const hubZones = new Set([...byZone].filter(([, a]) => a.length >= MIN_HUB).map(([k]) => k));
  const hubCats = new Set([...byCat].filter(([, a]) => a.length >= MIN_HUB).map(([k]) => k));
  const ctx = { hubZones, hubCats, byZone, byCat, updated, policyDate };

  // 이전 생성물 정리 후 다시 만들기
  for (const d of ["place", "area", "category", "about", "privacy"]) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });

  for (const it of items) writeFile(`place/${it.slug}/index.html`, placePage(it, ctx));

  const zoneChips = ZONES.filter((z) => hubZones.has(z.slug)).map((z) => `<a href="${hrefOf("area", z.slug)}">${esc(z.short)}</a>`).join("");
  for (const z of ZONES.filter((z) => hubZones.has(z.slug))) {
    writeFile(`area/${z.slug}/index.html`, hubPage({
      kind: "area", slug: z.slug, h1: z.h1, intro: z.intro, items: byZone.get(z.slug),
      groupLabel: (it) => it.category, updated, otherLinks: zoneChips,
    }));
  }
  const catChips = [...hubCats].map((c) => `<a href="${hrefOf("category", slugify(c))}">${esc(c)}</a>`).join("");
  for (const c of hubCats) {
    writeFile(`category/${slugify(c)}/index.html`, hubPage({
      kind: "category", slug: slugify(c), h1: `강릉 ${c} 맛집`,
      intro: `광고 없이 강릉 현지인 출신이 직접 다녀온 ${c} 리스트. 10년 넘은 단골집 위주.`,
      items: byCat.get(c), groupLabel: (it) => (it.zone ? it.zone.short : "그 밖의 지역"), updated, otherLinks: catChips,
    }));
  }

  // 예전 주소 → 새 주소 (이미 검색엔진에 알려진 주소가 404가 되지 않도록)
  const redirects = new Map();
  for (const it of items) {
    const to = it.zone && hubZones.has(it.zone.slug) ? urlOf("area", it.zone.slug) : SITE.origin + "/";
    for (const d of [it.rawDong, it.dong]) if (d && !redirects.has(`area/${slugify(d)}`)) redirects.set(`area/${slugify(d)}`, to);
  }
  for (const [c] of byCat) if (!hubCats.has(c)) redirects.set(`category/${slugify(c)}`, SITE.origin + "/");
  for (const [p, to] of redirects) if (!fs.existsSync(path.join(ROOT, p, "index.html"))) writeFile(`${p}/index.html`, redirectPage(to));

  writeFile("about/index.html", aboutPage(items, ctx));
  writeFile("privacy/index.html", privacyPage(ctx));

  writeFile("data/places.json", JSON.stringify(items.map(({ id, slug, name }) => ({ id, slug, name })), null, 0));
  writeFile("data/build-meta.json", JSON.stringify({ hash, updated, policyDate }) + "\n");

  // sitemap
  const urls = [
    [SITE.origin + "/", "1.0"],
    ...(fs.existsSync(path.join(ROOT, "en.html")) ? [[SITE.origin + "/en.html", "0.5"]] : []),
    ...ZONES.filter((z) => hubZones.has(z.slug)).map((z) => [urlOf("area", z.slug), "0.9"]),
    ...[...hubCats].map((c) => [urlOf("category", slugify(c)), "0.8"]),
    ...items.map((it) => [urlOf("place", it.slug), "0.7"]),
    [SITE.origin + "/about/", "0.4"],
    [SITE.origin + "/privacy/", "0.2"],
  ];
  writeFile("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, p]) => `  <url><loc>${esc(u)}</loc><lastmod>${updated}</lastmod><priority>${p}</priority></url>`).join("\n")}
</urlset>
`);

  // RSS (네이버 서치어드바이저 RSS 제출용)
  const rssItems = [
    ...ZONES.filter((z) => hubZones.has(z.slug)).map((z) => ({
      title: `${z.h1} ${byZone.get(z.slug).length}곳`, link: urlOf("area", z.slug), desc: z.intro })),
    ...sortItems(items).map((it) => ({
      title: `${it.name} – 강릉${placeLoc(it) ? " " + placeLoc(it) : ""} ${it.menu || it.category}`,
      link: urlOf("place", it.slug), desc: cut([it.note, it.detail, it.tip].filter(Boolean).join(" "), 300) || `${it.category} · ${it.address}` })),
  ];
  writeFile("rss.xml", `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${esc(SITE.name)} – 현지인 출신의 강릉 로컬 맛집 지도</title>
  <link>${SITE.origin}/</link>
  <description>강릉에서 25년 넘게 산 현지인 출신이 직접 다닌 강릉 맛집·카페·술집 ${items.length}곳</description>
  <language>ko</language>
  <lastBuildDate>${rfc822(updated)}</lastBuildDate>
${rssItems.map((r) => `  <item>
    <title>${esc(r.title)}</title>
    <link>${esc(r.link)}</link>
    <guid isPermaLink="true">${esc(r.link)}</guid>
    <description>${esc(r.desc)}</description>
    <pubDate>${rfc822(updated)}</pubDate>
  </item>`).join("\n")}
</channel>
</rss>
`);

  // robots.txt (다음 웹마스터도구 인증 문구 포함)
  writeFile("robots.txt", `${SITE.daumPin ? SITE.daumPin + "\n\n" : ""}User-agent: *
Allow: /

Sitemap: ${SITE.origin}/sitemap.xml
`);

  updateIndex(items, ctx);

  const withDetail = items.filter((x) => x.detail).length;
  const withPhoto = items.filter((x) => x.photos.length).length;
  console.log(`✔ 맛집 ${items.length} · 지역 페이지 ${hubZones.size} · 종류 페이지 ${hubCats.size} · sitemap ${urls.length}개 · 예전 주소 이동 ${redirects.size}개 (${updated})`);
  console.log(`  · 상세 후기 있는 곳 ${withDetail} · 사진 있는 곳 ${withPhoto}`);
  const noZone = items.filter((x) => !x.zone);
  if (noZone.length) console.log(`  · 지역을 못 정한 곳 ${noZone.length}: ${noZone.map((x) => `${x.name}(${x.dong || "주소 확인"})`).join(", ")}`);
  const unmatched = [...photos.keys()].filter((k) => !items.some((it) => slugify(it.name) === k));
  if (unmatched.length) console.log(`  · 식당 이름과 맞지 않는 사진 파일: ${unmatched.join(", ")}`);
}

main().catch((e) => { console.error("✖", e.message); process.exit(1); });
