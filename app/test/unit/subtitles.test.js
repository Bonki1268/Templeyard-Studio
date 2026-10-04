const test = require('node:test');
const assert = require('node:assert/strict');
const { assSubtitles, timeline } = require('../../src/steps/compose');

const shots = [
  { index: 1, seconds: 3, subtitle: '淡水・鄞山寺', line: '淡水・鄞山寺', speaker: '旁白' },
  { index: 2, seconds: 4, subtitle: '這座廟，藏著老一輩才知道的故事。', line: '這座廟，藏著老一輩才知道的故事。', speaker: '小晴' },
  { index: 3, seconds: 2.5, subtitle: '', line: '', speaker: '' },
];

test('場景：字幕為繁體中文白字、置於畫面下方置中', () => {
  const ass = assSubtitles(shots, { width: 1920, height: 1080 });
  assert.match(ass, /PlayResX: 1920/);
  assert.match(ass, /PlayResY: 1080/);
  const style = ass.split('\n').find(l => l.startsWith('Style: Default,'));
  const fields = style.slice('Style: '.length).split(',');
  assert.equal(fields[3], '&H00FFFFFF', '白字');
  assert.equal(fields[18], '2', '下方置中（Alignment 2）');
  const dialogues = ass.split('\n').filter(l => l.startsWith('Dialogue:'));
  assert.equal(dialogues.length, 2, '沒有字幕的格子不出現');
  assert.match(dialogues[0], /0:00:00\.00,0:00:03\.00,Default,,0,0,0,,\{[^}]*\}淡水・鄞山寺$/);
  // 標點依電影字幕慣例處理（見 29-字幕品質.feature）；文字前是淡入淡出等樣式標籤。
  assert.match(dialogues[1], /0:00:03\.00,0:00:07\.00,Default,,0,0,0,,\{[^}]*\}這座廟　藏著老一輩才知道的故事$/);
});

test('timeline 計算每格的開始時間', () => {
  assert.deepEqual(timeline(shots).map(t => t.start), [0, 3, 7]);
});
