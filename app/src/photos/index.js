// 照片：上傳 1～5 張，原圖存私有資料夾，自動偵測並遮蔽人臉與車牌，使用者可取消誤判或手動加框。
// 每次調整都產生新的遮蔽檔，舊檔保留；處理紀錄寫在照片的 log。
const fs = require('node:fs');
const path = require('node:path');
const { HttpError, unprocessable, notFound, Reply } = require('../http');
const { maskImage } = require('../media/deidentify');

const MAX_PHOTOS = 5;
const TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const KIND_NAMES = { face: '人臉', plate: '車牌' };

function summaryOf(regions) {
  const counts = {};
  for (const r of regions.filter(r => r.enabled !== false)) counts[r.kind] = (counts[r.kind] || 0) + 1;
  const parts = Object.entries(counts).map(([k, n]) => `${n} 處${KIND_NAMES[k] || k}`);
  return parts.length ? `遮蔽 ${parts.join('、')}` : '無需遮蔽';
}

function createPhotoService({ store, videos, config, detector, clock }) {
  const now = () => clock().toISOString();
  const active = video => video.photos.filter(p => p.status !== 'removed');

  function findPhoto(video, photoId) {
    const p = video.photos.find(x => x.id === photoId && x.status !== 'removed');
    if (!p) throw notFound('找不到照片');
    return p;
  }

  async function remask(videoId, photo, regions) {
    const version = (photo.maskVersion || 0) + 1;
    const rel = `videos/${videoId}/photos/${photo.id}-masked-v${version}.jpg`;
    const out = path.join(config.mediaDir, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await maskImage(path.join(config.privateDir, photo.original), out, regions);
    return { file: rel, maskVersion: version };
  }

  return {
    async upload(videoId, { buffer, filename, contentType }) {
      const ext = TYPES[(contentType || '').split(';')[0].trim()];
      if (!ext) throw new HttpError(415, 'unsupported_type', '只接受 JPEG、PNG 或 WebP 圖片');
      const video = videos.get(videoId);
      if (active(video).length >= MAX_PHOTOS) throw unprocessable('too_many_photos', `每支影片最多 ${MAX_PHOTOS} 張照片`);
      const id = store.newId();
      const original = `videos/${videoId}/photos/${id}${ext}`;
      const originalPath = path.join(config.privateDir, original);
      fs.mkdirSync(path.dirname(originalPath), { recursive: true });
      fs.writeFileSync(originalPath, buffer);
      const photo = { id, filename: filename || `照片${ext}`, description: '', original, status: 'processing', regions: [], log: [] };
      try {
        const found = await detector.detect(originalPath, { filename: photo.filename });
        photo.regions = found.map(r => ({ id: store.newId(), ...r, enabled: true, source: 'auto' }));
        photo.log.push({ at: now(), action: 'detected', detector: detector.name, count: photo.regions.length });
        Object.assign(photo, await remask(videoId, photo, photo.regions));
      } catch (err) {
        fs.rmSync(originalPath, { force: true });
        throw unprocessable('invalid_image', `無法處理這張圖片：${err.message.split('\n')[0].slice(0, 120)}`);
      }
      photo.status = 'ready';
      photo.summary = summaryOf(photo.regions);
      photo.log.push({ at: now(), action: 'masked', file: photo.file, summary: photo.summary });
      return videos.mutate(videoId, 2, v => {
        if (active(v).length >= MAX_PHOTOS) throw unprocessable('too_many_photos', `每支影片最多 ${MAX_PHOTOS} 張照片`);
        v.photos.push(photo);
        return photo;
      });
    },

    async setRegion(videoId, photoId, regionId, { enabled }) {
      const photo = findPhoto(videos.get(videoId), photoId);
      const regions = photo.regions.map(r => (r.id === regionId ? { ...r, enabled: Boolean(enabled) } : r));
      if (!photo.regions.some(r => r.id === regionId)) throw notFound('找不到遮蔽區塊');
      const masked = await remask(videoId, photo, regions);
      return videos.mutate(videoId, 2, v => {
        const p = findPhoto(v, photoId);
        Object.assign(p, masked, { regions, summary: summaryOf(regions) });
        p.log.push({ at: now(), action: enabled ? 'region_enabled' : 'region_disabled', regionId, file: p.file });
        return p;
      });
    },

    async addRegion(videoId, photoId, box) {
      const nums = ['x', 'y', 'w', 'h'].map(k => Number(box[k]));
      const [x, y, w, h] = nums;
      if (nums.some(n => !Number.isFinite(n)) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) {
        throw unprocessable('invalid_region', '遮蔽區塊必須在照片範圍內（座標為 0～1 的比例）');
      }
      const photo = findPhoto(videos.get(videoId), photoId);
      const region = { id: store.newId(), kind: box.kind || 'face', x, y, w, h, enabled: true, source: 'manual' };
      const regions = [...photo.regions, region];
      const masked = await remask(videoId, photo, regions);
      return videos.mutate(videoId, 2, v => {
        const p = findPhoto(v, photoId);
        Object.assign(p, masked, { regions, summary: summaryOf(regions) });
        p.log.push({ at: now(), action: 'region_added', regionId: region.id, file: p.file });
        return p;
      });
    },

    update(videoId, photoId, { description }) {
      return videos.mutate(videoId, 2, v => {
        const p = findPhoto(v, photoId);
        if (description !== undefined) p.description = String(description).trim();
        return p;
      });
    },

    remove(videoId, photoId) {
      return videos.mutate(videoId, 2, v => {
        const p = findPhoto(v, photoId);
        p.status = 'removed';
        p.log.push({ at: now(), action: 'removed' });
        return p;
      });
    },
  };
}

function registerPhotoRoutes(router, { photos, present }) {
  router.post('/api/videos/:id/photos', async ({ params, req, raw }) => {
    const photo = await photos.upload(params.id, {
      buffer: await raw(25_000_000),
      filename: decodeURIComponent(req.headers['x-filename'] || ''),
      contentType: req.headers['content-type'],
    });
    return new Reply(201, { photo: present(photo) });
  });
  router.patch('/api/videos/:id/photos/:pid', async ({ params, json }) => ({ photo: present(photos.update(params.id, params.pid, await json())) }));
  router.delete('/api/videos/:id/photos/:pid', ({ params }) => ({ photo: present(photos.remove(params.id, params.pid)) }));
  router.patch('/api/videos/:id/photos/:pid/regions/:rid', async ({ params, json }) => ({
    photo: present(await photos.setRegion(params.id, params.pid, params.rid, await json())),
  }));
  router.post('/api/videos/:id/photos/:pid/regions', async ({ params, json }) => new Reply(201, {
    photo: present(await photos.addRegion(params.id, params.pid, await json())),
  }));
}

module.exports = { createPhotoService, registerPhotoRoutes, summaryOf, MAX_PHOTOS };
