// server.js
const express = require('express');
const { google } = require('googleapis');
const path = require('path');

const app = express();

// 1. 구글 비밀 열쇠(credentials.json)로 안전하게 인증 설정
const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, 'credentials.json'), 
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

// 2. 브라우저가 /api/get-sheet-data 주소로 요청을 보내면 실행되는 구간
app.get('/api/get-sheet-data', async (req, res) => {
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    
    // 내 구글 시트 ID (구글시트 URL 중 /d/ 와 /edit 사이의 길다란 문자열)
    const spreadsheetId = '19n0gfR3uNBo6AuKYLOvvdTb_MWgaC20gZUsM6JnKffA'; 
    const range = 'Sheet1!A1:Z100'; // 가져올 시트 이름과 범위

    // 백엔드 서버가 구글 시트에 안전하게 접근해 데이터를 가져옴
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    // 사용자에게 정제된 데이터만 전송 (구글 시트 주소나 키는 전혀 포함되지 않음)
    res.json({ success: true, data: response.data.values });
  } catch (error) {
    console.error('구글 시트 불러오기 에러:', error);
    res.status(500).json({ success: false, message: '서버 에러 발생' });
  }
});

// 서버 실행 (3000번 포트)
app.listen(3000, () => {
  console.log('보안 백엔드 서버가 http://localhost:3000 에서 실행 중입니다.');
});
