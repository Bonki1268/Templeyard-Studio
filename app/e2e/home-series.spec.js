const { test, expect } = require('@playwright/test');
const { createSeries, createVideo } = require('./helpers');

test.describe('首頁與系列頁', () => {
  test('場景：打開網頁就進入建立系列的首頁', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '建立新的系列專案' })).toBeVisible();
    await expect(page.getByLabel('系列名稱')).toBeVisible();
    await expect(page.getByRole('heading', { name: '已建立的系列' })).toBeVisible();
  });

  test('場景：建立系列時欄位不完整會顯示錯誤', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '建立系列' }).click();
    await expect(page.getByRole('alert')).toContainText('系列名稱必填');
  });

  test('場景：在首頁建立系列後進入系列頁', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('系列名稱').fill('淡水廟宇故事');
    await page.getByLabel('溫暖寫實・黃昏自然光').check();
    await page.getByLabel('30 秒').check();
    await page.getByLabel('在地歷史故事').check();
    await page.getByLabel('角色名稱').fill('導覽員小晴');
    await page.getByLabel('外觀描述').fill('30 歲左右女性，及肩黑髮，米白色襯衫');
    await page.getByRole('button', { name: '建立系列' }).click();
    await expect(page.getByRole('heading', { name: '淡水廟宇故事', level: 1 })).toBeVisible();
    await expect(page.getByTestId('series-style')).toContainText('溫暖寫實・黃昏自然光');
    await expect(page.getByTestId('series-character')).toContainText('導覽員小晴');
  });

  test('場景：首頁列出已建立的系列並可點選繼續', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('系列名稱').fill('三峽老街與廟口');
    await page.getByLabel('20 秒').check();
    await page.getByLabel('景點導覽').check();
    await page.getByRole('button', { name: '建立系列' }).click();
    await expect(page.getByRole('heading', { name: '三峽老街與廟口', level: 1 })).toBeVisible();
    await page.goto('/');
    await page.getByTestId('series-item').filter({ hasText: '三峽老街與廟口' }).click();
    await expect(page.getByRole('heading', { name: '三峽老街與廟口', level: 1 })).toBeVisible();
    await expect(page.getByTestId('series-duration')).toHaveText('20 秒');
  });

  test('場景：在系列頁修改系列設定', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('系列名稱').fill('年度慶典預告');
    await page.getByRole('button', { name: '建立系列' }).click();
    await expect(page.getByTestId('series-duration')).toHaveText('30 秒');
    await page.getByRole('button', { name: '編輯' }).click();
    await page.getByLabel('20 秒').check();
    await page.getByRole('button', { name: '儲存設定' }).click();
    await expect(page.getByTestId('series-duration')).toHaveText('20 秒');
  });
});

test.describe('刪除系列', () => {
  test('場景：在系列頁刪除系列', async ({ page, request }) => {
    const series = await createSeries(request, { name: '三芝福成宮' });
    await createVideo(request, series.id);
    await page.goto(`/#/series/${series.id}`);
    await page.getByRole('button', { name: '刪除系列' }).click();
    await expect(page.getByTestId('delete-series')).toContainText('會一併刪除 1 支影片');
    await page.getByRole('button', { name: '確認刪除' }).click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByText('已刪除系列「三芝福成宮」')).toBeVisible();
    await expect(page.getByRole('heading', { name: '已建立的系列' })).toBeVisible();
    await expect(page.getByText('三芝福成宮', { exact: true })).toHaveCount(0);
  });

  test('場景：頂部導覽不顯示「本機個人使用」', async ({ page }) => {
    await page.goto('/#/');
    await expect(page.locator('header.topbar')).toContainText('廟埕影室');
    await expect(page.getByText('本機個人使用')).toHaveCount(0);
  });
});
