// E2E 共用：用 API 快速建立資料，用 ffmpeg 產生測試照片。
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

function testPhoto(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-photo-'));
  const file = path.join(dir, name);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=1', '-frames:v', '1', file]);
  return file;
}

async function createSeries(request, overrides = {}) {
  const res = await request.post('/api/series', {
    data: { name: '淡水廟宇故事', style: '溫暖寫實・黃昏自然光', duration: 30, direction: '在地歷史故事',
      characters: [{ name: '導覽員小晴', description: '30 歲左右女性，及肩黑髮' }], ...overrides },
  });
  return (await res.json()).series;
}

async function createVideo(request, seriesId) {
  const res = await request.post(`/api/series/${seriesId}/videos`, { data: {} });
  return (await res.json()).video;
}

module.exports = { testPhoto, createSeries, createVideo };
