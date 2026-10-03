// Prompt Studio：管理各節點 prompt JSON 檔的頁面與 API。
// 啟動：node server.js（預設 http://localhost:3300），不需安裝套件。

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { validate, render, compileToJs } = require('./lib/prompt');

const ROOT = __dirname;
const PROMPT_DIR = process.env.PROMPT_DIR || path.join(ROOT, 'prompts');
const HISTORY_DIR = path.join(PROMPT_DIR, '.history');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3300);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body, null, 2));
}

function fail(res, status, code, message, extra = {}) {
  send(res, status, { error: { code, message, ...extra } });
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw Object.assign(new Error('內容過大'), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('不是合法的 JSON'), { status: 400 }); }
}

const filePath = id => path.join(PROMPT_DIR, `${id}.json`);

async function loadPrompt(id) {
  if (!ID_PATTERN.test(id)) return null;
  try { return JSON.parse(await fs.readFile(filePath(id), 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function listPrompts() {
  const names = (await fs.readdir(PROMPT_DIR)).filter(n => n.endsWith('.json'));
  const items = [];
  for (const n of names) {
    try {
      const p = JSON.parse(await fs.readFile(path.join(PROMPT_DIR, n), 'utf8'));
      items.push({ id: p.id, name: p.name, step: p.step, target: p.target?.kind, version: p.version, updatedAt: p.updatedAt });
    } catch {
      items.push({ id: n.replace(/\.json$/, ''), name: `（無法解析：${n}）`, step: 0, broken: true });
    }
  }
  return items.sort((a, b) => a.step - b.step || a.id.localeCompare(b.id));
}

// 寫檔先寫暫存檔再改名，避免寫到一半的檔案被讀到。
async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, file);
}

let writeQueue = Promise.resolve();
const serialize = fn => (writeQueue = writeQueue.then(fn, fn));

async function savePrompt(id, incoming, expectedVersion) {
  return serialize(async () => {
    const current = await loadPrompt(id);
    if (current && expectedVersion !== current.version) {
      return { conflict: true, current };
    }
    const next = { ...incoming, id, version: (current?.version || 0) + 1, updatedAt: new Date().toISOString() };
    const errors = validate(next);
    if (errors.length) return { errors };
    if (current) {
      const dir = path.join(HISTORY_DIR, id);
      await fs.mkdir(dir, { recursive: true });
      await writeAtomic(path.join(dir, `v${current.version}.json`), current);
    }
    await writeAtomic(filePath(id), next);
    return { saved: next };
  });
}

async function history(id) {
  try {
    const names = await fs.readdir(path.join(HISTORY_DIR, id));
    const items = [];
    for (const n of names.filter(n => /^v\d+\.json$/.test(n))) {
      const p = JSON.parse(await fs.readFile(path.join(HISTORY_DIR, id, n), 'utf8'));
      items.push({ version: p.version, updatedAt: p.updatedAt });
    }
    return items.sort((a, b) => b.version - a.version);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return fail(res, 404, 'not_found', '找不到頁面');
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    fail(res, 404, 'not_found', '找不到頁面');
  }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] !== 'api') return serveStatic(res, url.pathname);

  // GET /api/prompts
  if (parts.length === 2 && parts[1] === 'prompts' && req.method === 'GET') {
    return send(res, 200, { prompts: await listPrompts() });
  }

  if (parts[1] !== 'prompts' || !parts[2]) return fail(res, 404, 'not_found', '找不到 API');
  const id = parts[2];
  if (!ID_PATTERN.test(id)) return fail(res, 400, 'invalid_id', 'id 格式不合法');
  const action = parts[3];

  // GET /api/prompts/:id
  if (!action && req.method === 'GET') {
    const p = await loadPrompt(id);
    return p ? send(res, 200, { prompt: p }) : fail(res, 404, 'not_found', `找不到 prompt：${id}`);
  }

  // PUT /api/prompts/:id  body: { prompt, expectedVersion }
  if (!action && req.method === 'PUT') {
    const body = await readBody(req);
    if (!body.prompt) return fail(res, 400, 'bad_request', '缺少 prompt');
    const result = await savePrompt(id, body.prompt, body.expectedVersion ?? null);
    if (result.conflict) return fail(res, 409, 'version_conflict', '檔案已被其他人更新，請重新載入後再修改', { current: result.current });
    if (result.errors) return fail(res, 422, 'invalid_prompt', '內容未通過驗證', { details: result.errors });
    return send(res, 200, { prompt: result.saved });
  }

  // GET /api/prompts/:id/history[/:version]
  if (action === 'history' && req.method === 'GET') {
    if (parts[4]) {
      const v = Number(parts[4]);
      if (!Number.isInteger(v)) return fail(res, 400, 'bad_request', '版本號不合法');
      try {
        const p = JSON.parse(await fs.readFile(path.join(HISTORY_DIR, id, `v${v}.json`), 'utf8'));
        return send(res, 200, { prompt: p });
      } catch {
        return fail(res, 404, 'not_found', `找不到第 ${v} 版`);
      }
    }
    return send(res, 200, { versions: await history(id) });
  }

  // POST /api/prompts/:id/render  body: { variables, prompt?, model? }
  // prompt 可帶入未儲存的草稿，用於編輯頁預覽；系統呼叫時只帶 variables。
  if (action === 'render' && req.method === 'POST') {
    const body = await readBody(req);
    const p = body.prompt || (await loadPrompt(id));
    if (!p) return fail(res, 404, 'not_found', `找不到 prompt：${id}`);
    const errors = validate(p);
    if (errors.length) return fail(res, 422, 'invalid_prompt', '內容未通過驗證', { details: errors });
    const { missing, request } = render(p, body.variables || {}, { model: body.model });
    if (missing.length && !body.allowMissing) {
      return fail(res, 422, 'missing_variables', `缺少必要變數：${missing.join('、')}`, { missing, request });
    }
    return send(res, 200, { request, missing, compiled: compileToJs(p) });
  }

  return fail(res, 405, 'method_not_allowed', '不支援的操作');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error(err);
    fail(res, err.status || 500, err.status ? 'bad_request' : 'internal_error', err.status ? err.message : '伺服器錯誤');
  });
});

if (require.main === module) {
  fs.mkdir(HISTORY_DIR, { recursive: true }).then(() => {
    server.listen(PORT, () => console.log(`Prompt Studio：http://localhost:${PORT}`));
  });
}

module.exports = { server };
