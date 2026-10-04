// 生成等待動畫與深色介面。等待狀態以攔截 API 回應模擬（延後回應或把狀態改成生成中），伺服器仍是假實作。
const { test, expect } = require('@playwright/test');
const { createSeries, videoAtStep } = require('./helpers');

// 把 GET /api/videos/:id 的回應改寫後再交給頁面。
async function patchVideo(page, videoId, patch) {
  await page.route(new RegExp(`/api/videos/${videoId}$`), async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    patch(body.video);
    await route.fulfill({ response: res, json: body });
  });
}

test.describe('生成等待動畫與深色介面', () => {
  test('場景：等待生成時按鈕與畫面顯示粒子動畫', async ({ page, request }) => {
    const series = await createSeries(request, { name: '關渡宮巡禮' });
    let release;
    const gate = new Promise(r => { release = r; });
    await page.route(/\/characters\/[^/]+\/generate$/, async route => { await gate; await route.continue(); });
    await page.goto(`/#/series/${series.id}/characters`);
    await page.getByTestId('library-character').getByRole('button', { name: '定妝板' }).click();
    const panel = page.getByTestId('library-character-panel');
    const button = panel.getByRole('button', { name: /產生定妝板/ });
    await button.click();
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button.locator('canvas')).toHaveCount(1);
    const overlay = page.getByTestId('busy-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.getByRole('status')).toContainText('生成中');
    release();
    await expect(panel.getByRole('img', { name: '導覽員小晴 定妝板' })).toBeVisible();
    await expect(overlay).toHaveCount(0);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  });

  test('場景：等待生成時跳出費用確認仍可以操作', async ({ page, request }) => {
    const { video } = await videoAtStep(request, 7);
    let release;
    const gate = new Promise(r => { release = r; });
    // 第一次（未同意）延後回覆 402，讓「生成中」先出現；同意後的請求也先擋住，確認動畫會再出現。
    await page.route(/\/clips\/generate$/, async route => {
      const body = route.request().postDataJSON() || {};
      if (!body.consent) { await new Promise(r => setTimeout(r, 900)); return route.continue(); }
      await gate;
      return route.continue();
    });
    await page.goto(`/#/videos/${video.id}/7`);
    await page.getByRole('button', { name: /生成分鏡影片/ }).click();
    const dialog = page.getByRole('dialog', { name: '費用確認' });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('busy-overlay')).toHaveCount(0);
    await dialog.getByRole('button', { name: '同意並繼續' }).click({ timeout: 3000 });
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('busy-overlay')).toBeVisible();
    release();
    await expect(page.getByTestId('busy-overlay')).toHaveCount(0);
  });

  test('場景：精緻圖生成中的格子顯示粒子動畫', async ({ page, request }) => {
    const { video } = await videoAtStep(request, 6);
    await patchVideo(page, video.id, v => {
      const first = v.script.shots[0].id;
      v.frames[first] = { ...(v.frames[first] || {}), status: 'running', candidates: [], selected: null };
    });
    await page.goto(`/#/videos/${video.id}/6`);
    const tile = page.getByTestId('strip-frame').first();
    await expect(tile.getByRole('status', { name: /生成中/ })).toBeVisible();
    await expect(tile.locator('canvas')).toHaveCount(1);
  });

  test('場景：成品合成中顯示粒子動畫', async ({ page, request }) => {
    const { video } = await videoAtStep(request, 7);
    await request.post(`/api/videos/${video.id}/clips/generate`, { data: { consent: true } });
    await expect.poll(async () => {
      const v = (await (await request.get(`/api/videos/${video.id}`)).json()).video;
      return v.script.shots.every(s => v.clips[s.id]?.status === 'done');
    }, { timeout: 60_000 }).toBe(true);
    await patchVideo(page, video.id, v => { v.final = { status: 'composing' }; });
    await page.goto(`/#/videos/${video.id}/7`);
    const loader = page.getByTestId('preview').getByRole('status', { name: /成品合成中/ });
    await expect(loader).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('場景：系統設定減少動態效果時粒子動畫不播放', async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { video } = await videoAtStep(request, 6);
    await patchVideo(page, video.id, v => { v.frames[v.script.shots[0].id] = { status: 'running', candidates: [], selected: null }; });
    await page.goto(`/#/videos/${video.id}/6`);
    const loader = page.getByTestId('strip-frame').first().getByRole('status');
    await expect(loader).toHaveAttribute('data-motion', 'static');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('場景：網頁使用深色工作室風格', async ({ page }) => {
    await page.goto('/#/');
    const style = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const primary = document.querySelector('.btn-primary');
      const p = primary && getComputedStyle(primary);
      return { bg: body.backgroundColor, font: body.fontFamily, btnBg: p?.backgroundColor, btnColor: p?.color };
    });
    expect(style.bg).toBe('rgb(15, 15, 16)');
    expect(style.font).toMatch(/Inter/);
    expect(style.font).toMatch(/Noto Sans TC/);
    expect(style.btnBg).toBe('rgb(250, 250, 250)');
    expect(style.btnColor).toBe('rgb(15, 15, 16)');
  });
});
