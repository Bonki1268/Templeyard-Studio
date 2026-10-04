// 影片：屬於一個系列、關聯一間寺廟。建立時快照系列設定，之後系列修改不影響這支影片。
const { notFound, Reply } = require('../http');
const wf = require('./workflow');

function createVideoService({ store, series }) {
  const get = id => {
    const v = store.get('videos', id);
    if (!v || v.deletedAt) throw notFound('找不到影片');
    return v;
  };

  // 確認時的附加動作：before 在同一次寫入中修改影片，after 在寫入後執行（例如寫回系列）。
  const hooks = { before: {}, after: {} };

  return {
    get,
    hooks,
    // 舊資料升級為 7 個步驟（見 workflow.migrate）。
    migrateAll() {
      for (const v of store.list('videos')) {
        const copy = structuredClone(v);
        if (wf.migrate(copy)) store.update('videos', v.id, { steps: copy.steps, currentStep: copy.currentStep, status: copy.status, templeBoard: copy.templeBoard });
      }
    },
    create(seriesId) {
      const s = series.get(seriesId);
      return store.insert('videos', {
        seriesId,
        title: '',
        status: 'in_progress',
        currentStep: 2,
        steps: wf.initialSteps(),
        series: {
          name: s.name, style: s.style, styleNote: s.styleNote, duration: s.duration, direction: s.direction,
          output: s.output, characters: s.characters,
        },
        costCap: s.costCap,
        templeId: null, temple: null, templeHistory: '', templeBoard: null,
        photos: [],
        story: { original: '', polished: null, adopted: '', choice: null },
        script: null, characters: [], frames: {}, clips: {}, final: null, finals: [],
        audio: { voiceMode: 'native', music: 'warm-piano', subtitles: true }, musicUploads: [],
      });
    },
    // 修改某一步的內容：檢查能否進入該步，套用修改，並讓後續確認失效。
    mutate(id, step, fn, { touch = true } = {}) {
      const video = get(id);
      wf.assertCanEnter(video, step);
      let result;
      const saved = store.update('videos', id, v => {
        result = fn(v);
        if (touch) wf.touch(v, step);
      });
      return result === undefined ? saved : result;
    },
    confirm(id, step) {
      let record;
      const saved = store.update('videos', id, v => {
        record = wf.confirm(v, step);
        hooks.before[step]?.(v);
        Object.assign(record.content, Object.fromEntries((wf.STEP_FIELDS[step] || []).map(k => [k, v[k] ?? null])));
      });
      store.insert('confirmations', { videoId: id, ...record });
      hooks.after[step]?.(saved);
      return saved;
    },
    confirmations: id => store.list('confirmations', c => c.videoId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

function registerVideoRoutes(router, { videos, ledger, present }) {
  router.post('/api/series/:id/videos', ({ params }) => new Reply(201, { video: present(videos.create(params.id)) }));
  router.get('/api/videos/:id', ({ params }) => ({ video: present(videos.get(params.id)), cost: ledger.summary(params.id) }));
  router.post('/api/videos/:id/steps/:step/confirm', ({ params }) => {
    const step = Number(params.step);
    if (!wf.STEPS.includes(step)) throw notFound('沒有這個步驟');
    videos.get(params.id);
    return { video: present(videos.confirm(params.id, step)) };
  });
  router.get('/api/videos/:id/confirmations', ({ params }) => { videos.get(params.id); return { confirmations: videos.confirmations(params.id) }; });
}

module.exports = { createVideoService, registerVideoRoutes };
