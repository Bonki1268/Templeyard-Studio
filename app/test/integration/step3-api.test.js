const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startApp, tempDir } = require('../helpers');
const { videoAtStep } = require('./scenario');
const { PRICES } = require('../../src/cost/prices');

test('步驟 3 API：寺廟背景板', async t => {
  const s = await startApp();
  t.after(() => s.close());
  const { ai, config } = s.app.ctx;
  const { base, videoId } = await videoAtStep(s, 3);
  let first;

  await t.test('場景：確認新增影片後進入寺廟背景板步驟', async () => {
    const v = (await s.get(base)).data.video;
    assert.equal(v.currentStep, 3);
    assert.equal(v.templeBoard, null);
    const r = await s.post(`${base}/script/generate`, {});
    assert.equal(r.status, 409);
    assert.equal(r.data.error.code, 'previous_step_not_confirmed');
  });

  await t.test('場景：產生寺廟背景板前先看到預估費用', async () => {
    const r = await s.get(`${base}/estimate/temple-board`);
    assert.equal(r.data.estimate, PRICES.image.perImage);
  });

  await t.test('場景：沒有背景板時不能確認步驟 3', async () => {
    const r = await s.post(`${base}/steps/3/confirm`);
    assert.equal(r.status, 422);
    assert.ok(r.data.error.unmet.includes('尚未產生寺廟背景板'));
  });

  await t.test('場景：以去識別後的照片產生四格寺廟背景板', async () => {
    const before = ai.calls.length;
    const r = await s.post(`${base}/temple-board/generate`, {});
    assert.equal(r.status, 200);
    const board = r.data.video.templeBoard;
    assert.equal(board.versions.length, 1);
    assert.equal(board.selectedVersion, 1);
    assert.ok(board.versions[0].image.url);
    first = board.versions[0];
    const call = ai.calls.slice(before).find(c => c.kind === 'image');
    const photos = r.data.video.photos.filter(p => p.status === 'ready');
    assert.equal(call.refs.length, photos.length);
    for (const ref of call.refs) {
      assert.ok(ref.startsWith(config.mediaDir + path.sep), `參考圖必須在 media 資料夾：${ref}`);
      assert.ok(!ref.includes(`${path.sep}private${path.sep}`));
    }
    const prompt = [call.request.system, call.request.messages[0].content].join('\n');
    for (const word of ['2×2', '正面全景', '斜角／側面', '廟埕與周邊環境', '特色細節', '沒有任何人']) assert.ok(prompt.includes(word), `指令缺少「${word}」`);
    const gens = (await s.get(`/api/generations?videoId=${videoId}`)).data.generations.filter(g => g.promptId === 'temple-board');
    assert.equal(gens.length, 1);
    assert.equal(gens[0].step, 3);
  });

  await t.test('場景：依指令重新產生背景板並保留舊版本', async () => {
    const r = await s.post(`${base}/temple-board/generate`, { instruction: '天色改成黃昏' });
    const board = r.data.video.templeBoard;
    assert.equal(board.versions.length, 2);
    assert.equal(board.selectedVersion, 2);
    assert.equal(board.versions[1].instruction, '天色改成黃昏');
    assert.notEqual(board.versions[1].image.file, first.image.file);
    const back = await s.request('PATCH', `${base}/temple-board`, { selectedVersion: 1 });
    assert.equal(back.data.video.templeBoard.selectedVersion, 1);
    assert.equal((await s.request('PATCH', `${base}/temple-board`, { selectedVersion: 9 })).status, 422);
  });

  await t.test('場景：修改步驟 2 後背景板需重新確認', async () => {
    assert.equal((await s.post(`${base}/steps/3/confirm`)).status, 200);
    await s.put(`${base}/story`, { text: '改寫後的故事：小晴帶大家認識這座廟。' });
    const v = (await s.get(base)).data.video;
    assert.equal(v.steps[3].status, 'stale');
    assert.equal(v.currentStep, 2);
  });
});

test('精緻圖使用寺廟背景板', async t => {
  const s = await startApp();
  t.after(() => s.close());
  const { ai, config, store } = s.app.ctx;

  await t.test('場景：精緻圖以選用的寺廟背景板作為場景參考', async () => {
    const { base, videoId } = await videoAtStep(s, 6);
    const v = store.get('videos', videoId);
    const board = path.join(config.mediaDir, v.templeBoard.versions.find(x => x.version === v.templeBoard.selectedVersion).image.file);
    const before = ai.calls.length;
    await s.post(`${base}/frames/generate`, {});
    await s.app.ctx.jobs.idle();
    const calls = ai.calls.slice(before).filter(c => c.request?.promptId === 'refined-frame');
    assert.ok(calls.length > 0);
    assert.ok(calls.every(c => c.refs.includes(board)), '每格都要帶入寺廟背景板');
  });
});

test('舊資料升級', async t => {
  await t.test('場景：既有影片升級為 7 個步驟', async () => {
    const dataDir = tempDir();
    const s1 = await startApp({ dataDir });
    const { videoId } = await videoAtStep(s1, 5);
    // 改寫成舊版 6 個步驟的資料：步驟 2、3（舊編號的故事腳本）已確認，停在 4（角色設計）。
    s1.app.ctx.store.update('videos', videoId, v => {
      const st = n => ({ status: 'confirmed', rev: 1, confirmedRev: 1, n });
      v.steps = { 1: st(1), 2: st(2), 3: st(3), 4: { status: 'pending', rev: 0, confirmedRev: null }, 5: { status: 'pending', rev: 0, confirmedRev: null }, 6: { status: 'pending', rev: 0, confirmedRev: null } };
      v.currentStep = 4;
      delete v.templeBoard;
    });
    await s1.close();

    const s2 = await startApp({ dataDir });
    try {
      const v = (await s2.get(`/api/videos/${videoId}`)).data.video;
      assert.deepEqual(Object.keys(v.steps).map(Number), [1, 2, 3, 4, 5, 6, 7]);
      assert.equal(v.steps[3].status, 'confirmed');
      assert.equal(v.steps[3].skipped, true);
      assert.equal(v.steps[4].n, 3, '舊的步驟 3（故事腳本）移到步驟 4');
      assert.equal(v.steps[4].status, 'confirmed');
      assert.equal(v.steps[5].status, 'pending');
      assert.equal(v.steps[7].status, 'pending');
      assert.equal(v.currentStep, 5, '仍停在角色設計（新編號 5）');
      assert.equal(v.templeBoard, null);
    } finally { await s2.close(); }
  });
});
