const { test, expect } = require('@playwright/test');
const { createSeries } = require('./helpers');

test.describe('系列角色新增與 AI 輔助', () => {
  test('場景：在系列頁新增角色並請 AI 撰寫描述', async ({ page, request }) => {
    const series = await createSeries(request, { name: '新莊廟街故事', characters: [] });
    await page.goto(`/#/series/${series.id}`);
    await page.getByRole('button', { name: '新增角色' }).click();
    await page.getByLabel('角色名稱').fill('廟公阿伯');
    await page.getByLabel('構想或外觀描述').fill('在廟口顧了四十年的老廟公');
    await page.getByRole('button', { name: /AI 撰寫描述/ }).click();
    await expect(page.getByLabel('構想或外觀描述')).not.toHaveValue('在廟口顧了四十年的老廟公');
    const drafted = await page.getByLabel('構想或外觀描述').inputValue();
    await page.getByRole('button', { name: '加入角色' }).click();
    const item = page.getByTestId('series-character').filter({ hasText: '廟公阿伯' });
    await expect(item).toBeVisible();
    await expect(item).toContainText(drafted.slice(0, 10));
  });

  test('場景：在系列頁產生定裝圖並鎖定版本', async ({ page, request }) => {
    const series = await createSeries(request, { name: '板橋慈惠宮巡禮' });
    await page.goto(`/#/series/${series.id}`);
    await page.getByTestId('series-character').filter({ hasText: '導覽員小晴' }).getByRole('button', { name: '定裝圖' }).click();
    const panel = page.getByTestId('series-character-panel');
    await panel.getByRole('button', { name: /產生定裝圖/ }).click();
    await expect(panel.getByRole('img', { name: '導覽員小晴 定裝圖' })).toBeVisible();
    await panel.getByRole('button', { name: '鎖定此版本' }).click();
    const item = page.getByTestId('series-character').filter({ hasText: '導覽員小晴' });
    await expect(item).toContainText('定裝版本 v1・已鎖定');
    await expect(item.getByRole('img', { name: '導覽員小晴定裝圖' })).toBeVisible();
  });
});
