async function loadSheetData() {
  const url = buildSheetUrl();
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load sheet data (HTTP ${res.status}).`);
  }
  const csvText = await res.text();
  const parsed = Papa.parse(csvText.trim(), { skipEmptyLines: false });
  const rows = parsed.data || [];

  if (rows.length < 2) return [];

  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !Array.isArray(r) || r.length < 3) continue;

    // 시트 인덱스 정확 매핑 (A열=0, B열=1 ... I열=8, J열=9, K열=10)
    const starVal = String(r[0] || "").trim();
    const category = String(r[1] || "").trim() || "Others";
    const menu = String(r[2] || "").trim();
    const nameKo = String(r[3] || "").trim();
    const nameEn = String(r[4] || "").trim();
    const addressKo = String(r[5] || "").trim();
    const addressEn = String(r[6] || "").trim();
    
    // I열 (Index 8): Owner's Pick (En) - 영문 한줄 리뷰
    const noteEn = String(r[8] || "").trim();
    
    // J열 (Index 9): Visited in Person - 'O' 감지
    const visitedRaw = String(r[9] || "").trim().toUpperCase();
    const visited = (visitedRaw === "O" || visitedRaw === "0");
    
    // K열 (Index 10): Owner's Review - 블로그 링크
    const blog = String(r[10] || "").trim();

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
      note: noteEn,             // I열 영문 한줄 리뷰 매핑
      visited: visited,         // J열 방문 여부 매핑
      blog: blog,               // K열 블로그 링크 매핑
      lat: null,
      lng: null,
    });
  }
  return items;
}
