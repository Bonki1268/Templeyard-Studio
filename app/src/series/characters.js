// 系列角色的 AI 輔助：依構想撰寫外觀描述、產生三視圖與定裝圖、鎖定定裝版本。
// 費用記在系列帳（series:<id>）上；鎖定的版本讓之後新增的影片在角色設計步驟直接沿用。
const { unprocessable, notFound } = require('../http');
const { estimateCost } = require('../cost/prices');
const { generateSheet, VIEWS } = require('../steps/step4');
const { text } = require('../util');

const STEP = 1;

function createSeriesCharacterService({ series, store, generations, ledger, config }) {
  const account = id => `series:${id}`;
  const record = id => ({ account: account(id), meta: { seriesId: id } });

  function find(s, cid) {
    const c = s.characters.find(x => x.id === cid);
    if (!c) throw notFound('找不到系列角色');
    return c;
  }

  // 修改系列中的某個角色，回傳修改後的角色。
  function mutate(id, cid, fn) {
    const updated = store.update('series', id, s => fn(find(s, cid)));
    return find(updated, cid);
  }

  return {
    estimate: () => ({ draft: estimateCost('text'), sheet: estimateCost('image', { count: VIEWS.length }) }),

    cost: id => { series.get(id); return ledger.summary(account(id)); },

    // 只回傳草稿，使用者修改後再用 POST /characters 加入系列。
    async draft(id, { name = '', idea = '', instruction = '', consent = false } = {}) {
      const s = series.get(id);
      if (!text(name) && !text(idea)) {
        throw unprocessable('idea_required', '請先輸入角色名稱或構想', { details: [{ field: 'idea', message: '請輸入角色名稱或構想' }] });
      }
      const variables = {
        character: { name: text(name) }, idea: text(idea),
        series: { name: s.name, style: s.style, direction: s.direction }, instruction: text(instruction),
      };
      const { generation, result } = await generations.run({
        ...record(id), step: STEP, promptId: 'character-design', variables, instruction: text(instruction), consent,
        call: (ai, request) => ai.text.generate({ request, variables }),
      });
      return {
        draft: { name: text(result.json.name) || text(name), description: text(result.json.description), notes: text(result.json.notes) },
        generationId: generation.id,
      };
    },

    async generate(id, cid, { instruction = '', description, consent = false } = {}) {
      const s = series.get(id);
      const c = find(s, cid);
      const desc = text(description) || c.description;
      if (!desc) throw unprocessable('description_required', '請先填寫外觀描述', { details: [{ field: 'description', message: '請先填寫外觀描述' }] });
      ledger.check(account(id), estimateCost('image', { count: VIEWS.length }), consent);
      const current = c.versions.find(x => x.version === (c.selectedVersion ?? c.lockedVersion));
      const images = await generateSheet({ generations, config }, {
        character: { id: c.id, name: c.name, description: desc }, style: s.style, instruction,
        reference: current ? `第 ${current.version} 版定裝圖` : '', consent: true, step: STEP, record: record(id),
      });
      return mutate(id, cid, t => {
        const version = Math.max(0, ...t.versions.map(x => x.version)) + 1;
        t.description = desc;
        t.versions.push({ version, images, instruction: text(instruction), description: desc });
        t.selectedVersion = version;
      });
    },

    update(id, cid, patch) {
      series.get(id);
      return mutate(id, cid, c => {
        const hasVersion = v => c.versions.some(x => x.version === Number(v));
        if (patch.description !== undefined) c.description = text(patch.description);
        if (patch.selectedVersion !== undefined) {
          if (!hasVersion(patch.selectedVersion)) throw unprocessable('invalid_version', '沒有這個版本');
          c.selectedVersion = Number(patch.selectedVersion);
        }
        if (patch.lockedVersion !== undefined) {
          if (!hasVersion(patch.lockedVersion)) throw unprocessable('invalid_version', '沒有這個版本');
          c.lockedVersion = Number(patch.lockedVersion);
          c.selectedVersion = c.lockedVersion;
        }
      });
    },
  };
}

function registerSeriesCharacterRoutes(router, { seriesCharacters, present }) {
  const base = '/api/series/:id';
  const reply = character => ({ character: present(character) });
  router.get(`${base}/estimate/characters`, () => seriesCharacters.estimate());
  router.get(`${base}/cost`, ({ params }) => ({ cost: seriesCharacters.cost(params.id) }));
  router.post(`${base}/characters/draft`, async ({ params, json }) => seriesCharacters.draft(params.id, await json()));
  router.post(`${base}/characters/:cid/generate`, async ({ params, json }) => reply(await seriesCharacters.generate(params.id, params.cid, await json())));
  router.patch(`${base}/characters/:cid`, async ({ params, json }) => reply(seriesCharacters.update(params.id, params.cid, await json())));
}

module.exports = { createSeriesCharacterService, registerSeriesCharacterRoutes };
