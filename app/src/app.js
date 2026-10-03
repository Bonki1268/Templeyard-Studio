// 組裝整個應用：依設定建立各服務，註冊路由，回傳 HTTP 伺服器。
const http = require('node:http');
const path = require('node:path');
const { registerTempleRoutes, templeDb } = require('./temples/search');
const { Router, sendJson, sendError, sendFile, readJson, readRaw, notFound, HttpError } = require('./http');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp(options = {}) {
  const config = {
    dataDir: options.dataDir || path.join(__dirname, '..', 'data'),
    aiProvider: options.aiProvider || process.env.AI_PROVIDER || 'fake',
  };
  const router = new Router();
  const ctx = { config, router };

  const temples = templeDb(options.templeCsv);
  ctx.temples = temples;

  router.get('/api/health', () => ({ ok: true, aiProvider: config.aiProvider }));
  registerTempleRoutes(router, temples);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/media/')) {
        return serveStatic(res, url.pathname);
      }
      const found = router.match(req.method, url.pathname);
      if (!found.route) {
        if (found.pathMatched) throw new HttpError(405, 'method_not_allowed', '不支援的操作');
        throw notFound('找不到 API');
      }
      const request = {
        req, res, url, params: found.params, query: Object.fromEntries(url.searchParams),
        json: () => readJson(req),
        raw: (limit = 30_000_000) => readRaw(req, limit),
      };
      const result = await found.route.handler(request);
      if (result === undefined) return; // handler 自己回應（例如檔案下載）
      sendJson(res, result.__status || 200, result);
    } catch (err) {
      if (res.headersSent) { res.destroy(); return; }
      sendError(res, err);
    }
  });

  function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) throw notFound('找不到頁面');
    sendFile(res, file, { 'Cache-Control': 'no-store' });
  }

  return {
    server,
    ctx,
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

module.exports = { createApp };
