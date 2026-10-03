// 生成服務：組裝 prompt → 寫生成紀錄 → 呼叫 AI 服務 → 更新紀錄。
// 每筆紀錄保存輸入、使用者指令、prompt id 與版本、模型、狀態與成本。
const path = require('node:path');

function createGenerationService({ store, prompts, ai, config }) {
  const rel = file => (file ? path.relative(config.dataDir, file) : undefined);

  async function run({ videoId, step, promptId, variables = {}, instruction = '', model, target, call, meta = {} }) {
    const request = await prompts.render(promptId, variables, { model });
    const kind = request.target?.kind;
    let generation = store.insert('generations', {
      videoId, step, promptId, promptVersion: request.promptVersion, kind,
      provider: ai.name, model: request.target?.model || ai.models[kind] || '',
      input: variables, instruction, target, status: 'running', cost: 0, ...meta,
    });
    try {
      const result = await call(ai, request);
      generation = store.update('generations', generation.id, {
        status: 'succeeded', model: result.model || generation.model, output: rel(result.file) || (result.json ? result.json : undefined),
      });
      return { generation, result, request };
    } catch (err) {
      store.update('generations', generation.id, { status: 'failed', error: err.message });
      throw err;
    }
  }

  return {
    run,
    list: filter => store.list('generations', g => (!filter.videoId || g.videoId === filter.videoId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

function registerGenerationRoutes(router, { generations }) {
  router.get('/api/generations', ({ query }) => ({ generations: generations.list({ videoId: query.videoId }) }));
}

module.exports = { createGenerationService, registerGenerationRoutes };
