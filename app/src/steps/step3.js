// 步驟 3：以廣告編劇角度產生腳本並拆成分鏡；每格有分鏡圖與說明，可手動修改、單格重生、依指令重生整份。
const path = require('node:path');
const { HttpError, unprocessable, notFound } = require('../http');
const { templeVars, seriesVars, photosText } = require('../videos/vars');
const { estimateCost, round } = require('../cost/prices');
const wf = require('../videos/workflow');
const { mapLimit, text } = require('../util');

const SHOT_FIELDS = ['scene', 'shotSize', 'composition', 'camera', 'transition', 'intent', 'narrativeRole', 'action', 'line', 'speaker', 'subtitle'];
const SHOT_SIZES = ['遠景', '中景', '特寫'];

// 依秒數決定格數：每格約 3 秒，4～12 格（見 docs/BLOCKED.md 第 7 項）。
const shotCountFor = duration => Math.max(4, Math.min(12, Math.round(duration / 3)));

function createStep3Service({ videos, generations, ledger, store, config }) {
  const readyPhotos = v => v.photos.filter(p => p.status === 'ready');

  function scriptVars(v, instruction) {
    const characterList = v.series.characters.map(c => ({ name: c.name, description: c.description }));
    return {
      temple: templeVars(v), series: seriesVars(v), story: v.story.adopted,
      characters: characterList.map(c => `${c.name}：${c.description || ''}`).join('；'),
      characterList, photos: photosText(v), photoCount: readyPhotos(v).length,
      shotCount: shotCountFor(v.series.duration), instruction: text(instruction),
    };
  }

  function normalizeShot(raw, i, photoCount, keep = {}) {
    const shot = { id: keep.id || store.newId(), index: i + 1 };
    for (const k of SHOT_FIELDS) shot[k] = text(raw[k]);
    shot.seconds = keep.seconds ?? Number(raw.seconds);
    const pi = Number(raw.photoIndex);
    shot.photoIndex = Number.isInteger(pi) && pi >= 1 && pi <= photoCount ? pi : null;
    shot.characters = Array.isArray(raw.characters) ? raw.characters.map(text).filter(Boolean) : [];
    return shot;
  }

  function parseScript(json, photoCount) {
    if (!json || !Array.isArray(json.shots) || !json.shots.length) {
      throw new HttpError(502, 'invalid_ai_output', 'AI 回傳的腳本格式不正確，請重新產生');
    }
    const shots = json.shots.map((s, i) => normalizeShot(s, i, photoCount));
    if (shots.some(s => !(s.seconds > 0))) throw new HttpError(502, 'invalid_ai_output', 'AI 回傳的分鏡秒數不正確，請重新產生');
    return {
      title: text(json.title), logline: text(json.logline), adCopy: text(json.adCopy),
      characters: (json.characters || []).map(c => ({ name: text(c.name), description: text(c.description) })).filter(c => c.name),
      shots,
    };
  }

  async function storyboard(v, shot, { instruction = '', consent }) {
    const variables = {
      shot, characters: shot.characters.join('、'), series: { style: seriesVars(v).style }, instruction: text(instruction),
    };
    const { generation, result } = await generations.run({
      videoId: v.id, step: 3, promptId: 'storyboard-image', variables, instruction: text(instruction), consent,
      units: { count: 1 }, meta: { shotId: shot.id },
      call: (ai, request) => ai.image.generate({ request, variables }),
    });
    return { file: path.relative(config.mediaDir, result.file), generationId: generation.id };
  }

  function estimate(id) {
    const v = videos.get(id);
    const shotCount = shotCountFor(v.series.duration);
    return { action: 'script', shotCount, estimate: round(estimateCost('text') + estimateCost('image', { count: shotCount })) };
  }

  function findShot(v, shotId) {
    const shot = v.script?.shots.find(s => s.id === shotId);
    if (!shot) throw notFound('找不到分鏡');
    return shot;
  }

  return {
    estimate,
    async generate(id, { instruction = '', consent = false } = {}) {
      const v = videos.get(id);
      wf.assertCanEnter(v, 3);
      ledger.check(id, estimate(id).estimate, consent);
      const variables = scriptVars(v, instruction);
      const { generation, result } = await generations.run({
        videoId: id, step: 3, promptId: 'story-script', variables, instruction: text(instruction), consent: true,
        call: (ai, request) => ai.text.generate({ request, variables }),
      });
      const script = parseScript(result.json, variables.photoCount);
      await mapLimit(script.shots, 4, async shot => { shot.storyboard = await storyboard(v, shot, { consent: true }); });
      return videos.mutate(id, 3, video => {
        if (video.script) (video.scriptVersions ||= []).push(video.script);
        video.script = { ...script, version: (video.script?.version || 0) + 1, instruction: text(instruction), generationId: generation.id };
        video.title = script.title || video.title;
      });
    },

    editScript(id, patch) {
      return videos.mutate(id, 3, v => {
        if (!v.script) throw unprocessable('no_script', '還沒有腳本');
        for (const k of ['title', 'logline', 'adCopy']) if (patch[k] !== undefined) v.script[k] = text(patch[k]);
        if (patch.title !== undefined) v.title = v.script.title;
      });
    },

    editShot(id, shotId, patch) {
      if (patch.seconds !== undefined && !(Number(patch.seconds) >= 0.5 && Number(patch.seconds) <= 10)) {
        throw unprocessable('invalid_seconds', '每格秒數必須在 0.5～10 秒之間');
      }
      if (patch.shotSize !== undefined && !SHOT_SIZES.includes(patch.shotSize)) throw unprocessable('invalid_shot_size', '景別必須是遠景、中景或特寫');
      return videos.mutate(id, 3, v => {
        const shot = findShot(v, shotId);
        for (const k of SHOT_FIELDS) if (patch[k] !== undefined) shot[k] = text(patch[k]);
        if (patch.seconds !== undefined) shot.seconds = Number(patch.seconds);
        if (patch.photoIndex !== undefined) {
          const pi = Number(patch.photoIndex);
          shot.photoIndex = pi >= 1 && pi <= readyPhotos(v).length ? pi : null;
        }
        if (Array.isArray(patch.characters)) shot.characters = patch.characters.map(text).filter(Boolean);
      });
    },

    // part：description（只重寫說明）、image（只重畫分鏡圖）、both（預設）
    async regenerateShot(id, shotId, { instruction = '', part = 'both', consent = false } = {}) {
      const v = videos.get(id);
      wf.assertCanEnter(v, 3);
      const old = findShot(v, shotId);
      let shot = { ...old };
      const cost = (part !== 'image' ? estimateCost('text') : 0) + (part !== 'description' ? estimateCost('image') : 0);
      ledger.check(id, cost, consent);
      if (part !== 'image') {
        const note = `只重寫第 ${old.index} 格，其他格保持不變。${text(instruction)}`;
        const variables = scriptVars(v, note);
        const { result } = await generations.run({
          videoId: id, step: 3, promptId: 'story-script', variables, instruction: text(instruction), consent: true, meta: { shotId },
          call: (ai, request) => ai.text.generate({ request, variables }),
        });
        const raw = result.json?.shots?.[old.index - 1];
        if (!raw) throw new HttpError(502, 'invalid_ai_output', 'AI 沒有回傳這一格，請重新產生');
        shot = { ...normalizeShot(raw, old.index - 1, variables.photoCount, { id: old.id, seconds: old.seconds }), storyboard: old.storyboard };
      }
      if (part !== 'description') shot.storyboard = await storyboard(v, shot, { instruction, consent: true });
      return videos.mutate(id, 3, video => {
        const i = video.script.shots.findIndex(s => s.id === shotId);
        video.script.shots[i] = shot;
      });
    },
  };
}

function registerStep3Routes(router, { step3, present }) {
  const base = '/api/videos/:id';
  const reply = video => ({ video: present(video) });
  router.post(`${base}/script/generate`, async ({ params, json }) => reply(await step3.generate(params.id, await json())));
  router.patch(`${base}/script`, async ({ params, json }) => reply(step3.editScript(params.id, await json())));
  router.patch(`${base}/script/shots/:shotId`, async ({ params, json }) => reply(step3.editShot(params.id, params.shotId, await json())));
  router.post(`${base}/script/shots/:shotId/regenerate`, async ({ params, json }) => reply(await step3.regenerateShot(params.id, params.shotId, await json())));
}

module.exports = { createStep3Service, registerStep3Routes, shotCountFor };
