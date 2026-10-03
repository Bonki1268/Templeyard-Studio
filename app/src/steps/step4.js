// 步驟 4：依腳本需要的角色產生三視圖與定裝圖；系列已鎖定的角色直接沿用。
// 確認時鎖定選用的版本；系列角色或勾選「加入系列角色」者寫回系列，之後的影片沿用。
const path = require('node:path');
const { unprocessable, notFound } = require('../http');
const { seriesVars } = require('../videos/vars');
const { estimateCost } = require('../cost/prices');
const wf = require('../videos/workflow');
const { mapLimit, text } = require('../util');

const VIEWS = ['front', 'side', 'back', 'costume'];

function neededCharacters(script) {
  const byName = new Map();
  for (const c of script.characters || []) byName.set(c.name, c.description || '');
  for (const shot of script.shots) {
    for (const name of [...(shot.characters || []), shot.speaker]) {
      if (name && name !== '旁白' && !byName.has(name)) byName.set(name, '');
    }
  }
  return [...byName].map(([name, description]) => ({ name, description }));
}

function createStep4Service({ videos, generations, ledger, store, config }) {
  const lockedOf = sc => sc.versions?.find(x => x.version === sc.lockedVersion);

  function plan(v) {
    if (!v.script) throw unprocessable('no_script', '還沒有腳本');
    return neededCharacters(v.script).map(need => {
      const existing = v.characters.find(c => c.name === need.name);
      const sc = v.series.characters.find(c => c.name === need.name);
      return { need, existing, sc, generate: !existing && !(sc && lockedOf(sc)) };
    });
  }

  async function sheet(v, character, { instruction = '', reference = '', consent }) {
    const variables = {
      character: { name: character.name, description: character.description || `${character.name}（依腳本）`, reference },
      series: { style: seriesVars(v).style }, instruction: text(instruction),
    };
    const images = {};
    await mapLimit(VIEWS, 4, async view => {
      const { generation, result } = await generations.run({
        videoId: v.id, step: 4, promptId: 'character-sheet', variables, instruction: text(instruction), consent,
        units: { count: 1 }, meta: { characterId: character.id, view },
        call: (ai, request) => ai.image.generate({ request, variant: view }),
      });
      images[view] = { file: path.relative(config.mediaDir, result.file), generationId: generation.id };
    });
    return images;
  }

  function findCharacter(v, cid) {
    const c = v.characters.find(x => x.id === cid);
    if (!c) throw notFound('找不到角色');
    return c;
  }

  return {
    estimate(id) {
      const items = plan(videos.get(id));
      const newCharacters = items.filter(i => i.generate || (i.sc && !lockedOf(i.sc) && !i.existing)).length;
      return { action: 'characters', newCharacters, estimate: estimateCost('image', { count: newCharacters * VIEWS.length }) };
    },

    async generate(id, { consent = false } = {}) {
      const v = videos.get(id);
      wf.assertCanEnter(v, 4);
      ledger.check(id, this.estimate(id).estimate, consent);
      const created = [];
      for (const { need, existing, sc } of plan(v)) {
        if (existing) continue;
        if (sc && lockedOf(sc)) {
          // 系列角色已有鎖定版本：直接沿用，不重新產生。
          created.push({ id: store.newId(), name: sc.name, description: sc.description, source: 'series', seriesCharacterId: sc.id,
            reused: true, versions: [structuredClone(lockedOf(sc))], selectedVersion: sc.lockedVersion, lockedVersion: null, addToSeries: false });
          continue;
        }
        const c = { id: store.newId(), name: need.name, description: sc?.description || need.description, source: sc ? 'series' : 'video',
          seriesCharacterId: sc?.id || null, reused: false, versions: [], selectedVersion: null, lockedVersion: null, addToSeries: false };
        c.versions.push({ version: 1, images: await sheet(v, c, { consent: true }), instruction: '', description: c.description });
        c.selectedVersion = 1;
        created.push(c);
      }
      return videos.mutate(id, 4, video => { video.characters.push(...created); });
    },

    async regenerate(id, cid, { instruction = '', description, consent = false } = {}) {
      const v = videos.get(id);
      wf.assertCanEnter(v, 4);
      const c = { ...findCharacter(v, cid) };
      if (description !== undefined && text(description)) c.description = text(description);
      ledger.check(id, estimateCost('image', { count: VIEWS.length }), consent);
      const current = c.versions.find(x => x.version === c.selectedVersion);
      const images = await sheet(v, c, { instruction, reference: current ? `第 ${current.version} 版定裝圖` : '', consent: true });
      return videos.mutate(id, 4, video => {
        const target = findCharacter(video, cid);
        const version = Math.max(0, ...target.versions.map(x => x.version)) + 1;
        target.description = c.description;
        target.versions.push({ version, images, instruction: text(instruction), description: c.description });
        target.selectedVersion = version;
        target.reused = false;
      });
    },

    update(id, cid, patch) {
      return videos.mutate(id, 4, v => {
        const c = findCharacter(v, cid);
        if (patch.description !== undefined) c.description = text(patch.description);
        if (patch.selectedVersion !== undefined) {
          if (!c.versions.some(x => x.version === Number(patch.selectedVersion))) throw unprocessable('invalid_version', '沒有這個版本');
          c.selectedVersion = Number(patch.selectedVersion);
        }
        if (patch.addToSeries !== undefined) c.addToSeries = Boolean(patch.addToSeries);
      });
    },

    // 確認步驟 4 時：鎖定選用版本。
    lock(v) {
      for (const c of v.characters) c.lockedVersion = c.selectedVersion;
    },

    // 確認後：系列角色（新產生的）與勾選加入系列者，寫回系列。
    syncSeries(v) {
      const targets = v.characters.filter(c => (c.source === 'series' && !c.reused) || c.addToSeries);
      if (!targets.length) return;
      store.update('series', v.seriesId, s => {
        for (const c of targets) {
          const locked = structuredClone(c.versions.find(x => x.version === c.lockedVersion));
          let sc = s.characters.find(x => x.id === c.seriesCharacterId) || s.characters.find(x => x.name === c.name);
          if (!sc) { sc = { id: store.newId(), name: c.name, versions: [], scope: 'series' }; s.characters.push(sc); }
          sc.description = c.description;
          sc.versions = [...(sc.versions || []).filter(x => x.version !== locked.version), locked];
          sc.lockedVersion = locked.version;
        }
      });
    },
  };
}

function registerStep4Routes(router, { step4, present }) {
  const base = '/api/videos/:id/characters';
  const reply = video => ({ video: present(video) });
  router.post(`${base}/generate`, async ({ params, json }) => reply(await step4.generate(params.id, await json())));
  router.post(`${base}/:cid/regenerate`, async ({ params, json }) => reply(await step4.regenerate(params.id, params.cid, await json())));
  router.patch(`${base}/:cid`, async ({ params, json }) => reply(step4.update(params.id, params.cid, await json())));
}

module.exports = { createStep4Service, registerStep4Routes, neededCharacters, VIEWS };
