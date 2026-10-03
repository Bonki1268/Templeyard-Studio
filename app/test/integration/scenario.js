// 整合測試用的流程捷徑：建立系列與影片，並推進到指定步驟。
const { makeImage } = require('../fixtures');

const STORY = '老一輩說，當年移民渡海來台，帶著定光古佛的香火在淡水落腳。後來才有了這座廟。小晴想把這段故事說給第一次來淡水的人聽。';

async function videoAtStep(s, step, { duration = 30, characters = [{ name: '導覽員小晴', description: '30 歲左右女性，及肩黑髮' }] } = {}) {
  const series = (await s.post('/api/series', { name: '淡水廟宇故事', style: '溫暖寫實', duration, direction: '在地歷史故事', characters })).data.series;
  const video = (await s.post(`/api/series/${series.id}/videos`, {})).data.video;
  const base = `/api/videos/${video.id}`;
  const ok = (r, what) => { if (r.status >= 300) throw new Error(`${what} 失敗：${r.status} ${JSON.stringify(r.data.error)}`); return r; };
  if (step >= 3) {
    const templeId = (await s.get(`/api/temples?q=${encodeURIComponent('鄞山寺')}`)).data.items[0].id;
    ok(await s.put(`${base}/temple`, { templeId }), '選寺廟');
    const img = await makeImage();
    for (const name of ['廟宇正面.jpg', '廟埕石獅.jpg']) {
      ok(await s.request('POST', `${base}/photos`, img.buffer, { 'Content-Type': 'image/jpeg', 'X-Filename': encodeURIComponent(name) }), '上傳照片');
    }
    ok(await s.put(`${base}/story`, { text: STORY }), '故事');
    ok(await s.post(`${base}/steps/2/confirm`), '確認步驟 2');
  }
  if (step >= 4) {
    ok(await s.post(`${base}/script/generate`, {}), '產生腳本');
    ok(await s.post(`${base}/steps/3/confirm`), '確認步驟 3');
  }
  if (step >= 5) {
    ok(await s.post(`${base}/characters/generate`, {}), '產生角色');
    ok(await s.post(`${base}/steps/4/confirm`), '確認步驟 4');
  }
  if (step >= 6) {
    ok(await s.post(`${base}/frames/generate`, {}), '產生精緻圖');
    await s.app.ctx.jobs.idle();
    ok(await s.post(`${base}/steps/5/confirm`), '確認步驟 5');
  }
  return { series, videoId: video.id, base, video: (await s.get(base)).data.video };
}

module.exports = { videoAtStep, STORY };
