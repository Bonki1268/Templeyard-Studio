const test = require('node:test');
const assert = require('node:assert/strict');
const wf = require('../../src/videos/workflow');

const always = () => [];
const conditions = { 2: always, 3: always, 4: always, 5: always, 6: always };

function video() {
  return { id: 'v', steps: wf.initialSteps(), currentStep: 2, status: 'in_progress' };
}

test('場景：確認後記錄確認的內容版本並前進到下一步', () => {
  const v = video();
  wf.touch(v, 2);
  const rec = wf.confirm(v, 2, conditions);
  assert.equal(v.steps[2].status, 'confirmed');
  assert.equal(v.steps[2].confirmedRev, v.steps[2].rev);
  assert.equal(rec.step, 2);
  assert.equal(rec.rev, v.steps[2].rev);
  assert.equal(v.currentStep, 3);
});

test('場景：回頭修改前面的步驟時後續已確認的步驟標示需重新確認', () => {
  const v = video();
  wf.confirm(v, 2, conditions);
  wf.confirm(v, 3, conditions);
  assert.equal(v.currentStep, 4);
  wf.touch(v, 2);
  assert.equal(v.steps[2].status, 'pending');
  assert.equal(v.steps[3].status, 'stale');
  assert.equal(v.steps[4].status, 'pending');
  assert.equal(v.currentStep, 2);
  assert.throws(() => wf.confirm(v, 3, conditions), err => err.code === 'previous_step_not_confirmed');
  wf.confirm(v, 2, conditions);
  assert.equal(v.currentStep, 3);
  wf.confirm(v, 3, conditions);
  assert.equal(v.steps[3].status, 'confirmed');
});

test('確認全部 6 步後影片完成', () => {
  const v = video();
  for (const s of [2, 3, 4, 5, 6]) wf.confirm(v, s, conditions);
  assert.equal(v.status, 'done');
  assert.equal(v.currentStep, 6);
  wf.touch(v, 6);
  assert.equal(v.status, 'in_progress');
});

test('條件未滿足時列出原因', () => {
  const v = video();
  assert.throws(() => wf.confirm(v, 2, { 2: () => ['尚未選擇寺廟'] }), err => {
    assert.equal(err.code, 'conditions_not_met');
    assert.deepEqual(err.extra.unmet, ['尚未選擇寺廟']);
    return true;
  });
});

test('步驟 2 的確認條件', () => {
  const unmet = wf.CONDITIONS[2]({ templeId: null, photos: [], story: { adopted: '' } });
  assert.equal(unmet.length, 3);
  assert.deepEqual(wf.CONDITIONS[2]({ templeId: 't', photos: [{ status: 'ready' }], story: { adopted: '故事' } }), []);
  assert.equal(wf.CONDITIONS[2]({ templeId: 't', photos: [{ status: 'processing' }], story: { adopted: '故事' } }).length, 1);
});
