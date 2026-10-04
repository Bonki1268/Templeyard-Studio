const { test, expect } = require('@playwright/test');
const { videoAtStep } = require('./helpers');

test.describe.serial('步驟 5 精緻圖', () => {
  let ctx;
  test.beforeAll(async ({ request }) => { ctx = await videoAtStep(request, 5); });

  test('場景：產生精緻圖前顯示預估費用', async ({ page }) => {
    await page.goto(`/#/videos/${ctx.video.id}/5`);
    await expect(page.getByRole('button', { name: /產生精緻圖（預估 US\$\d+\.\d\d）/ })).toBeVisible();
  });

  test('場景：分鏡膠捲逐格顯示進度並填上精緻圖', async ({ page }) => {
    await page.goto(`/#/videos/${ctx.video.id}/5`);
    await page.getByRole('button', { name: /產生精緻圖/ }).click();
    await expect(page.getByTestId('strip-frame')).toHaveCount(10);
    await expect(page.getByTestId('progress')).toContainText('10／10 格完成');
    await expect(page.getByTestId('strip-frame').locator('img')).toHaveCount(10);
  });

  test('場景：點選膠捲中的一格查看大圖與候選版本', async ({ page }) => {
    await page.goto(`/#/videos/${ctx.video.id}/5`);
    await page.getByTestId('strip-frame').nth(1).click();
    await expect(page.getByRole('heading', { name: /^第 2 格：/ })).toBeVisible();
    await expect(page.getByTestId('candidate')).toHaveText(['版本 1・已選']);
  });

  test('場景：依指令重生並選定候選版本', async ({ page }) => {
    await page.goto(`/#/videos/${ctx.video.id}/5`);
    await page.getByTestId('strip-frame').nth(1).click();
    await page.getByLabel('調整指令').fill('光線再暖一點，小晴往畫面左邊站');
    await page.getByRole('button', { name: '依指令重生' }).click();
    await expect(page.getByTestId('candidate')).toHaveText(['版本 1', '版本 2・已選']);
    await page.getByTestId('candidate').first().click();
    await expect(page.getByTestId('candidate')).toHaveText(['版本 1・已選', '版本 2']);
  });

  test('場景：勾選品質檢查', async ({ page }) => {
    await page.goto(`/#/videos/${ctx.video.id}/5`);
    await page.getByLabel('角色臉、髮型、服裝與定妝板一致').check();
    await expect(page.getByTestId('quality-saved')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('角色臉、髮型、服裝與定妝板一致')).toBeChecked();
  });

  test('場景：每格都有精緻圖後確認並前往影片生成', async ({ page }) => {
    await page.goto(`/#/videos/${ctx.video.id}/5`);
    await page.getByRole('button', { name: '確認精緻圖，生成影片' }).click();
    await expect(page).toHaveURL(new RegExp(`#/videos/${ctx.video.id}/6$`));
  });
});
