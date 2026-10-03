// 步驟 2：選擇寺廟、貼上歷史與簡介、輸入故事、AI 潤飾（接受／修改／保留原文）。
const { unprocessable, notFound } = require('../http');
const { templeVars, seriesVars } = require('../videos/vars');

const text = v => (typeof v === 'string' ? v.trim() : '');

function createStep2Service({ videos, temples, generations }) {
  return {
    setTemple(id, templeId) {
      const t = temples().byId.get(templeId);
      if (!t) throw notFound('找不到寺廟');
      return videos.mutate(id, 2, v => {
        v.templeId = t.id;
        v.temple = { ...t, label: t.flags.duplicateName && t.district ? `${t.displayName}（${t.district}）` : t.displayName };
      });
    },
    setHistory(id, history) {
      return videos.mutate(id, 2, v => { v.templeHistory = text(history); });
    },
    setStory(id, story) {
      return videos.mutate(id, 2, v => {
        v.story.original = text(story);
        if (v.story.choice !== 'polished' && v.story.choice !== 'edited') { v.story.adopted = v.story.original; v.story.choice = 'original'; }
      });
    },
    async polish(id, { instruction = '', consent = false } = {}) {
      const video = videos.get(id);
      if (!video.templeId) throw unprocessable('temple_required', '請先選擇寺廟，再使用 AI 潤飾');
      if (!text(video.story.original)) throw unprocessable('story_required', '請先輸入故事，再使用 AI 潤飾');
      const variables = { temple: templeVars(video), series: seriesVars(video), story: video.story.original, instruction: text(instruction) };
      const { generation, result } = await generations.run({
        videoId: id, step: 2, promptId: 'copy-polish', variables, instruction: text(instruction), consent,
        call: (ai, request) => ai.text.generate({ request, variables }),
      });
      return videos.mutate(id, 2, v => {
        v.story.polished = { text: result.json.polished, notes: result.json.notes || '', generationId: generation.id, instruction: text(instruction) };
      });
    },
    adopt(id, { choice, text: edited }) {
      return videos.mutate(id, 2, v => {
        if (choice === 'original') v.story.adopted = v.story.original;
        else if (choice === 'polished') {
          if (!v.story.polished) throw unprocessable('no_polished', '還沒有潤飾版');
          v.story.adopted = v.story.polished.text;
        } else if (choice === 'edited') {
          if (!text(edited)) throw unprocessable('story_required', '採用的故事不能空白');
          v.story.adopted = text(edited);
        } else throw unprocessable('invalid_choice', 'choice 必須是 original、polished 或 edited');
        v.story.choice = choice;
      });
    },
  };
}

function registerStep2Routes(router, { step2, present }) {
  const base = '/api/videos/:id';
  const reply = video => ({ video: present(video) });
  router.put(`${base}/temple`, async ({ params, json }) => reply(step2.setTemple(params.id, (await json()).templeId)));
  router.put(`${base}/temple-history`, async ({ params, json }) => reply(step2.setHistory(params.id, (await json()).text)));
  router.put(`${base}/story`, async ({ params, json }) => reply(step2.setStory(params.id, (await json()).text)));
  router.post(`${base}/story/polish`, async ({ params, json }) => reply(await step2.polish(params.id, await json())));
  router.post(`${base}/story/adopt`, async ({ params, json }) => reply(step2.adopt(params.id, await json())));
}

module.exports = { createStep2Service, registerStep2Routes };
