// 端對端測試：以假實作啟動伺服器（暫存資料夾），用本機 Chromium 操作網頁。
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { defineConfig } = require('@playwright/test');

const PORT = Number(process.env.E2E_PORT || 3999);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'templeyard-e2e-'));

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, acceptDownloads: true, viewport: { width: 1280, height: 900 } },
  webServer: {
    command: 'node server.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), DATA_DIR: dataDir, AI_PROVIDER: 'fake', E2E: '1' },
  },
});
