const { test, expect } = require('@playwright/test');
const { videoAtStep } = require('./helpers');

test.describe.serial('步驟 3 寺廟背景板', () => {
  let ctx;
  test.beforeAll(async ({ request }) => { ctx = await videoAtStep(request, 3); });

  test('場景：步驟列顯示 7 個步驟', async ({ page }) => {
    await page.goto(`/#/videos/${ctx.video.id}/3`);
    await expect(page.locator('.stepper li')).toHaveText([/系列設定/, /新增影片/, /寺廟背景板/, /故事腳本/, /角色設計/, /精緻圖/, /影片生成/]);
    await expect(page.locator('.stepper .current')).toContainText('寺廟背景板');
  });

  test('場景：寺廟背景板頁產生並確認背景板', async ({ page }) => {
    await page.goto(`/#/videos/${ctx.video.id}/3`);
    await expect(page.getByRole('button', { name: '確認背景板，產生故事腳本' })).toBeDisabled();
    await page.getByRole('button', { name: /產生寺廟背景板（預估 US\$\d+\.\d\d）/ }).click();
    await expect(page.getByRole('img', { name: '寺廟背景板' })).toBeVisible();
    const legend = page.getByTestId('temple-board-legend');
    for (const text of ['正面全景', '斜角／側面', '廟埕與周邊環境', '特色細節特寫']) await expect(legend).toContainText(text);
    await page.getByRole('button', { name: '確認背景板，產生故事腳本' }).click();
    await expect(page).toHaveURL(new RegExp(`#/videos/${ctx.video.id}/4$`));
    await expect(page.locator('.stepper .current')).toContainText('故事腳本');
  });
});
