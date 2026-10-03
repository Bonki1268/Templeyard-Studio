// 組裝整個應用：依設定建立各服務，註冊路由，回傳 HTTP 伺服器。
const http = require('node:http');
const path = require('node:path');
const { registerTempleRoutes, templeDb } = require('./temples/search');
const { Router, Reply, sendJson, sendError, sendFile, readJson, readRaw, notFound, HttpError } = require('./http');
const { Store } = require('./store/store');
const { createSeriesService, registerSeriesRoutes } = require('./series');
const { createPromptService } = require('./prompts');
const { createProviders } = require('./ai');
const { createGenerationService, registerGenerationRoutes } = require('./ai/generation');
const { createLedger } = require('./cost/ledger');
const { createVideoService, registerVideoRoutes } = require('./videos');
const { DEFAULTS } = require('./cost/prices');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp(options = {}) {
  const config = {
    dataDir: options.dataDir || path.join(__dirname, '..', 'data'),
    aiProvider: options.aiProvider || process.env.AI_PROVIDER || 'fake',
    output: { width: 1920, height: 1080, fps: 24, ...(options.output || {}) },
  };
  config.mediaDir = path.join(config.dataDir, 'media');
  config.privateDir = path.join(config.dataDir, 'private');
  const clock = options.clock || (() => new Date());
  const router = new Router();
  const store = new Store(config.dataDir, { clock });
  const ctx = { config, router, store, clock };
  ctx.series = createSeriesService(ctx);
  ctx.videos = createVideoService(ctx);
  ctx.prompts = options.prompts || createPromptService(options.promptOptions);
  ctx.ai = options.ai || createProviders({ aiProvider: config.aiProvider, mediaDir: config.mediaDir, output: config.output });
  ctx.ledger = createLedger({
    store,
    capOf: options.costCapOf || (videoId => store.get('videos', videoId)?.costCap ?? DEFAULTS.costCap),
    threshold: options.costThreshold ?? DEFAULTS.threshold,
  });
  ctx.generations = createGenerationService(ctx);

  const temples = templeDb(options.templeCsv);
  ctx.temples = temples;

  router.get('/api/health', () => ({ ok: true, aiProvider: config.aiProvider }));
  registerTempleRoutes(router, temples);
  registerSeriesRoutes(router, ctx);
  registerGenerationRoutes(router, ctx);
  registerVideoRoutes(router, ctx);

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
      if (result instanceof Reply) sendJson(res, result.status, result.body);
      else sendJson(res, 200, result);
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
