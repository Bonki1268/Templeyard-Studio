// 步驟 3：寺廟背景板。以去識別後的照片產生一張四格背景板（正面全景、斜角／側面、廟埕與周邊環境、特色細節），
// 作為精緻圖的場景參考，讓影片中的寺廟保持一致。可依指令重生並保留舊版本、切換選用的版本。
const path = require('node:path');
const { unprocessable } = require('../http');
const { templeVars, seriesVars, photosText } = require('../videos/vars');
const { estimateCost } = require('../cost/prices');
const wf = require('../videos/workflow');
const { text } = require('../util');

// 選用版本的背景板圖片（精緻圖的參考圖），沒有時回傳 null。
const selectedBoard = v => v.templeBoard?.versions?.find(x => x.version === v.templeBoard.selectedVersion)?.image || null;

function createStep3Service({ videos, generations, ledger, config }) {
  const readyPhotos = v => (v.photos || []).filter(p => p.status === 'ready');

  return {
    estimate: () => ({ action: 'temple-board', estimate: estimateCost('image', { count: 1 }) }),

    async generate(id, { instruction = '', consent = false } = {}) {
      const v = videos.get(id);
      wf.assertCanEnter(v, 3);
      const photos = readyPhotos(v);
      if (!photos.length) throw unprocessable('photos_required', '至少要有 1 張照片完成去識別，才能產生寺廟背景板');
      ledger.check(id, estimateCost('image', { count: 1 }), consent);
      const current = v.templeBoard?.versions?.find(x => x.version === v.templeBoard.selectedVersion);
      const variables = {
        temple: templeVars(v), photos: photosText(v), series: { style: seriesVars(v).style },
        reference: current ? `第 ${current.version} 版背景板` : '', instruction: text(instruction),
      };
      // 只送出去識別後的照片（media 資料夾），原圖不離開本機。
      const refs = photos.map(p => path.join(config.mediaDir, p.file));
      const { generation, result } = await generations.run({
        videoId: id, step: 3, promptId: 'temple-board', variables, instruction: text(instruction), consent: true,
        units: { count: 1 }, call: (ai, request) => ai.image.generate({ request, refs }),
      });
      return videos.mutate(id, 3, video => {
        const board = video.templeBoard || (video.templeBoard = { versions: [], selectedVersion: null });
        const version = Math.max(0, ...board.versions.map(x => x.version)) + 1;
        board.versions.push({
          version, instruction: text(instruction), photoIds: photos.map(p => p.id),
          image: { file: path.relative(config.mediaDir, result.file), generationId: generation.id },
        });
        board.selectedVersion = version;
      });
    },

    select(id, selectedVersion) {
      return videos.mutate(id, 3, v => {
        if (!v.templeBoard?.versions?.some(x => x.version === Number(selectedVersion))) throw unprocessable('invalid_version', '沒有這個版本');
        v.templeBoard.selectedVersion = Number(selectedVersion);
      });
    },
  };
}

function registerStep3Routes(router, { step3, present }) {
  const base = '/api/videos/:id/temple-board';
  const reply = video => ({ video: present(video) });
  router.post(`${base}/generate`, async ({ params, json }) => reply(await step3.generate(params.id, await json())));
  router.patch(base, async ({ params, json }) => reply(step3.select(params.id, (await json()).selectedVersion)));
}

module.exports = { createStep3Service, registerStep3Routes, selectedBoard };
