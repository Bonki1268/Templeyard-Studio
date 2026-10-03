// 生成服務：組裝 prompt → 寫生成紀錄 → 呼叫 AI 服務 → 更新紀錄。
// 每筆紀錄保存輸入、使用者指令、prompt id 與版本、模型、狀態與成本。
const path = require('node:path');
const { estimateCost } = require('../cost/prices');

function createGenerationService({ store, prompts, ai, config, ledger }) {
  const rel = file => (file ? path.relative(config.dataDir, file) : undefined);

  // estimate 未指定時依生成類型與 units（seconds、count）計算；consent 表示使用者已同意超過門檻或上限。
  async function run({ videoId, step, promptId, variables = {}, instruction = '', model, target, call, meta = {}, estimate, units, consent = false }) {
    const request = await prompts.render(promptId, variables, { model });
    const kind = request.target?.kind;
    const cost = estimate ?? estimateCost(kind, units);
    ledger.check(videoId, cost, consent);
    let generation = store.insert('generations', {
      videoId, step, promptId, promptVersion: request.promptVersion, kind,
      provider: ai.name, model: request.target?.model || ai.models[kind] || '',
      input: variables, instruction, target, status: 'running', estimate: cost, cost: 0, ...meta,
    });
    const entry = ledger.reserve(videoId, cost, { generationId: generation.id, kind, step });
    try {
      const result = await call(ai, request);
      const actual = result.cost ?? cost;
      ledger.settle(entry.id, actual);
      generation = store.update('generations', generation.id, {
        status: 'succeeded', cost: actual, model: result.model || generation.model, output: rel(result.file) || (result.json ? result.json : undefined),
      });
      return { generation, result, request };
    } catch (err) {
      ledger.refund(entry.id);
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

function registerGenerationRoutes(router, { generations, ledger }) {
  router.get('/api/generations', ({ query }) => ({ generations: generations.list({ videoId: query.videoId }) }));
  router.get('/api/videos/:id/cost', ({ params }) => ({ cost: ledger.summary(params.id), entries: ledger.entries(params.id) }));
}

module.exports = { createGenerationService, registerGenerationRoutes };
