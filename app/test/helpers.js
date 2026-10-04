// 測試共用工具：在隨機埠啟動 app，資料放在暫存資料夾。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

function tempDir(prefix = 'templeyard-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function startApp(options = {}) {
  const dataDir = options.dataDir || tempDir();
  const app = createApp({ dataDir, detector: 'fake', output: { width: 320, height: 180, fps: 24 }, ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (method, url, body, headers = {}) => {
    const init = { method, headers: { ...headers } };
    if (body !== undefined) {
      if (Buffer.isBuffer(body)) init.body = body;
      else { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    }
    const res = await fetch(base + url, init);
    const type = res.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  };
  return {
    app, base, dataDir, request,
    get: url => request('GET', url),
    post: (url, body, headers) => request('POST', url, body ?? {}, headers),
    put: (url, body) => request('PUT', url, body ?? {}),
    del: url => request('DELETE', url),
    close: async () => { await app.close(); },
  };
}

module.exports = { startApp, tempDir };
