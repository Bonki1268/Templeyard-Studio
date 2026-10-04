const { test, expect } = require('@playwright/test');
const { testPhoto, createSeries, createVideo } = require('./helpers');

const STORY = '老一輩說，當年移民渡海來台，帶著定光古佛的香火在淡水落腳。後來才有了這座廟。';

test.describe('步驟 2 新增影片', () => {
  test('場景：從系列頁新增影片進入步驟 2', async ({ page, request }) => {
    const series = await createSeries(request);
    await page.goto(`/#/series/${series.id}`);
    await page.getByRole('button', { name: '新增影片' }).click();
    await expect(page.getByRole('heading', { name: '新增影片', level: 1 })).toBeVisible();
    await expect(page.locator('.stepper .current')).toContainText('新增影片');
    await expect(page.getByTestId('cost')).toContainText('上限 US$20.00');
  });

  test('場景：條件未滿足時確認按鈕無法使用', async ({ page, request }) => {
    const video = await createVideo(request, (await createSeries(request)).id);
    await page.goto(`/#/videos/${video.id}/2`);
    await expect(page.getByRole('button', { name: '確認，產生寺廟背景板' })).toBeDisabled();
    await expect(page.getByTestId('conditions')).toContainText('尚未選擇寺廟');
    await expect(page.getByTestId('conditions')).toContainText('照片');
    await expect(page.getByTestId('conditions')).toContainText('故事');
  });

  test('場景：搜尋並選擇寺廟後顯示寺廟資料', async ({ page, request }) => {
    const video = await createVideo(request, (await createSeries(request)).id);
    await page.goto(`/#/videos/${video.id}/2`);
    await page.getByLabel('搜尋廟名、行政區或主祀神明').fill('淡水');
    await expect(page.getByTestId('temple-count')).toContainText('已排除已廢止與未登記的寺廟');
    await page.getByTestId('temple-result').filter({ hasText: '鄞山寺' }).first().click();
    const detail = page.getByTestId('temple-detail');
    await expect(detail).toContainText('新北市淡水區鄧公里鄧公路15號');
    await expect(detail).toContainText('定光古佛');
    await expect(detail).toContainText('佛教');
    await expect(detail).toContainText('1824 年（民前88）');
    await expect(detail).toContainText('0226295517');
  });

  test('場景：上傳照片後看到去識別結果', async ({ page, request }) => {
    const video = await createVideo(request, (await createSeries(request)).id);
    await page.goto(`/#/videos/${video.id}/2`);
    await page.getByTestId('photo-input').setInputFiles(testPhoto('廟埕_face.jpg'));
    const photo = page.getByTestId('photo').first();
    await expect(photo).toContainText('已去識別');
    await expect(photo).toContainText('遮蔽 1 處人臉');
    await expect(page.getByTestId('photo-count')).toContainText('1／5 張');
  });

  test('場景：取消誤判的遮蔽區塊', async ({ page, request }) => {
    const video = await createVideo(request, (await createSeries(request)).id);
    await page.goto(`/#/videos/${video.id}/2`);
    await page.getByTestId('photo-input').setInputFiles(testPhoto('正殿_deity.jpg'));
    const photo = page.getByTestId('photo').first();
    await expect(photo).toContainText('遮蔽 1 處人臉');
    await photo.getByRole('button', { name: '對照遮蔽區塊' }).click();
    await photo.getByLabel('人臉 1').uncheck();
    await expect(photo).toContainText('無需遮蔽');
  });

  test('場景：AI 潤飾後採用潤飾版', async ({ page, request }) => {
    const video = await createVideo(request, (await createSeries(request)).id);
    await page.goto(`/#/videos/${video.id}/2`);
    await page.getByLabel('搜尋廟名、行政區或主祀神明').fill('鄞山寺');
    await page.getByTestId('temple-result').first().click();
    await page.getByLabel('你想說的故事').fill(STORY);
    await page.getByRole('button', { name: 'AI 潤飾' }).click();
    await expect(page.getByTestId('polished')).toContainText('定光古佛');
    await page.getByRole('button', { name: '採用潤飾版' }).click();
    await expect(page.getByTestId('story-choice')).toContainText('已採用潤飾版');
  });

  test('場景：條件都滿足後確認並前往寺廟背景板', async ({ page, request }) => {
    const video = await createVideo(request, (await createSeries(request)).id);
    await page.goto(`/#/videos/${video.id}/2`);
    await page.getByLabel('搜尋廟名、行政區或主祀神明').fill('鄞山寺');
    await page.getByTestId('temple-result').first().click();
    await page.getByTestId('photo-input').setInputFiles(testPhoto('廟宇正面.jpg'));
    await expect(page.getByTestId('photo').first()).toContainText('已去識別');
    await page.getByLabel('你想說的故事').fill(STORY);
    await page.getByLabel('你想說的故事').blur();
    await expect(page.getByTestId('conditions')).toContainText('故事已填寫');
    await page.getByRole('button', { name: '確認，產生寺廟背景板' }).click();
    await expect(page).toHaveURL(new RegExp(`#/videos/${video.id}/3$`));
    await expect(page.locator('.stepper .current')).toContainText('寺廟背景板');
  });
});
