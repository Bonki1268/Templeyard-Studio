const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startApp } = require('../helpers');
const { videoAtStep } = require('./scenario');
const { PRICES } = require('../../src/cost/prices');

test('步驟 5 API', async t => {
  const s = await startApp();
  t.after(() => s.close());
  const { base, videoId } = await videoAtStep(s, 5);
  const { jobs, config, ai } = s.app.ctx;
  let video;

  await t.test('場景：產生精緻圖前先看到預估費用', async () => {
    const r = await s.get(`${base}/estimate/frames`);
    assert.equal(r.data.count, 10);
    assert.equal(r.data.estimate, +(10 * PRICES.image.perImage).toFixed(4));
  });

  await t.test('場景：每格都選定精緻圖後才能確認', async () => {
    const r = await s.post(`${base}/steps/5/confirm`);
    assert.equal(r.status, 422);
    assert.match(r.data.error.unmet[0], /第 1、2、3/);
  });

  await t.test('場景：逐格產生精緻圖並回報進度', async () => {
    const r = await s.post(`${base}/frames/generate`, {});
    assert.equal(r.status, 202);
    const statuses = Object.values(r.data.video.frames).map(f => f.status);
    assert.equal(statuses.length, 10);
    assert.ok(statuses.every(st => ['queued', 'running'].includes(st)));
    await jobs.idle();
    const p = (await s.get(`${base}/frames`)).data;
    assert.deepEqual(p.progress, { total: 10, done: 10, running: 0, queued: 0, failed: 0 });
    video = (await s.get(base)).data.video;
    for (const shot of video.script.shots) {
      const f = video.frames[shot.id];
      assert.equal(f.status, 'done');
      assert.equal(f.candidates.length, 1);
      assert.equal(f.selected, f.candidates[0].id);
      assert.ok(f.candidates[0].url);
    }
  });

  await t.test('場景：產生精緻圖時只送出去識別後的照片與鎖定版本的定裝圖', async () => {
    const calls = ai.calls.filter(c => c.kind === 'image' && c.request.promptId === 'refined-frame');
    assert.equal(calls.length, 10);
    const stored = s.app.ctx.store.get('videos', videoId);
    const character = stored.characters[0];
    const costume = character.versions.find(x => x.version === character.lockedVersion).images.costume.file;
    for (const call of calls) {
      for (const ref of call.refs) {
        assert.ok(ref.startsWith(config.mediaDir + path.sep), `參考圖必須在 media 資料夾：${ref}`);
        assert.ok(!ref.includes(`${path.sep}private${path.sep}`));
      }
      assert.ok(call.refs.includes(path.join(config.mediaDir, costume)), '應帶入鎖定版本的定裝圖');
    }
    const shot1 = stored.script.shots[0];
    const photo = stored.photos.filter(p => p.status === 'ready')[shot1.photoIndex - 1];
    assert.ok(calls.some(c => c.refs.includes(path.join(config.mediaDir, photo.file))), '應帶入對應的去識別照片');
  });

  await t.test('場景：單張依指令重生產生新的候選版本', async () => {
    const shot = video.script.shots[1];
    const r = await s.post(`${base}/frames/${shot.id}/regenerate`, { instruction: '光線再暖一點' });
    assert.equal(r.status, 202);
    await jobs.idle();
    const f = (await s.get(base)).data.video.frames[shot.id];
    assert.equal(f.candidates.length, 2);
    assert.equal(f.selected, f.candidates[1].id);
    assert.equal(f.candidates[1].instruction, '光線再暖一點');
    assert.notEqual(f.candidates[1].file, f.candidates[0].file);
  });

  await t.test('場景：選定候選版本', async () => {
    const shot = video.script.shots[1];
    const first = (await s.get(base)).data.video.frames[shot.id].candidates[0];
    const r = await s.request('PATCH', `${base}/frames/${shot.id}`, { selected: first.id });
    assert.equal(r.data.video.frames[shot.id].selected, first.id);
    const bad = await s.request('PATCH', `${base}/frames/${shot.id}`, { selected: 'nope' });
    assert.equal(bad.status, 422);
  });

  await t.test('場景：記錄品質檢查結果', async () => {
    const shot = video.script.shots[1];
    const quality = { face: true, temple: true, hands: false, people: true };
    const r = await s.request('PATCH', `${base}/frames/${shot.id}`, { quality });
    assert.deepEqual(r.data.video.frames[shot.id].quality, quality);
  });

  await t.test('場景：生成失敗的格子標示失敗並退回費用，可以再重生', async () => {
    const shot = video.script.shots[4];
    const spentBefore = s.app.ctx.ledger.summary(videoId).spent;
    ai.failNext('image', '圖片服務暫時無法使用');
    await s.post(`${base}/frames/${shot.id}/regenerate`, {});
    await jobs.idle();
    let f = (await s.get(base)).data.video.frames[shot.id];
    assert.equal(f.status, 'failed');
    assert.match(f.error, /圖片服務暫時無法使用/);
    const sum = s.app.ctx.ledger.summary(videoId);
    assert.equal(sum.spent, spentBefore);
    assert.equal(sum.reserved, 0);
    await s.post(`${base}/frames/${shot.id}/regenerate`, {});
    await jobs.idle();
    f = (await s.get(base)).data.video.frames[shot.id];
    assert.equal(f.status, 'done');
    assert.ok(f.selected);
  });

  await t.test('場景：每格都選定精緻圖後才能確認（通過）', async () => {
    const r = await s.post(`${base}/steps/5/confirm`);
    assert.equal(r.status, 200);
    assert.equal(r.data.video.currentStep, 6);
  });
});
