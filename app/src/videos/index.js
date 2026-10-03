// 影片：屬於一個系列、關聯一間寺廟。建立時快照系列設定，之後系列修改不影響這支影片。
const { notFound, Reply } = require('../http');
const wf = require('./workflow');

function createVideoService({ store, series }) {
  const get = id => {
    const v = store.get('videos', id);
    if (!v) throw notFound('找不到影片');
    return v;
  };

  return {
    get,
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
        templeId: null, temple: null, templeHistory: '',
        photos: [],
        story: { original: '', polished: null, adopted: '', choice: null },
        script: null, characters: [], frames: {}, clips: {}, final: null,
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
      const saved = store.update('videos', id, v => { record = wf.confirm(v, step); });
      store.insert('confirmations', { videoId: id, ...record });
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
