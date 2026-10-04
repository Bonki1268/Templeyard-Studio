const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startApp } = require('../helpers');
const { videoAtStep } = require('./scenario');
const { probe } = require('../../src/media/ffmpeg');

test('步驟 7 API：分鏡影片', async t => {
  // 估價以生成解析度計（測試輸出 320×180，生成高度取 min(720, 180) → 480p 價格）
  const s = await startApp();
  t.after(() => s.close());
  const { base, videoId } = await videoAtStep(s, 7);
  const { jobs, config, ai, ledger } = s.app.ctx;
  let video = (await s.get(base)).data.video;
  const videoCalls = () => ai.calls.filter(c => c.kind === 'video');

  await t.test('場景：生成影片前先看到預估費用並在超過門檻時需要同意', async () => {
    const r = await s.get(`${base}/estimate/clips`);
    assert.equal(r.data.seconds, 30);
    assert.equal(r.data.billedSeconds, 40, '10 格各 3 秒，每段至少以 4 秒計費');
    assert.equal(r.data.estimate, +(40 * Math.ceil(854 * 480 * 24 / 1024) * 0.014 / 1000).toFixed(4), '測試輸出 180p 以 480p 計價');
    const denied = await s.post(`${base}/clips/generate`, {});
    assert.equal(denied.status, 402);
    assert.equal(denied.data.error.reason, 'threshold');
    assert.equal(videoCalls().length, 0);
  });

  await t.test('場景：以確認的精緻圖作為首格生成每格分鏡影片', async () => {
    const r = await s.post(`${base}/clips/generate`, { consent: true });
    assert.equal(r.status, 202);
    await jobs.idle();
    video = (await s.get(base)).data.video;
    const stored = s.app.ctx.store.get('videos', videoId);
    assert.equal(videoCalls().length, 10);
    for (const shot of stored.script.shots) {
      const frame = stored.frames[shot.id];
      const selectedFrame = frame.candidates.find(c => c.id === frame.selected);
      const call = videoCalls().find(c => c.request.messages[0].content.startsWith(`分鏡 ${shot.index}，`));
      assert.equal(call.firstFrame, path.join(config.mediaDir, selectedFrame.file));
      assert.equal(call.seconds, shot.seconds);
      const clip = stored.clips[shot.id];
      assert.equal(clip.status, 'done');
      const info = await probe(path.join(config.mediaDir, clip.versions[0].file));
      assert.ok(Math.abs(info.duration - shot.seconds) < 0.1);
      assert.ok(video.clips[shot.id].versions[0].url);
    }
    assert.equal(ledger.summary(videoId).reserved, 0);
  });

  await t.test('場景：有台詞的格子要求模型原生語音並對口型', async () => {
    for (const shot of video.script.shots) {
      const call = videoCalls().find(c => c.request.messages[0].content.startsWith(`分鏡 ${shot.index}，`));
      assert.equal(call.nativeVoice, Boolean(shot.line) && shot.speaker !== '旁白', `第 ${shot.index} 格`);
    }
  });

  await t.test('場景：需要時也鎖定末格', async () => {
    const shot = video.script.shots[0];
    await s.post(`${base}/clips/${shot.id}/regenerate`, { lockLastFrame: true, consent: true });
    await jobs.idle();
    const call = videoCalls().at(-1);
    assert.equal(call.lastFrame, call.firstFrame);
  });

  await t.test('場景：單格依指令重生分鏡影片', async () => {
    const before = (await s.get(base)).data.video.clips;
    const shot = video.script.shots[1];
    await s.post(`${base}/clips/${shot.id}/regenerate`, { instruction: '轉頭的動作慢一點', consent: true });
    await jobs.idle();
    const clips = (await s.get(base)).data.video.clips;
    assert.equal(clips[shot.id].versions.length, 2);
    assert.equal(clips[shot.id].selected, clips[shot.id].versions[1].id);
    assert.equal(clips[shot.id].versions[1].instruction, '轉頭的動作慢一點');
    for (const other of video.script.shots.slice(2)) assert.deepEqual(clips[other.id].versions.map(x => x.id), before[other.id].versions.map(x => x.id));
    const r = await s.request('PATCH', `${base}/clips/${shot.id}`, { selected: clips[shot.id].versions[0].id });
    assert.equal(r.data.video.clips[shot.id].selected, clips[shot.id].versions[0].id);
  });

  await t.test('場景：記錄每格影片的品質檢查', async () => {
    const shot = video.script.shots[1];
    const quality = { face: true, lipsync: false, hands: true, temple: true };
    const r = await s.request('PATCH', `${base}/clips/${shot.id}`, { quality });
    assert.deepEqual(r.data.video.clips[shot.id].quality, quality);
  });

  await t.test('場景：分鏡影片失敗時退回費用並可重生', async () => {
    const shot = video.script.shots[3];
    const spent = ledger.summary(videoId).spent;
    ai.failNext('video', '影片服務逾時');
    await s.post(`${base}/clips/${shot.id}/regenerate`, { consent: true });
    await jobs.idle();
    let clip = (await s.get(base)).data.video.clips[shot.id];
    assert.equal(clip.status, 'failed');
    assert.match(clip.error, /影片服務逾時/);
    assert.equal(ledger.summary(videoId).spent, spent);
    assert.equal(ledger.summary(videoId).reserved, 0);
    await s.post(`${base}/clips/${shot.id}/regenerate`, { consent: true });
    await jobs.idle();
    clip = (await s.get(base)).data.video.clips[shot.id];
    assert.equal(clip.status, 'done');
  });
});
