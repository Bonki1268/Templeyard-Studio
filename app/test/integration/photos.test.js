const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { startApp } = require('../helpers');
const { makeImage, rgb, regionDiff } = require('../fixtures');
const { createDetector } = require('../../src/media/deidentify');

const seriesInput = { name: '淡水廟宇故事', style: '溫暖寫實', duration: 30, direction: '在地歷史故事' };

async function setup(t, options = {}) {
  const s = await startApp(options);
  t.after(() => s.close());
  const seriesId = (await s.post('/api/series', seriesInput)).data.series.id;
  const videoId = (await s.post(`/api/series/${seriesId}/videos`, {})).data.video.id;
  const upload = (buffer, name, type = 'image/jpeg') => s.request('POST', `/api/videos/${videoId}/photos`, buffer, {
    'Content-Type': type, 'X-Filename': encodeURIComponent(name),
  });
  return { s, videoId, upload };
}

const outside = { x: 0.6, y: 0.6, w: 0.3, h: 0.3 };

test('場景：上傳照片後自動遮蔽人臉與車牌', async t => {
  const { s, upload } = await setup(t);
  const img = await makeImage();
  const r = await upload(img.buffer, '廟埕_face_plate.jpg');
  assert.equal(r.status, 201);
  const p = r.data.photo;
  assert.equal(p.status, 'ready');
  assert.equal(p.regions.filter(x => x.kind === 'face').length, 1);
  assert.equal(p.regions.filter(x => x.kind === 'plate').length, 1);
  assert.match(p.summary, /遮蔽 1 處人臉、1 處車牌/);
  const masked = path.join(s.app.ctx.config.mediaDir, p.file);
  const before = await rgb(img.file, 320, 180);
  const after = await rgb(masked, 320, 180);
  for (const region of p.regions) assert.ok(regionDiff(before, after, region) > 8, `區塊 ${region.kind} 應被模糊`);
  assert.ok(regionDiff(before, after, outside) < 4, '其他區域應不變');
});

test('場景：沒有偵測到人臉或車牌的照片標示無需遮蔽', async t => {
  const { upload } = await setup(t);
  const r = await upload((await makeImage('a.png')).buffer, '廟宇正面.png', 'image/png');
  assert.equal(r.status, 201);
  assert.equal(r.data.photo.status, 'ready');
  assert.equal(r.data.photo.regions.length, 0);
  assert.equal(r.data.photo.summary, '無需遮蔽');
});

test('場景：誤判為人臉的神像可以取消遮蔽', async t => {
  const { s, videoId, upload } = await setup(t);
  const img = await makeImage();
  const p = (await upload(img.buffer, '正殿_deity.jpg')).data.photo;
  assert.equal(p.regions.length, 1);
  const region = p.regions[0];
  const r = await s.request('PATCH', `/api/videos/${videoId}/photos/${p.id}/regions/${region.id}`, { enabled: false });
  assert.equal(r.status, 200);
  const updated = r.data.photo;
  assert.equal(updated.regions[0].enabled, false);
  assert.equal(updated.summary, '無需遮蔽');
  const after = await rgb(path.join(s.app.ctx.config.mediaDir, updated.file), 320, 180);
  const before = await rgb(img.file, 320, 180);
  assert.ok(regionDiff(before, after, region) < 4, '取消後該區塊不應模糊');
  assert.ok(updated.log.some(l => l.action === 'region_disabled'));
});

test('場景：可以手動加上遮蔽區塊', async t => {
  const { s, videoId, upload } = await setup(t);
  const img = await makeImage();
  const p = (await upload(img.buffer, '廟宇.jpg')).data.photo;
  const box = { x: 0.2, y: 0.2, w: 0.2, h: 0.3 };
  const r = await s.post(`/api/videos/${videoId}/photos/${p.id}/regions`, box);
  assert.equal(r.status, 201);
  const updated = r.data.photo;
  assert.equal(updated.regions.length, 1);
  assert.equal(updated.regions[0].source, 'manual');
  const after = await rgb(path.join(s.app.ctx.config.mediaDir, updated.file), 320, 180);
  assert.ok(regionDiff(await rgb(img.file, 320, 180), after, box) > 8);
  const bad = await s.post(`/api/videos/${videoId}/photos/${p.id}/regions`, { x: 0.9, y: 0.9, w: 0.5, h: 0.5 });
  assert.equal(bad.status, 422);
});

test('場景：最多上傳 5 張照片', async t => {
  const { upload } = await setup(t);
  const img = await makeImage();
  for (let i = 1; i <= 5; i++) assert.equal((await upload(img.buffer, `p${i}.jpg`)).status, 201);
  const r = await upload(img.buffer, 'p6.jpg');
  assert.equal(r.status, 422);
  assert.match(r.data.error.message, /最多 5 張/);
});

test('場景：只接受圖片檔', async t => {
  const { upload } = await setup(t);
  const r = await upload(Buffer.from('hello'), 'note.txt', 'text/plain');
  assert.equal(r.status, 415);
  assert.match(r.data.error.message, /JPEG、PNG 或 WebP/);
  const fakeJpeg = await upload(Buffer.from('not an image'), 'x.jpg', 'image/jpeg');
  assert.equal(fakeJpeg.status, 422);
});

test('場景：原圖保持私有，無法經由網址取得', async t => {
  const { s, videoId, upload } = await setup(t);
  const p = (await upload((await makeImage()).buffer, 'x_face.jpg')).data.photo;
  const video = (await s.get(`/api/videos/${videoId}`)).data.video;
  const json = JSON.stringify(video);
  assert.ok(!json.includes('private'), '回應不應含私有路徑');
  assert.ok(!('privateFile' in video.photos[0]));
  const stored = s.app.ctx.store.get('videos', videoId).photos[0];
  assert.ok(fs.existsSync(path.join(s.app.ctx.config.privateDir, stored.privateFile)), '原圖保存在私有資料夾');
  for (const url of [`/media/../private/${stored.privateFile}`, `/media/${encodeURIComponent('../private/' + stored.privateFile)}`, `/private/${stored.privateFile}`]) {
    const r = await s.get(url);
    assert.notEqual(r.status, 200, url);
  }
  assert.ok(p.url.startsWith('/media/'));
});

test('場景：照片以會過期的短期網址存取', async t => {
  let now = Date.UTC(2026, 9, 4, 8);
  const { s, upload } = await setup(t, { clock: () => new Date(now) });
  const p = (await upload((await makeImage()).buffer, 'x.jpg')).data.photo;
  const ok = await s.get(p.url);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /image\/jpeg/);
  const tampered = p.url.replace(/sig=([0-9a-f])/, (m, c) => `sig=${c === 'a' ? 'b' : 'a'}`);
  assert.equal((await s.get(tampered)).status, 403);
  now += 2 * 60 * 60 * 1000;
  assert.equal((await s.get(p.url)).status, 403);
});

const hasOpenCv = spawnSync('python3', ['-c', 'import cv2']).status === 0;

test('場景：本機 OpenCV 偵測器可以在沒有人臉的照片上執行', { skip: !hasOpenCv && '本機沒有 OpenCV' }, async () => {
  const detector = createDetector('opencv');
  const img = await makeImage();
  const regions = await detector.detect(img.file);
  assert.deepEqual(regions, []);
});
