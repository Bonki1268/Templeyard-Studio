const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers');
const { createFakeProviders } = require('../../src/ai/fake');

const vars = {
  temple: { name: '鄞山寺', district: '淡水區' },
  series: { style: '溫暖寫實', direction: '在地歷史故事' },
  story: '老一輩說，當年移民渡海來台。',
};

test('場景：每次生成都寫入生成紀錄', async t => {
  const s = await startApp();
  t.after(() => s.close());
  const gen = s.app.ctx.generations;
  const { generation, result } = await gen.run({
    videoId: 'v1', step: 2, promptId: 'copy-polish', variables: { ...vars, instruction: '簡短一點' }, instruction: '簡短一點',
    call: (ai, request) => ai.text.generate({ request, variables: vars }),
  });
  assert.ok(result.json.polished);
  assert.equal(generation.status, 'succeeded');
  assert.equal(generation.promptId, 'copy-polish');
  assert.ok(generation.promptVersion >= 2);
  assert.equal(generation.kind, 'text');
  assert.equal(generation.model, 'fake-text');
  assert.equal(generation.provider, 'fake');
  assert.equal(generation.instruction, '簡短一點');
  assert.equal(generation.input.story, vars.story);
  assert.equal(typeof generation.cost, 'number');
  const r = await s.get('/api/generations?videoId=v1');
  assert.equal(r.data.generations.length, 1);
  assert.equal(r.data.generations[0].id, generation.id);
});

test('場景：生成失敗時紀錄為失敗並保留錯誤訊息', async t => {
  const s = await startApp();
  t.after(() => s.close());
  await assert.rejects(s.app.ctx.generations.run({
    videoId: 'v2', step: 2, promptId: 'copy-polish', variables: vars,
    call: () => { throw new Error('服務暫時無法使用'); },
  }), /服務暫時無法使用/);
  const r = await s.get('/api/generations?videoId=v2');
  assert.equal(r.data.generations[0].status, 'failed');
  assert.match(r.data.generations[0].error, /服務暫時無法使用/);
});
