const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers');
const { makeImage } = require('../fixtures');

const seriesInput = { name: '淡水廟宇故事', style: '溫暖寫實', styleNote: '淺景深', duration: 30, direction: '在地歷史故事' };
const STORY = '老一輩說，當年移民渡海來台，帶著定光古佛的香火在淡水落腳。後來才有了這座廟。';

async function setup(t) {
  const s = await startApp();
  t.after(() => s.close());
  const seriesId = (await s.post('/api/series', seriesInput)).data.series.id;
  const videoId = (await s.post(`/api/series/${seriesId}/videos`, {})).data.video.id;
  const templeId = (await s.get(`/api/temples?q=${encodeURIComponent('鄞山寺')}`)).data.items[0].id;
  return { s, videoId, templeId, base: `/api/videos/${videoId}` };
}

test('步驟 2 API', async t => {
  const { s, videoId, templeId, base } = await setup(t);

  await t.test('場景：尚未選寺廟或故事空白時不能潤飾', async () => {
    const r = await s.post(`${base}/story/polish`, {});
    assert.equal(r.status, 422);
    assert.match(r.data.error.message, /先選擇寺廟/);
  });

  await t.test('場景：選定寺廟後帶入寺廟資料', async () => {
    const r = await s.put(`${base}/temple`, { templeId });
    assert.equal(r.status, 200);
    const tp = r.data.video.temple;
    assert.equal(r.data.video.templeId, templeId);
    assert.equal(tp.name, '鄞山寺');
    assert.equal(tp.address, '新北市淡水區鄧公里鄧公路15號');
    assert.equal(tp.deity, '定光古佛');
    assert.equal(tp.religion, '佛教');
    assert.equal(tp.builtYear, 1824);
    assert.equal((await s.put(`${base}/temple`, { templeId: 'none' })).status, 404);
    const noStory = await s.post(`${base}/story/polish`, {});
    assert.match(noStory.data.error.message, /故事/);
  });

  await t.test('場景：使用者可以貼上寺廟的歷史與簡介', async () => {
    const r = await s.put(`${base}/temple-history`, { text: '清道光年間由汀州移民興建。' });
    assert.equal(r.data.video.templeHistory, '清道光年間由汀州移民興建。');
    const temple = (await s.get(`/api/temples/${templeId}`)).data.temple;
    assert.ok(!('history' in temple));
  });

  await t.test('場景：輸入故事後採用版預設為原文', async () => {
    const r = await s.put(`${base}/story`, { text: STORY });
    assert.equal(r.data.video.story.original, STORY);
    assert.equal(r.data.video.story.adopted, STORY);
    assert.equal(r.data.video.story.choice, 'original');
  });

  await t.test('場景：AI 潤飾故事並可以採用潤飾版', async () => {
    const r = await s.post(`${base}/story/polish`, {});
    assert.equal(r.status, 200);
    const story = r.data.video.story;
    assert.ok(story.polished.text);
    assert.notEqual(story.polished.text, '');
    assert.ok(story.polished.generationId);
    assert.equal(story.adopted, STORY);
    const a = await s.post(`${base}/story/adopt`, { choice: 'polished' });
    assert.equal(a.data.video.story.adopted, story.polished.text);
    assert.equal(a.data.video.story.choice, 'polished');
  });

  await t.test('場景：保留原文', async () => {
    const r = await s.post(`${base}/story/adopt`, { choice: 'original' });
    assert.equal(r.data.video.story.adopted, STORY);
    assert.equal(r.data.video.story.choice, 'original');
  });

  await t.test('場景：修改潤飾版後採用', async () => {
    const r = await s.post(`${base}/story/adopt`, { choice: 'edited', text: '我改過的潤飾版。' });
    assert.equal(r.data.video.story.adopted, '我改過的潤飾版。');
    assert.equal(r.data.video.story.choice, 'edited');
    assert.equal((await s.post(`${base}/story/adopt`, { choice: 'edited', text: ' ' })).status, 422);
  });

  await t.test('場景：AI 潤飾只使用寺廟資料與使用者輸入', async () => {
    await s.post(`${base}/story/polish`, { instruction: '語氣再口語一點' });
    const gens = (await s.get(`/api/generations?videoId=${videoId}`)).data.generations.filter(g => g.promptId === 'copy-polish');
    const last = gens.at(-1);
    assert.deepEqual(Object.keys(last.input).sort(), ['instruction', 'series', 'story', 'temple']);
    assert.deepEqual(Object.keys(last.input.temple).sort(), ['address', 'builtYear', 'deity', 'district', 'history', 'name', 'religion']);
    assert.equal(last.input.temple.history, '清道光年間由汀州移民興建。');
    assert.equal(last.input.story, STORY);
    assert.equal(last.instruction, '語氣再口語一點');
    const call = s.app.ctx.ai.calls.filter(c => c.kind === 'text').at(-1);
    assert.match(call.request.system, /不可自行補寫歷史/);
    assert.match(call.request.messages[0].content, /清道光年間由汀州移民興建/);
  });

  await t.test('場景：步驟 2 條件都滿足後可以確認並進入步驟 3', async () => {
    const img = await makeImage();
    await s.request('POST', `${base}/photos`, img.buffer, { 'Content-Type': 'image/jpeg', 'X-Filename': 'front.jpg' });
    const r = await s.post(`${base}/steps/2/confirm`);
    assert.equal(r.status, 200);
    assert.equal(r.data.video.currentStep, 3);
    assert.equal(r.data.video.steps[2].status, 'confirmed');
  });
});
