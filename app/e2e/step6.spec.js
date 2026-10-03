const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { videoAtStep } = require('./helpers');

test.describe.serial('步驟 6 影片生成', () => {
  let ctx;
  test.beforeAll(async ({ request }) => { ctx = await videoAtStep(request, 6); });

  test('場景：生成分鏡影片前顯示預估費用並需再次同意', async ({ page }) => {
    await page.goto(`/#/videos/${ctx.video.id}/6`);
    await page.getByRole('button', { name: /生成分鏡影片（預估 US\$3\.00）/ }).click();
    const dialog = page.getByRole('dialog', { name: '費用確認' });
    await expect(dialog).toContainText('超過單筆門檻');
    await dialog.getByRole('button', { name: '同意並繼續' }).click();
    await expect(page.getByTestId('clip')).toHaveCount(10);
    await expect(page.getByTestId('clip').filter({ hasText: '已完成' })).toHaveCount(10, { timeout: 60_000 });
  });

  test('場景：選一格依指令重生分鏡影片', async ({ page }) => {
    await page.goto(`/#/videos/${ctx.video.id}/6`);
    await page.getByTestId('clip').nth(1).click();
    await page.getByLabel('第 2 格的調整指令').fill('轉頭的動作慢一點，口型對準台詞');
    await page.getByRole('button', { name: '依指令重生' }).click();
    await expect(page.getByRole('button', { name: 'v2', exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
  });

  test('場景：設定聲音與字幕後合成成品', async ({ page }) => {
    await page.goto(`/#/videos/${ctx.video.id}/6`);
    await page.getByLabel('背景音樂').selectOption({ label: '柔和弦樂' });
    await page.getByRole('button', { name: /合成成品/ }).click();
    await expect(page.getByTestId('final-info')).toContainText('成品', { timeout: 60_000 });
    await expect(page.getByTestId('preview').locator('video')).toHaveAttribute('src', /final-v\d+\.mp4/);
  });

  test('場景：確認成品後下載 MP4', async ({ page }) => {
    await page.goto(`/#/videos/${ctx.video.id}/6`);
    await page.getByRole('button', { name: '確認成品' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: '下載 MP4' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.mp4$/);
    const file = await download.path();
    expect(fs.statSync(file).size).toBeGreaterThan(1000);
  });
});
