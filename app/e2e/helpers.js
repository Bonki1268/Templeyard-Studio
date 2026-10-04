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

const STORY = '老一輩說，當年移民渡海來台，帶著定光古佛的香火在淡水落腳。後來才有了這座廟。';

// 用 API 把影片推進到指定步驟（各步驟的 UI 測試從這裡開始）。
async function videoAtStep(request, step, seriesOverrides = {}) {
  const series = await createSeries(request, seriesOverrides);
  const video = await createVideo(request, series.id);
  const base = `/api/videos/${video.id}`;
  const must = async (res, what) => { if (!res.ok()) throw new Error(`${what}：${res.status()} ${await res.text()}`); return res; };
  if (step >= 3) {
    const temples = await (await request.get(`/api/temples?q=${encodeURIComponent('鄞山寺')}`)).json();
    await must(await request.put(`${base}/temple`, { data: { templeId: temples.items[0].id } }), '選寺廟');
    for (const name of ['廟宇正面.jpg', '廟埕石獅.jpg']) {
      await must(await request.post(`${base}/photos`, { data: fs.readFileSync(testPhoto(name)), headers: { 'Content-Type': 'image/jpeg', 'X-Filename': encodeURIComponent(name) } }), '上傳照片');
    }
    await must(await request.put(`${base}/story`, { data: { text: STORY } }), '故事');
    await must(await request.post(`${base}/steps/2/confirm`), '確認步驟 2');
  }
  if (step >= 4) {
    await must(await request.post(`${base}/script/generate`, { data: {} }), '產生腳本');
    await must(await request.post(`${base}/steps/3/confirm`), '確認步驟 3');
  }
  if (step >= 5) {
    await must(await request.post(`${base}/characters/generate`, { data: {} }), '產生角色');
    await must(await request.post(`${base}/steps/4/confirm`), '確認步驟 4');
  }
  if (step >= 6) {
    await must(await request.post(`${base}/frames/generate`, { data: {} }), '產生精緻圖');
    for (let i = 0; i < 100; i++) {
      const v = (await (await request.get(base)).json()).video;
      if (v.script.shots.every(s => v.frames[s.id]?.selected)) break;
      await new Promise(r => setTimeout(r, 200));
    }
    await must(await request.post(`${base}/steps/5/confirm`), '確認步驟 5');
  }
  return { series, video, base };
}

module.exports.videoAtStep = videoAtStep;
module.exports.STORY = STORY;
