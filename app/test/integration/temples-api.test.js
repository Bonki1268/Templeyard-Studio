const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers');

test('寺廟搜尋 API', async t => {
  const s = await startApp();
  t.after(() => s.close());
  const search = async (q, extra = '') => (await s.get(`/api/temples?q=${encodeURIComponent(q)}${extra}`)).data;

  await t.test('場景：以廟名搜尋寺廟', async () => {
    const r = await search('鄞山寺');
    assert.equal(r.items[0].name, '鄞山寺');
    assert.equal(r.items[0].district, '淡水區');
    assert.equal(r.items[0].deity, '定光古佛');
    assert.equal(r.items[0].builtYear, 1824);
  });

  await t.test('場景：以行政區搜尋寺廟', async () => {
    const r = await search('淡水', '&limit=500');
    assert.ok(r.total > 10);
    assert.equal(r.items.length, r.total);
    assert.ok(r.items.every(t => t.district === '淡水區' || t.name.includes('淡水') || (t.address || '').includes('淡水')));
    const all = await search('淡水區', '&limit=500');
    assert.ok(all.items.every(t => t.district === '淡水區'));
  });

  await t.test('場景：以主祀神明搜尋寺廟', async () => {
    const r = await search('定光古佛');
    assert.ok(r.total >= 1);
    assert.ok(r.items.every(t => t.deity === '定光古佛'));
  });

  await t.test('場景：臺與台混用也能找到', async () => {
    const a = await search('臺北縣');
    const b = await search('台北縣');
    assert.deepEqual(a.items.map(t => t.id), b.items.map(t => t.id));
    const c = await search('台灣全真仙觀', '&includeInactive=1');
    assert.equal(c.total, 1);
  });

  await t.test('場景：不輸入財團法人前綴也能找到', async () => {
    const r = await search('金山慈音寺');
    assert.ok(r.items.some(t => t.name === '財團法人新北市金山慈音寺'));
    assert.equal(r.items[0].label, '金山慈音寺');
  });

  await t.test('場景：已廢止的寺廟預設不出現在搜尋結果', async () => {
    const r = await search('萬壽宮');
    assert.ok(r.items.every(t => !t.flags.abolished));
    assert.ok(r.excluded >= 1);
    const withInactive = await search('萬壽宮', '&includeInactive=1');
    assert.ok(withInactive.items.some(t => t.flags.abolished));
  });

  await t.test('場景：重名寺廟以行政區區分', async () => {
    const r = await search('福安宮');
    assert.ok(r.items.length > 1);
    for (const t of r.items.filter(t => t.flags.duplicateName)) {
      assert.equal(t.label, `${t.displayName}（${t.district}）`);
    }
  });

  await t.test('場景：讀取單一寺廟的完整資料', async () => {
    const id = (await search('鄞山寺')).items[0].id;
    const r = await s.get(`/api/temples/${id}`);
    assert.equal(r.status, 200);
    const tp = r.data.temple;
    assert.equal(tp.address, '新北市淡水區鄧公里鄧公路15號');
    assert.equal(tp.religion, '佛教');
    assert.equal(tp.builtRaw, '民前88');
    assert.equal(tp.phone, '0226295517');
    assert.equal((await s.get('/api/temples/不存在')).status, 404);
  });
});
