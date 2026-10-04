const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers');

const seriesInput = { name: '淡水廟宇故事', style: '溫暖寫實・黃昏自然光', duration: 30, direction: '在地歷史故事', characters: [{ name: '導覽員小晴', description: '30 歲女性' }] };

test('影片 API', async t => {
  const s = await startApp();
  t.after(() => s.close());
  const seriesId = (await s.post('/api/series', seriesInput)).data.series.id;
  let videoId;

  await t.test('場景：在系列中新增影片', async () => {
    const r = await s.post(`/api/series/${seriesId}/videos`, {});
    assert.equal(r.status, 201);
    const v = r.data.video;
    videoId = v.id;
    assert.equal(v.currentStep, 2);
    assert.equal(v.status, 'in_progress');
    assert.equal(v.seriesId, seriesId);
    assert.equal(v.series.duration, 30);
    assert.equal(v.series.style, '溫暖寫實・黃昏自然光');
    assert.deepEqual(v.series.characters.map(c => c.name), ['導覽員小晴']);
    assert.equal(v.costCap, 20);
    assert.equal(v.steps[1].status, 'confirmed');
    for (const step of [2, 3, 4, 5, 6]) assert.equal(v.steps[step].status, 'pending');
    const got = await s.get(`/api/videos/${videoId}`);
    assert.equal(got.data.video.id, videoId);
    assert.equal(got.data.cost.cap, 20);
    const list = await s.get('/api/series');
    assert.equal(list.data.series[0].videoCount, 1);
    const page = await s.get(`/api/series/${seriesId}`);
    assert.equal(page.data.videos.length, 1);
    assert.equal((await s.post('/api/series/none/videos', {})).status, 404);
  });

  await t.test('場景：修改系列設定不影響已建立的影片', async () => {
    await s.put(`/api/series/${seriesId}`, { duration: 20 });
    const newer = (await s.post(`/api/series/${seriesId}/videos`, {})).data.video;
    assert.equal(newer.series.duration, 20);
    assert.equal((await s.get(`/api/videos/${videoId}`)).data.video.series.duration, 30);
  });

  await t.test('場景：未確認前一步不能確認下一步', async () => {
    const r = await s.post(`/api/videos/${videoId}/steps/3/confirm`);
    assert.equal(r.status, 409);
    assert.equal(r.data.error.code, 'previous_step_not_confirmed');
    assert.match(r.data.error.message, /步驟 2/);
  });

  await t.test('場景：確認條件未滿足時拒絕確認並列出原因', async () => {
    const r = await s.post(`/api/videos/${videoId}/steps/2/confirm`);
    assert.equal(r.status, 422);
    assert.equal(r.data.error.code, 'conditions_not_met');
    assert.equal(r.data.error.unmet.length, 3);
    assert.ok(r.data.error.unmet.some(u => /寺廟/.test(u)));
    assert.ok(r.data.error.unmet.some(u => /照片/.test(u)));
    assert.ok(r.data.error.unmet.some(u => /故事/.test(u)));
  });

  await t.test('場景：被取代的版本與確認紀錄保存在歷史中', async () => {
    const { videos, store } = s.app.ctx;
    // 直接用服務層模擬步驟 2 的內容（步驟 2 的 API 在之後的步驟實作）
    videos.mutate(videoId, 2, v => {
      v.templeId = 't1'; v.photos = [{ id: 'p1', status: 'ready' }]; v.story = { original: '故事', adopted: '故事' };
    });
    const confirmed = await s.post(`/api/videos/${videoId}/steps/2/confirm`);
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.data.video.currentStep, 3);
    videos.mutate(videoId, 2, v => { v.story.adopted = '改過的故事'; });
    const v = (await s.get(`/api/videos/${videoId}`)).data.video;
    assert.equal(v.steps[2].status, 'pending');
    assert.equal(v.currentStep, 2);
    const history = store.history('videos', videoId);
    assert.ok(history.some(h => h.story?.adopted === '故事'));
    const recs = (await s.get(`/api/videos/${videoId}/confirmations`)).data.confirmations;
    assert.equal(recs.length, 1);
    assert.equal(recs[0].step, 2);
    assert.equal(recs[0].content.story.adopted, '故事');
  });
});
