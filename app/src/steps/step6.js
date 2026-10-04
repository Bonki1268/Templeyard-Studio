// 步驟 6：依分鏡圖、角色鎖定版本與去識別照片，為每格產生精緻圖。
// 生成在背景逐格進行（分鏡膠捲逐格顯示進度）；可單張重生、選定候選版本、記錄品質檢查。
const path = require('node:path');
const { unprocessable, notFound } = require('../http');
const { seriesVars } = require('../videos/vars');
const { estimateCost } = require('../cost/prices');
const wf = require('../videos/workflow');
const { referenceImage } = require('./step5');
const { selectedBoard } = require('./step3');
const { text } = require('../util');

const QUALITY_KEYS = ['face', 'temple', 'hands', 'people'];

function createStep6Service({ videos, generations, ledger, store, config, jobs }) {
  const media = rel => path.join(config.mediaDir, rel);

  function lockedCharacters(v, names) {
    return v.characters
      .filter(c => !names.length || names.includes(c.name))
      .map(c => ({ c, version: c.versions.find(x => x.version === (c.lockedVersion ?? c.selectedVersion)) }))
      .filter(x => x.version);
  }

  // 只用去識別後的照片（media 資料夾）、選用的寺廟背景板、鎖定版本的定妝板與分鏡圖作為參考圖。
  function refsFor(v, shot) {
    const photos = v.photos.filter(p => p.status === 'ready');
    const photo = shot.photoIndex ? photos[shot.photoIndex - 1] : null;
    const chars = lockedCharacters(v, [...(shot.characters || []), shot.speaker].filter(Boolean));
    return {
      photo,
      chars,
      refs: [photo && media(photo.file), selectedBoard(v) && media(selectedBoard(v).file), ...chars.map(x => referenceImage(x.version.images)).filter(Boolean).map(img => media(img.file)), shot.storyboard && media(shot.storyboard.file)].filter(Boolean),
    };
  }

  async function generateOne(id, shotId, { instruction = '' } = {}) {
    const v = videos.get(id);
    const shot = v.script.shots.find(s => s.id === shotId);
    const { photo, chars, refs } = refsFor(v, shot);
    videos.mutate(id, 6, video => { video.frames[shotId].status = 'running'; }, { touch: false });
    const variables = {
      shot,
      character: { reference: chars.length ? chars.map(x => `${x.c.name}（定裝 v${x.version.version}）`).join('、') : '本格無角色' },
      photo: { description: photo ? (photo.description || photo.filename) : '依分鏡圖的場景' },
      series: { style: seriesVars(v).style }, instruction: text(instruction),
    };
    try {
      const { generation, result } = await generations.run({
        videoId: id, step: 6, promptId: 'refined-frame', variables, instruction: text(instruction), consent: true,
        units: { count: 1 }, meta: { shotId },
        call: (ai, request) => ai.image.generate({ request, refs }),
      });
      videos.mutate(id, 6, video => {
        const f = video.frames[shotId];
        const candidate = { id: store.newId(), file: path.relative(config.mediaDir, result.file), instruction: text(instruction), generationId: generation.id };
        f.candidates.push(candidate);
        f.selected = candidate.id;
        f.status = 'done';
        f.error = null;
      });
    } catch (err) {
      videos.mutate(id, 6, video => { Object.assign(video.frames[shotId], { status: 'failed', error: err.message }); }, { touch: false });
    }
  }

  function ensureFrame(v, shotId) {
    v.frames[shotId] ||= { candidates: [], selected: null, status: 'idle', quality: {}, error: null };
    return v.frames[shotId];
  }

  function pending(v) {
    return v.script.shots.filter(s => !v.frames[s.id]?.selected);
  }

  function progress(v) {
    const list = v.script.shots.map(s => v.frames[s.id]?.status || 'idle');
    const count = st => list.filter(x => x === st).length;
    return { total: list.length, done: count('done'), running: count('running'), queued: count('queued'), failed: count('failed') };
  }

  return {
    progress,
    estimate(id) {
      const v = videos.get(id);
      const count = pending(v).length || v.script.shots.length;
      return { action: 'frames', count, estimate: estimateCost('image', { count }) };
    },

    generate(id, { consent = false } = {}) {
      const v = videos.get(id);
      wf.assertCanEnter(v, 6);
      const targets = pending(v).filter(s => !['queued', 'running'].includes(v.frames[s.id]?.status));
      ledger.check(id, estimateCost('image', { count: targets.length }), consent);
      const saved = videos.mutate(id, 6, video => {
        for (const s of targets) ensureFrame(video, s.id).status = 'queued';
      }, { touch: false });
      jobs.start(async () => {
        for (const s of targets) await generateOne(id, s.id);
      });
      return saved;
    },

    regenerate(id, shotId, { instruction = '', consent = false } = {}) {
      const v = videos.get(id);
      wf.assertCanEnter(v, 6);
      if (!v.script.shots.some(s => s.id === shotId)) throw notFound('找不到分鏡');
      ledger.check(id, estimateCost('image'), consent);
      const saved = videos.mutate(id, 6, video => { ensureFrame(video, shotId).status = 'queued'; }, { touch: false });
      jobs.start(() => generateOne(id, shotId, { instruction }));
      return saved;
    },

    update(id, shotId, { selected, quality }) {
      return videos.mutate(id, 6, v => {
        const f = v.frames[shotId];
        if (!f) throw notFound('這一格還沒有精緻圖');
        if (selected !== undefined) {
          if (!f.candidates.some(c => c.id === selected)) throw unprocessable('invalid_candidate', '沒有這個候選版本');
          f.selected = selected;
        }
        if (quality) for (const k of QUALITY_KEYS) if (quality[k] !== undefined) f.quality[k] = Boolean(quality[k]);
      }, { touch: selected !== undefined });
    },
  };
}

function registerStep6Routes(router, { step6, present, videos }) {
  const base = '/api/videos/:id/frames';
  const { Reply } = require('../http');
  router.get(base, ({ params }) => {
    const v = videos.get(params.id);
    return { frames: present(v.frames), progress: v.script ? step6.progress(v) : null };
  });
  router.post(`${base}/generate`, async ({ params, json }) => new Reply(202, { video: present(step6.generate(params.id, await json())) }));
  router.post(`${base}/:shotId/regenerate`, async ({ params, json }) => new Reply(202, { video: present(step6.regenerate(params.id, params.shotId, await json())) }));
  router.patch(`${base}/:shotId`, async ({ params, json }) => ({ video: present(step6.update(params.id, params.shotId, await json())) }));
}

module.exports = { createStep6Service, registerStep6Routes, QUALITY_KEYS };
