/**
 * ============================================================
 * 강릉 뭐먹지 — 클릭수 로깅용 Google Apps Script
 * ------------------------------------------------------------
 * 설치 방법 (README.md "클릭수 로깅 설정" 참고)
 * 1) 스프레드시트 상단 메뉴 [확장 프로그램] > [Apps Script] 클릭
 * 2) 아래 코드를 전부 붙여넣고 저장
 * 3) 우측 상단 [배포] > [새 배포] > 유형: 웹앱
 *    - 실행할 사용자: 나
 *    - 액세스 권한이 있는 사용자: 모든 사용자
 * 4) 배포 후 나오는 URL(...../exec)을 config.js 의 CLICK_LOG_URL 에 붙여넣기
 * ------------------------------------------------------------
 * 동작 방식: index.html에서 식당 클릭 시 이 스크립트에 GET 요청을 보내면,
 * "클릭수" 라는 이름의 시트 탭에 식당명 | 클릭수 | 최근클릭일시 를 자동 기록/누적합니다.
 * 이 시트는 소유자인 나만 열람 가능하므로 별도 관리자 화면이 필요 없습니다.
 * ============================================================
 */

const CLICK_SHEET_NAME = "클릭수";

function doGet(e) {
  const name = (e.parameter.name || "").trim();
  if (!name) {
    return ContentService.createTextOutput("no name param");
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CLICK_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CLICK_SHEET_NAME);
    sheet.appendRow(["식당명", "클릭수", "최근 클릭 일시"]);
    sheet.setFrozenRows(1);
  }

  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === name) {
      rowIndex = i + 1; // 1-indexed for Sheets API
      break;
    }
  }

  const now = new Date();
  if (rowIndex === -1) {
    sheet.appendRow([name, 1, now]);
  } else {
    const currentCount = sheet.getRange(rowIndex, 2).getValue() || 0;
    sheet.getRange(rowIndex, 2).setValue(currentCount + 1);
    sheet.getRange(rowIndex, 3).setValue(now);
  }

  return ContentService.createTextOutput("ok");
}
