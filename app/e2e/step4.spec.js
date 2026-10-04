const { test, expect } = require('@playwright/test');
const { videoAtStep } = require('./helpers');

test.describe.serial('步驟 4 角色設計', () => {
  let ctx;
  test.beforeAll(async ({ request }) => { ctx = await videoAtStep(request, 4, { characters: [] }); });

  test('場景：產生角色前顯示預估費用', async ({ page }) => {
    await page.goto(`/#/videos/${ctx.video.id}/4`);
    await expect(page.getByRole('button', { name: /產生角色（預估 US\$\d+\.\d\d）/ })).toBeVisible();
  });

  test('場景：產生後看到三視圖與定裝圖', async ({ page }) => {
    await page.goto(`/#/videos/${ctx.video.id}/4`);
    await page.getByRole('button', { name: /產生角色/ }).click();
    await expect(page.getByTestId('character-item')).toContainText('導覽員');
    for (const name of ['正面', '側面', '背面', '定裝圖']) {
      await expect(page.getByRole('img', { name: new RegExp(name) })).toBeVisible();
    }
  });

  test('場景：依指令重新產生角色並切換版本', async ({ page }) => {
    await page.goto(`/#/videos/${ctx.video.id}/4`);
    await page.getByLabel('調整指令').fill('換成灰色唐裝、戴老花眼鏡');
    await page.getByRole('button', { name: '依指令重新生成' }).click();
    await expect(page.getByRole('button', { name: 'v2', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'v1', exact: true }).click();
    await expect(page.getByRole('button', { name: 'v1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('場景：勾選加入系列角色並確認', async ({ page }) => {
    await page.goto(`/#/videos/${ctx.video.id}/4`);
    await page.getByLabel('確認後加入系列角色，之後的影片也能使用').check();
    await page.getByRole('button', { name: '確認角色，產生精緻圖' }).click();
    await expect(page).toHaveURL(new RegExp(`#/videos/${ctx.video.id}/5$`));
    await page.goto(`/#/series/${ctx.series.id}`);
    await expect(page.getByTestId('series-character')).toContainText('導覽員');
    await expect(page.getByTestId('series-character')).toContainText('已鎖定');
  });
});
