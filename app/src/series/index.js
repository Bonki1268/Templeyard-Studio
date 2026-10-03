// 系列專案：名稱、視覺風格、秒數、方向、共同角色。設定是每支影片的共同依據。
const { notFound, unprocessable, Reply } = require('../http');

const OUTPUT = Object.freeze({ aspectRatio: '16:9', width: 1920, height: 1080, fps: 24 });
const DEFAULT_COST_CAP = 20;

const text = v => (typeof v === 'string' ? v.trim() : '');

function validateSeries(input, { partial = false } = {}) {
  const details = [];
  const has = k => !partial || input[k] !== undefined;
  if (has('name') && !text(input.name)) details.push({ field: 'name', message: '系列名稱必填' });
  if (has('style') && !text(input.style)) details.push({ field: 'style', message: '整體視覺風格必填' });
  if (has('duration')) {
    const d = Number(input.duration);
    if (!Number.isInteger(d) || d < 5 || d > 30) details.push({ field: 'duration', message: '影片秒數必須是 5～30 的整數' });
  }
  if (has('direction') && !text(input.direction)) details.push({ field: 'direction', message: '影片方向必填' });
  if (input.costCap !== undefined && !(Number(input.costCap) > 0)) details.push({ field: 'costCap', message: '費用上限必須大於 0' });
  if (input.characters !== undefined && !Array.isArray(input.characters)) details.push({ field: 'characters', message: 'characters 必須是陣列' });
  (Array.isArray(input.characters) ? input.characters : []).forEach((c, i) => {
    if (!text(c?.name)) details.push({ field: `characters[${i}].name`, message: '角色名稱必填' });
  });
  if (details.length) throw unprocessable('invalid_series', '系列設定不完整', { details });
}

function newCharacter(store, c) {
  return {
    id: store.newId(), name: text(c.name), description: text(c.description),
    versions: [], lockedVersion: null, scope: 'series',
  };
}

function createSeriesService({ store }) {
  const get = id => {
    const s = store.get('series', id);
    if (!s) throw notFound('找不到系列');
    return s;
  };
  return {
    get,
    list() {
      const videos = store.list('videos');
      return store.list('series')
        .map(s => ({ ...s, videoCount: videos.filter(v => v.seriesId === s.id).length }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    create(input) {
      validateSeries(input);
      return store.insert('series', {
        name: text(input.name), style: text(input.style), styleNote: text(input.styleNote),
        duration: Number(input.duration), direction: text(input.direction),
        costCap: input.costCap ? Number(input.costCap) : DEFAULT_COST_CAP,
        output: { ...OUTPUT },
        characters: (input.characters || []).filter(c => text(c?.name)).map(c => newCharacter(store, c)),
      });
    },
    update(id, input) {
      get(id);
      validateSeries(input, { partial: true });
      const patch = {};
      for (const k of ['name', 'style', 'styleNote', 'direction']) if (input[k] !== undefined) patch[k] = text(input[k]);
      if (input.duration !== undefined) patch.duration = Number(input.duration);
      if (input.costCap !== undefined) patch.costCap = Number(input.costCap);
      return store.update('series', id, patch);
    },
    addCharacter(id, input) {
      get(id);
      if (!text(input.name)) throw unprocessable('invalid_character', '角色名稱必填', { details: [{ field: 'name', message: '角色名稱必填' }] });
      const character = newCharacter(store, input);
      store.update('series', id, s => { s.characters.push(character); });
      return character;
    },
    history: id => { get(id); return store.history('series', id); },
  };
}

function registerSeriesRoutes(router, { series, store }) {
  router.get('/api/series', () => ({ series: series.list() }));
  router.post('/api/series', async ({ json }) => new Reply(201, { series: series.create(await json()) }));
  router.get('/api/series/:id', ({ params }) => ({
    series: series.get(params.id),
    videos: store.list('videos', v => v.seriesId === params.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  }));
  router.put('/api/series/:id', async ({ params, json }) => ({ series: series.update(params.id, await json()) }));
  router.get('/api/series/:id/history', ({ params }) => ({ history: series.history(params.id) }));
  router.post('/api/series/:id/characters', async ({ params, json }) => new Reply(201, { character: series.addCharacter(params.id, await json()) }));
}

module.exports = { createSeriesService, registerSeriesRoutes, OUTPUT };
