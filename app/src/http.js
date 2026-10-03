// HTTP 小工具：路由、JSON 回應、錯誤。
const fs = require('node:fs');
const path = require('node:path');

class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const notFound = (message = '找不到資料') => new HttpError(404, 'not_found', message);
const badRequest = (message, extra) => new HttpError(400, 'bad_request', message, extra);
const unprocessable = (code, message, extra) => new HttpError(422, code, message, extra);

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendError(res, err) {
  if (err instanceof HttpError) {
    return sendJson(res, err.status, { error: { code: err.code, message: err.message, ...err.extra } });
  }
  console.error(err);
  sendJson(res, 500, { error: { code: 'internal_error', message: '伺服器錯誤' } });
}

async function readRaw(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'too_large', '內容過大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const text = (await readRaw(req, 2_000_000)).toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw badRequest('不是合法的 JSON'); }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.json': 'application/json',
};

function sendFile(res, file, headers = {}) {
  let stat;
  try { stat = fs.statSync(file); } catch { throw notFound('找不到檔案'); }
  if (!stat.isFile()) throw notFound('找不到檔案');
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    ...headers,
  });
  fs.createReadStream(file).pipe(res);
}

// 路由：pattern 如 /api/series/:id，handler 回傳物件即以 200 JSON 回應。
class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, regex, keys, handler });
    return this;
  }
  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }
  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = pathname.match(r.regex);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return { pathMatched };
  }
}

module.exports = { HttpError, notFound, badRequest, unprocessable, sendJson, sendError, sendFile, readJson, readRaw, Router };
