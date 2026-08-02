// ============================================================
// [설정 3/3] 이 파일만 고치면 됩니다. (README.md 참고)
// ============================================================
const CONFIG = {
  // 구글 스프레드시트 ID
  // 예) https://docs.google.com/spreadsheets/d/19n0gfR3uNBo6AuKYLOvvdTb_MWgaC20gZUsM6JnKffA/edit
  //                                                  ↑ 이 부분 (슬래시 사이 긴 문자열)
  SHEET_ID: "19n0gfR3uNBo6AuKYLOvvdTb_MWgaC20gZUsM6JnKffA",

  // 시트 하단 탭 이름 (기본은 "시트1" 이지만, 실제 탭 이름으로 바꿔주세요)
  SHEET_NAME: "시트1",

  // 데이터가 시작하는 범위 (기본 구조 기준: A7부터, 넉넉히 1000행까지)
  // 새로운 맛집을 추가할 땐 이 범위 안에만 있으면 자동 반영됩니다.
  SHEET_RANGE: "A7:H1000",

  // 강릉시 중심 좌표 (지도 초기 위치) — 다른 지역으로 바꾸려면 이 좌표만 변경
  MAP_CENTER: { lat: 37.7519, lng: 128.8761 },
  MAP_LEVEL: 9, // 숫자가 작을수록 확대됨 (카카오맵 기준 1~14)

  // 클릭수를 기록할 Google Apps Script 웹앱 URL
  // (README.md "클릭수 로깅 설정" 참고, 배포 후 나오는 /exec 로 끝나는 주소)
  CLICK_LOG_URL: "https://script.google.com/macros/s/여기에_배포된_스크립트_ID/exec",
};
