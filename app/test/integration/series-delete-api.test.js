// 刪除系列：從清單與網址移除，資料保存在歷史中。
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers');

const valid = { name: '淡水廟宇故事', style: '溫暖寫實・黃昏自然光', duration: 30, direction: '在地歷史故事' };

test('刪除系列 API', async t => {
  const s = await startApp();
  t.after(() => s.close());

  await t.test('場景：刪除系列', async () => {
    const series = (await s.post('/api/series', valid)).data.series;
    const r = await s.del(`/api/series/${series.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.deleted.series, series.id);
    assert.ok(!(await s.get('/api/series')).data.series.some(x => x.id === series.id));
    assert.equal((await s.get(`/api/series/${series.id}`)).status, 404);
    const history = s.app.ctx.store.history('series', series.id);
    assert.ok(history.some(h => h.name === '淡水廟宇故事' && !h.deletedAt), '刪除前的設定要保存在歷史中');
    assert.equal((await s.del(`/api/series/${series.id}`)).status, 404);
    assert.equal((await s.del('/api/series/nope')).status, 404);
  });

  await t.test('場景：刪除系列時一併刪除它的影片', async () => {
    const a = (await s.post('/api/series', valid)).data.series;
    const b = (await s.post('/api/series', { ...valid, name: '新莊廟街' })).data.series;
    const va = (await s.post(`/api/series/${a.id}/videos`, {})).data.video;
    const vb = (await s.post(`/api/series/${b.id}/videos`, {})).data.video;
    const r = await s.del(`/api/series/${a.id}`);
    assert.equal(r.data.deleted.videos, 1);
    assert.equal((await s.get(`/api/videos/${va.id}`)).status, 404);
    assert.equal((await s.get(`/api/videos/${vb.id}`)).status, 200);
    assert.equal((await s.get(`/api/series/${b.id}`)).data.videos.length, 1);
  });
});
