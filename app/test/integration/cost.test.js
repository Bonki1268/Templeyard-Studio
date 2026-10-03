const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('../helpers');
const { estimateCost, PRICES } = require('../../src/cost/prices');

const vars = { temple: { name: '鄞山寺' }, series: { style: '寫實' }, story: '渡海來台的故事。' };
const textCall = (ai, request) => ai.text.generate({ request, variables: vars });

async function setup(t, options = {}) {
  const s = await startApp(options);
  t.after(() => s.close());
  return s;
}

test('場景：生成前可以先看到預估費用', () => {
  assert.equal(estimateCost('video', { seconds: 4 }), +(4 * PRICES.video.perSecond).toFixed(4));
  assert.equal(estimateCost('image', { count: 8 }), +(8 * PRICES.image.perImage).toFixed(4));
  assert.equal(estimateCost('text'), PRICES.text.perCall);
});

test('場景：付費生成依預估、預留、結算記帳', async t => {
  const s = await setup(t);
  const { ledger, generations } = s.app.ctx;
  let during;
  const { generation } = await generations.run({
    videoId: 'v1', step: 2, promptId: 'copy-polish', variables: vars,
    call: async (ai, request) => { during = ledger.summary('v1'); return textCall(ai, request); },
  });
  assert.equal(during.reserved, PRICES.text.perCall);
  assert.equal(during.spent, 0);
  const after = ledger.summary('v1');
  assert.equal(after.reserved, 0);
  assert.equal(after.spent, PRICES.text.perCall);
  assert.equal(generation.cost, PRICES.text.perCall);
  assert.equal(generation.estimate, PRICES.text.perCall);
  const entries = ledger.entries('v1');
  assert.equal(entries[0].status, 'settled');
  assert.equal(entries[0].generationId, generation.id);
  const r = await s.get('/api/videos/v1/cost');
  assert.equal(r.data.cost.spent, PRICES.text.perCall);
  assert.equal(r.data.cost.cap, 20);
});

test('場景：生成失敗時退回預留金額', async t => {
  const s = await setup(t);
  const { ledger, generations, ai } = s.app.ctx;
  ai.failNext('text', '服務忙碌');
  await assert.rejects(generations.run({ videoId: 'v1', step: 2, promptId: 'copy-polish', variables: vars, call: textCall }), /服務忙碌/);
  const sum = ledger.summary('v1');
  assert.equal(sum.reserved, 0);
  assert.equal(sum.spent, 0);
  assert.equal(ledger.entries('v1')[0].status, 'refunded');
});

test('場景：單筆費用超過門檻時需要再次同意', async t => {
  const s = await setup(t);
  const { generations, ai } = s.app.ctx;
  const before = ai.calls.length;
  await assert.rejects(generations.run({
    videoId: 'v1', step: 2, promptId: 'copy-polish', variables: vars, estimate: 2.5, call: textCall,
  }), err => {
    assert.equal(err.status, 402);
    assert.equal(err.code, 'cost_consent_required');
    assert.equal(err.extra.reason, 'threshold');
    assert.match(err.message, /超過單筆門檻/);
    assert.equal(err.extra.estimate, 2.5);
    return true;
  });
  assert.equal(ai.calls.length, before);
});

test('場景：累計費用將超過上限時需要再次同意', async t => {
  const s = await setup(t, { costCapOf: () => 1 });
  const { generations } = s.app.ctx;
  await generations.run({ videoId: 'v1', step: 2, promptId: 'copy-polish', variables: vars, estimate: 0.95, call: textCall });
  await assert.rejects(generations.run({
    videoId: 'v1', step: 2, promptId: 'copy-polish', variables: vars, estimate: 0.1, call: textCall,
  }), err => err.code === 'cost_consent_required' && err.extra.reason === 'cap' && /超過費用上限/.test(err.message));
});

test('場景：同意後可以繼續生成並記帳', async t => {
  const s = await setup(t);
  const { generations, ledger } = s.app.ctx;
  await generations.run({ videoId: 'v1', step: 2, promptId: 'copy-polish', variables: vars, estimate: 2.5, consent: true, call: textCall });
  assert.equal(ledger.summary('v1').spent, 2.5);
});
