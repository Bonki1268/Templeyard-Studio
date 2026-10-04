const { test, expect } = require('@playwright/test');
const { videoAtStep } = require('./helpers');

test.describe.serial('步驟 4 故事腳本', () => {
  let videoId;
  test.beforeAll(async ({ request }) => { videoId = (await videoAtStep(request, 4)).video.id; });

  test('場景：產生腳本前顯示預估費用', async ({ page }) => {
    await page.goto(`/#/videos/${videoId}/4`);
    await expect(page.getByRole('button', { name: /產生腳本與分鏡圖（預估 US\$\d+\.\d\d）/ })).toBeVisible();
  });

  test('場景：產生腳本後顯示每格分鏡圖與說明', async ({ page }) => {
    await page.goto(`/#/videos/${videoId}/4`);
    await page.getByRole('button', { name: /產生腳本與分鏡圖/ }).click();
    await expect(page.getByTestId('shot')).toHaveCount(10);
    const first = page.getByTestId('shot').first();
    await expect(first).toContainText('第 1 格');
    await expect(first).toContainText('遠景');
    await expect(first.locator('img')).toBeVisible();
    await expect(page.getByTestId('total')).toContainText('30／30 秒・10 格');
  });

  test('場景：在編輯面板修改分鏡說明', async ({ page }) => {
    await page.goto(`/#/videos/${videoId}/4`);
    const shot = page.getByTestId('shot').nth(1);
    await shot.getByRole('button', { name: '編輯' }).click();
    await expect(page.getByRole('heading', { name: '編輯第 2 格' })).toBeVisible();
    await page.getByLabel('台詞或旁白').fill('這座廟，藏著老一輩才知道的故事。');
    await page.getByRole('button', { name: '儲存此格' }).click();
    await expect(page.getByTestId('shot').nth(1)).toContainText('這座廟，藏著老一輩才知道的故事。');
  });

  test('場景：重生單一分鏡', async ({ page }) => {
    await page.goto(`/#/videos/${videoId}/4`);
    const img = page.getByTestId('shot').nth(2).locator('img');
    const before = (await img.getAttribute('src')).split('?')[0];
    await page.getByTestId('shot').nth(2).getByRole('button', { name: '重生此格' }).click();
    await expect.poll(async () => (await page.getByTestId('shot').nth(2).locator('img').getAttribute('src')).split('?')[0]).not.toBe(before);
  });

  test('場景：依指令重新產生腳本', async ({ page }) => {
    await page.goto(`/#/videos/${videoId}/4`);
    await page.getByLabel('要 AI 怎麼改整份腳本？').fill('開頭節奏再快一點');
    await page.getByRole('button', { name: '依指令重新產生腳本' }).click();
    await expect(page.getByTestId('script-version')).toContainText('第 2 版');
  });

  test('場景：確認腳本後進入角色設計', async ({ page }) => {
    await page.goto(`/#/videos/${videoId}/4`);
    await page.getByRole('button', { name: '確認腳本，進入角色設計' }).click();
    await expect(page).toHaveURL(new RegExp(`#/videos/${videoId}/5$`));
  });
});
