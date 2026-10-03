const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers');
const { videoAtStep, STORY } = require('./scenario');
const { PRICES } = require('../../src/cost/prices');

test('步驟 3 API', async t => {
  const s = await startApp();
  t.after(() => s.close());
  const { videoId, base } = await videoAtStep(s, 3);
  let script;

  await t.test('場景：產生腳本前先看到預估費用', async () => {
    const r = await s.get(`${base}/estimate/script`);
    assert.equal(r.status, 200);
    assert.equal(r.data.shotCount, 10);
    assert.equal(r.data.estimate, +(PRICES.text.perCall + 10 * PRICES.image.perImage).toFixed(4));
  });

  await t.test('場景：以廣告編劇角度產生腳本並拆成分鏡', async () => {
    const r = await s.post(`${base}/script/generate`, {});
    assert.equal(r.status, 200);
    script = r.data.video.script;
    assert.ok(script.adCopy);
    assert.equal(script.version, 1);
    assert.equal(script.shots.length, 10);
    assert.equal(script.shots.reduce((sum, x) => sum + x.seconds, 0), 30);
    for (const shot of script.shots) {
      assert.ok(shot.id);
      assert.ok(shot.storyboard.url, `第 ${shot.index} 格缺分鏡圖`);
      for (const k of ['scene', 'shotSize', 'composition', 'camera', 'transition', 'intent', 'narrativeRole', 'action', 'line', 'speaker', 'subtitle']) assert.ok(shot[k], `第 ${shot.index} 格缺 ${k}`);
    }
    assert.equal(r.data.video.title, script.title);
    const gen = (await s.get(`/api/generations?videoId=${videoId}`)).data.generations.find(g => g.promptId === 'story-script');
    assert.equal(gen.input.story, STORY);
    assert.equal(gen.input.temple.name, '鄞山寺');
    assert.equal(gen.input.series.duration, 30);
    assert.equal(gen.input.series.direction, '在地歷史故事');
    assert.match(gen.input.characters, /導覽員小晴/);
    assert.match(gen.input.photos, /廟宇正面/);
    const images = (await s.get(`/api/generations?videoId=${videoId}`)).data.generations.filter(g => g.promptId === 'storyboard-image');
    assert.equal(images.length, 10);
  });

  await t.test('場景：手動修改單格的分鏡說明', async () => {
    const shot = script.shots[1];
    const r = await s.request('PATCH', `${base}/script/shots/${shot.id}`, { shotSize: '特寫', seconds: 2.5, line: '這座廟，藏著老一輩才知道的故事。' });
    assert.equal(r.status, 200);
    const next = r.data.video.script;
    assert.equal(next.shots[1].shotSize, '特寫');
    assert.equal(next.shots[1].seconds, 2.5);
    assert.equal(next.shots[1].line, '這座廟，藏著老一輩才知道的故事。');
    assert.deepEqual(next.shots[0], script.shots[0]);
    const bad = await s.request('PATCH', `${base}/script/shots/${shot.id}`, { seconds: -1 });
    assert.equal(bad.status, 422);
    await s.request('PATCH', `${base}/script/shots/${shot.id}`, { seconds: shot.seconds });
    script = (await s.get(base)).data.video.script;
  });

  await t.test('場景：單格重生分鏡說明與分鏡圖', async () => {
    const target = script.shots[2];
    const r = await s.post(`${base}/script/shots/${target.id}/regenerate`, { instruction: '改成黃昏的屋脊特寫' });
    assert.equal(r.status, 200);
    const next = r.data.video.script;
    assert.notEqual(next.shots[2].storyboard.file, target.storyboard.file);
    assert.equal(next.shots[2].id, target.id);
    assert.equal(next.shots[2].index, 3);
    assert.equal(next.shots[2].seconds, target.seconds, '秒數維持不變，總長度不受影響');
    for (const i of [0, 1, 3, 4]) assert.deepEqual(next.shots[i], script.shots[i]);
    const gens = (await s.get(`/api/generations?videoId=${videoId}`)).data.generations;
    assert.ok(gens.some(g => g.instruction === '改成黃昏的屋脊特寫' && g.shotId === target.id));
    script = next;
  });

  await t.test('場景：依指令重新產生整份腳本並保留舊版', async () => {
    const r = await s.post(`${base}/script/generate`, { instruction: '開頭節奏再快一點' });
    const next = r.data.video.script;
    assert.equal(next.version, 2);
    assert.equal(next.instruction, '開頭節奏再快一點');
    assert.equal(r.data.video.scriptVersions.length, 1);
    assert.equal(r.data.video.scriptVersions[0].version, 1);
  });

  await t.test('場景：分鏡總長度不符系列秒數時不能確認', async () => {
    const shot = (await s.get(base)).data.video.script.shots[0];
    await s.request('PATCH', `${base}/script/shots/${shot.id}`, { seconds: shot.seconds + 2 });
    const r = await s.post(`${base}/steps/3/confirm`);
    assert.equal(r.status, 422);
    assert.ok(r.data.error.unmet.some(u => /總長度/.test(u)));
    await s.request('PATCH', `${base}/script/shots/${shot.id}`, { seconds: shot.seconds });
  });

  await t.test('場景：每格都有說明且總長度符合時可以確認', async () => {
    const r = await s.post(`${base}/steps/3/confirm`);
    assert.equal(r.status, 200);
    assert.equal(r.data.video.currentStep, 4);
  });
});
