// 端對端：只用網頁操作，從建立系列走完 7 步並下載成品（全程假實作，不花錢）。
const { execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');
const { testPhoto, STORY } = require('./helpers');

test('場景：用假實作從建立系列走完 7 個步驟並下載成品', async ({ page }) => {
  test.setTimeout(300_000);

  // 步驟 1：建立系列專案
  await page.goto('/');
  await page.getByLabel('系列名稱').fill('淡水廟宇故事');
  await page.getByLabel('溫暖寫實・黃昏自然光').check();
  await page.getByLabel('30 秒').check();
  await page.getByLabel('在地歷史故事').check();
  await page.getByLabel('角色名稱').fill('導覽員小晴');
  await page.getByLabel('外觀描述').fill('30 歲左右女性，及肩黑髮，米白色襯衫，自然淡妝，說話親切');
  await page.getByRole('button', { name: '建立系列' }).click();
  await expect(page.getByRole('heading', { name: '淡水廟宇故事', level: 1 })).toBeVisible();

  // 步驟 2：新增影片
  await page.getByRole('button', { name: '新增影片' }).click();
  await expect(page.getByRole('heading', { name: '新增影片', level: 1 })).toBeVisible();
  await page.getByLabel('搜尋廟名、行政區或主祀神明').fill('鄞山寺');
  await page.getByTestId('temple-result').first().click();
  await expect(page.getByTestId('temple-detail')).toContainText('定光古佛');
  await page.getByTestId('photo-input').setInputFiles([testPhoto('廟宇正面_face.jpg'), testPhoto('廟埕石獅.jpg')]);
  await expect(page.getByTestId('photo')).toHaveCount(2);
  await expect(page.getByTestId('photo').first()).toContainText('已去識別');
  await page.getByLabel('你想說的故事').fill(STORY);
  await page.getByRole('button', { name: 'AI 潤飾' }).click();
  await page.getByRole('button', { name: '採用潤飾版' }).click();
  await expect(page.getByTestId('story-choice')).toContainText('已採用潤飾版');
  await page.getByRole('button', { name: '確認，產生寺廟背景板' }).click();

  // 步驟 3：寺廟背景板
  await page.getByRole('button', { name: /產生寺廟背景板/ }).click();
  await expect(page.getByRole('img', { name: '寺廟背景板' })).toBeVisible();
  await page.getByRole('button', { name: '確認背景板，產生故事腳本' }).click();

  // 步驟 4：故事腳本
  await page.getByRole('button', { name: /產生腳本與分鏡圖/ }).click();
  await expect(page.getByTestId('shot')).toHaveCount(10);
  await expect(page.getByTestId('total')).toContainText('30／30 秒');
  await page.getByRole('button', { name: '確認腳本，進入角色設計' }).click();

  // 步驟 5：角色設計（系列角色導覽員小晴第一次產生定裝圖）
  await page.getByRole('button', { name: /產生角色/ }).click();
  await expect(page.getByTestId('character-item')).toContainText('導覽員小晴');
  await page.getByRole('button', { name: '確認角色，產生精緻圖' }).click();

  // 步驟 6：精緻圖
  await page.getByRole('button', { name: /產生精緻圖/ }).click();
  await expect(page.getByTestId('progress')).toContainText('10／10 格完成', { timeout: 60_000 });
  await page.getByRole('button', { name: '確認精緻圖，生成影片' }).click();

  // 步驟 7：影片生成（超過單筆門檻，需再次同意）
  await page.getByRole('button', { name: /生成分鏡影片/ }).click();
  await page.getByRole('dialog', { name: '費用確認' }).getByRole('button', { name: '同意並繼續' }).click();
  await expect(page.getByTestId('clip').filter({ hasText: '已完成' })).toHaveCount(10, { timeout: 120_000 });
  await page.getByRole('button', { name: /合成成品/ }).click();
  await expect(page.getByTestId('final-info')).toContainText('成品 00:30.0', { timeout: 120_000 });
  await page.getByRole('button', { name: '確認成品' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: '下載 MP4' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.mp4$/);

  // 驗證成品規格
  const file = await download.path();
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
  const video = info.streams.find(s => s.codec_type === 'video');
  expect(video.width).toBe(1920);
  expect(video.height).toBe(1080);
  expect(video.r_frame_rate).toBe('24/1');
  expect(info.streams.some(s => s.codec_type === 'audio')).toBe(true);
  expect(Number(info.format.duration)).toBeLessThanOrEqual(30);
  expect(Number(info.format.duration)).toBeGreaterThan(29);

  // 系列頁：影片已完成、系列角色已鎖定
  await page.getByRole('link', { name: '淡水廟宇故事' }).click();
  await expect(page.getByTestId('video-item')).toContainText('已完成');
  await expect(page.getByTestId('series-character')).toContainText('導覽員小晴');
  await page.getByRole('link', { name: /角色庫/ }).click();
  await expect(page.getByTestId('library-character').filter({ hasText: '導覽員小晴' })).toContainText('已鎖定');
});
