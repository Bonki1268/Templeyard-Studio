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
const { createPhotoService, registerPhotoRoutes } = require('./photos');
const { createDetector } = require('./media/deidentify');
const { createSigner } = require('./media/signed');
const { createStep2Service, registerStep2Routes } = require('./steps/step2');
const { createStep3Service, registerStep3Routes } = require('./steps/step3');
const { createStep4Service, registerStep4Routes } = require('./steps/step4');
const { createStep5Service, registerStep5Routes } = require('./steps/step5');
const { createStep6Service, registerStep6Routes } = require('./steps/step6');
const { createJobs } = require('./jobs');
const { DEFAULTS } = require('./cost/prices');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp(options = {}) {
  const config = {
    dataDir: options.dataDir || path.join(__dirname, '..', 'data'),
    aiProvider: options.aiProvider || process.env.AI_PROVIDER || 'fake',
    output: { width: 1920, height: 1080, fps: 24, ...(options.output || {}) },
    detector: options.detector || process.env.DETECTOR || 'auto',
  };
  config.mediaDir = path.join(config.dataDir, 'media');
  config.privateDir = path.join(config.dataDir, 'private');
  const clock = options.clock || (() => new Date());
  const router = new Router();
  const store = new Store(config.dataDir, { clock });
  const ctx = { config, router, store, clock };
  // 依相依順序建立服務（後面的服務會用到前面的）。
  ctx.temples = templeDb(options.templeCsv);
  ctx.jobs = createJobs();
  ctx.signer = createSigner({ clock, ttlSeconds: options.urlTtlSeconds || 3600 });
  ctx.present = value => present(value, ctx.signer);
  ctx.prompts = options.prompts || createPromptService(options.promptOptions);
  ctx.ai = options.ai || createProviders({ aiProvider: config.aiProvider, mediaDir: config.mediaDir, output: config.output });
  ctx.detector = createDetector(config.detector);
  ctx.ledger = createLedger({
    store,
    capOf: options.costCapOf || (videoId => store.get('videos', videoId)?.costCap ?? DEFAULTS.costCap),
    threshold: options.costThreshold ?? DEFAULTS.threshold,
  });
  ctx.generations = createGenerationService(ctx);
  ctx.series = createSeriesService(ctx);
  ctx.videos = createVideoService(ctx);
  ctx.photos = createPhotoService(ctx);
  ctx.step2 = createStep2Service(ctx);
  ctx.step3 = createStep3Service(ctx);
  ctx.step4 = createStep4Service(ctx);
  ctx.videos.hooks.before[4] = v => ctx.step4.lock(v);
  ctx.videos.hooks.after[4] = v => ctx.step4.syncSeries(v);
  ctx.step5 = createStep5Service(ctx);
  ctx.step6 = createStep6Service(ctx);
  // 預估費用：GET /api/videos/:id/estimate/:action
  ctx.estimators = {
    script: id => ctx.step3.estimate(id),
    characters: id => ctx.step4.estimate(id),
    frames: id => ctx.step5.estimate(id),
    clips: id => ctx.step6.estimate(id),
  };

  router.get('/api/health', () => ({ ok: true, aiProvider: config.aiProvider }));
  registerTempleRoutes(router, ctx.temples);
  registerSeriesRoutes(router, ctx);
  registerGenerationRoutes(router, ctx);
  registerVideoRoutes(router, ctx);
  registerPhotoRoutes(router, ctx);
  registerStep2Routes(router, ctx);
  registerStep3Routes(router, ctx);
  registerStep4Routes(router, ctx);
  registerStep5Routes(router, ctx);
  registerStep6Routes(router, ctx);
  router.get('/api/videos/:id/estimate/:action', ({ params }) => {
    const estimator = ctx.estimators[params.action];
    if (!estimator) throw notFound('沒有這個預估項目');
    return estimator(params.id);
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/media/')) return serveMedia(res, url);
      if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
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

  // 只提供 media 資料夾內、簽章有效且未過期的檔案；原圖在 private 資料夾，沒有任何網址可取得。
  function serveMedia(res, url) {
    let rel;
    try { rel = decodeURIComponent(url.pathname.slice('/media/'.length)); } catch { throw notFound('找不到檔案'); }
    const file = path.normalize(path.join(config.mediaDir, rel));
    if (!file.startsWith(config.mediaDir + path.sep)) throw notFound('找不到檔案');
    if (!ctx.signer.verify(rel, url.searchParams.get('exp'), url.searchParams.get('sig'))) {
      throw new HttpError(403, 'expired_url', '網址已過期或無效，請重新整理頁面');
    }
    const headers = { 'Cache-Control': 'private, max-age=600' };
    if (url.searchParams.get('download')) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(url.searchParams.get('download'))}`;
    sendFile(res, file, headers);
  }

  function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) throw notFound('找不到頁面');
    sendFile(res, file, { 'Cache-Control': 'no-store' });
  }

  return {
    server,
    ctx,
    close: async () => {
      await ctx.jobs.idle();
      await new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); });
    },
  };
}

// API 回應前的整理：有 file（media 相對路徑）的物件加上短期網址，移除原圖路徑（privateFile）。
function present(value, signer) {
  if (Array.isArray(value)) return value.map(v => present(v, signer));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === 'privateFile') continue;
    out[k] = present(v, signer);
  }
  if (typeof value.file === 'string' && !path.isAbsolute(value.file)) out.url = signer.url(value.file);
  return out;
}

module.exports = { createApp, present };
