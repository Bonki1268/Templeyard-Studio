const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 用暫存資料夾的複本測試，不動到真正的 prompts/
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prompts-'));
for (const f of fs.readdirSync(path.join(__dirname, '..', 'prompts')).filter(f => f.endsWith('.json'))) {
  fs.copyFileSync(path.join(__dirname, '..', 'prompts', f), path.join(tmp, f));
}
process.env.PROMPT_DIR = tmp;
const { server } = require('../server');
const { validate } = require('../lib/prompt');

let base;
test.before(() => new Promise(r => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const call = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test('六個節點的 prompt 檔都通過驗證', () => {
  const files = fs.readdirSync(tmp).filter(f => f.endsWith('.json'));
  assert.equal(files.length, 6);
  for (const f of files) assert.deepEqual(validate(JSON.parse(fs.readFileSync(path.join(tmp, f), 'utf8'))), [], f);
});

test('列出 prompt，依步驟排序', async () => {
  const { status, body } = await call('GET', '/api/prompts');
  assert.equal(status, 200);
  assert.deepEqual(body.prompts.map(p => p.step), [2, 3, 3, 4, 5, 6]);
});

test('組裝：帶入巢狀變數並產生 JavaScript', async () => {
  const vars = { temple: { name: '鄞山寺', district: '淡水區' }, series: { style: '寫實', duration: 15 }, story: '渡海來台的故事' };
  const { status, body } = await call('POST', '/api/prompts/story-script/render', { variables: vars });
  assert.equal(status, 200);
  const content = body.request.messages[0].content;
  assert.match(content, /鄞山寺（淡水區/);
  assert.match(content, /15 秒/);
  assert.doesNotMatch(content, /\{\{/);
  assert.equal(body.request.output.format, 'json');
  assert.match(body.compiled, /export function build/);
});

test('組裝：缺少必要變數時拒絕', async () => {
  const { status, body } = await call('POST', '/api/prompts/story-script/render', { variables: {} });
  assert.equal(status, 422);
  assert.equal(body.error.code, 'missing_variables');
  assert.ok(body.error.missing.includes('story'));
});

test('儲存：寫入檔案、版本加一、保留歷史版本', async () => {
  const { body: { prompt } } = await call('GET', '/api/prompts/shot-video');
  const edited = { ...prompt, template: prompt.template + '\n補充：{{shot.camera}}' };
  const { status, body } = await call('PUT', '/api/prompts/shot-video', { prompt: edited, expectedVersion: prompt.version });
  assert.equal(status, 200);
  assert.equal(body.prompt.version, prompt.version + 1);
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, 'shot-video.json'), 'utf8'));
  assert.match(onDisk.template, /補充：/);
  const hist = await call('GET', '/api/prompts/shot-video/history');
  assert.equal(hist.body.versions[0].version, prompt.version);
  const old = await call('GET', `/api/prompts/shot-video/history/${prompt.version}`);
  assert.doesNotMatch(old.body.prompt.template, /補充：/);
});

test('儲存：版本不符時回 409，不覆蓋檔案', async () => {
  const { body: { prompt } } = await call('GET', '/api/prompts/copy-polish');
  const { status } = await call('PUT', '/api/prompts/copy-polish', { prompt: { ...prompt, name: 'X' }, expectedVersion: prompt.version - 1 });
  assert.equal(status, 409);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'copy-polish.json'), 'utf8')).name, prompt.name);
});

test('儲存：用到未宣告的變數時回 422', async () => {
  const { body: { prompt } } = await call('GET', '/api/prompts/character-sheet');
  const { status, body } = await call('PUT', '/api/prompts/character-sheet', { prompt: { ...prompt, template: '{{unknown.var}}' }, expectedVersion: prompt.version });
  assert.equal(status, 422);
  assert.ok(body.error.details.some(d => d.includes('unknown.var')));
});

test('拒絕不合法的 id 與路徑穿越', async () => {
  assert.equal((await call('GET', '/api/prompts/..%2Fserver')).status, 400);
  const res = await fetch(base + '/../server.js');
  assert.notEqual((await res.text()).includes('createServer'), true);
});
