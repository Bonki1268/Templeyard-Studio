const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assSubtitles, formatSubtitle, splitSubtitle, subtitleStyleFor, SUBTITLE_STYLES, FONT_DIR, subtitleFilter } = require('../../src/steps/compose');

const styleLine = ass => ass.split('\n').find(l => l.startsWith('Style: Default,')).slice('Style: '.length).split(',');
const dialogues = ass => ass.split('\n').filter(l => l.startsWith('Dialogue:'));
const secs = t => { const [h, m, s] = t.split(':'); return Number(h) * 3600 + Number(m) * 60 + Number(s); };

test('場景：字幕依系列風格自動選擇樣式', () => {
  assert.equal(subtitleStyleFor('溫暖寫實・黃昏自然光'), 'serif');
  assert.equal(subtitleStyleFor('明亮清新・白天'), 'cinema');
  assert.equal(subtitleStyleFor('紀錄片質感'), 'documentary');
  assert.equal(subtitleStyleFor('自訂的風格'), 'cinema');
  const shots = [{ seconds: 3, subtitle: '淡水・鄞山寺' }];
  const fonts = {};
  for (const key of ['cinema', 'serif', 'documentary']) {
    const f = styleLine(assSubtitles(shots, { width: 1920, height: 1080, style: key }));
    fonts[key] = f[1];
    assert.equal(f[3], '&H00FFFFFF', `${key} 白字`);
    assert.equal(f[18], '2', `${key} 下方置中`);
  }
  assert.match(fonts.serif, /Serif/);
  assert.match(fonts.cinema, /Sans/);
  assert.equal(styleLine(assSubtitles(shots, { width: 1920, height: 1080, style: 'documentary' }))[15], '3', '紀錄片底條（BorderStyle 3）');
});

test('場景：字幕標點依電影字幕慣例處理', () => {
  assert.equal(formatSubtitle('來淡水，讀懂這座廟。'), '來淡水　讀懂這座廟');
  assert.equal(formatSubtitle('廟埕、石獅、剪黏'), '廟埕　石獅　剪黏');
  assert.equal(formatSubtitle('多數人只看表面，但如果你注意到這個細節……'), '多數人只看表面　但如果你注意到這個細節……');
  assert.equal(formatSubtitle('你知道嗎？'), '你知道嗎？');
  assert.equal(formatSubtitle('  傳說，祖師鼻落示警！ '), '傳說　祖師鼻落示警');
  assert.equal(formatSubtitle('淡水・鄞山寺'), '淡水・鄞山寺');
});

test('場景：長字幕自動拆段並依字數分配時間', () => {
  const text = '未爆彈改製的燭台，至今猶存的彈孔，靜靜訴說著這座廟走過的歲月。';
  const parts = splitSubtitle(formatSubtitle(text));
  assert.ok(parts.length >= 2);
  assert.ok(parts.every(p => [...p].length <= 16), JSON.stringify(parts));
  assert.equal(parts.join('').replace(/　/g, ''), formatSubtitle(text).replace(/　/g, ''));
  assert.ok(parts.every(p => !p.startsWith('　') && !p.endsWith('　')));
  assert.ok(splitSubtitle('沒有標點但是非常非常長的一句字幕內容需要硬切開來才行').every(p => [...p].length <= 16));

  const ds = dialogues(assSubtitles([{ seconds: 2, subtitle: '開場' }, { seconds: 4, subtitle: text }], { width: 1920, height: 1080, style: 'cinema' })).slice(1);
  assert.equal(ds.length, parts.length);
  const times = ds.map(d => d.split(',').slice(1, 3).map(secs));
  assert.equal(times[0][0], 2);
  assert.ok(Math.abs(times.at(-1)[1] - 6) < 0.011, '剛好填滿這一格');
  for (let i = 1; i < times.length; i++) assert.ok(Math.abs(times[i][0] - times[i - 1][1]) < 0.011, '依序銜接');
  const chars = parts.map(p => p.replace(/　/g, '').length);
  const lens = times.map(([a, b]) => b - a);
  for (let i = 0; i < parts.length; i++) assert.ok(Math.abs(lens[i] - 4 * chars[i] / chars.reduce((x, y) => x + y)) < 0.05, '時間依字數分配');
});

test('場景：字幕淡入淡出並使用內附的開源字型', () => {
  for (const key of Object.keys(SUBTITLE_STYLES)) {
    const ass = assSubtitles([{ seconds: 3, subtitle: '淡水・鄞山寺' }], { width: 1920, height: 1080, style: key });
    assert.ok(dialogues(ass).every(d => /\\fad\(\d+,\d+\)/.test(d)), `${key} 要有淡入淡出`);
    const font = styleLine(ass)[1];
    const file = path.join(FONT_DIR, SUBTITLE_STYLES[key].fontFile);
    assert.ok(fs.existsSync(file), `缺少字型檔 ${file}`);
    assert.match(font, /^Noto (Sans|Serif) TC/);
  }
  assert.ok(fs.existsSync(path.join(FONT_DIR, 'OFL.txt')), '附上字型授權');
  assert.match(subtitleFilter('subs.ass'), /^subtitles=subs\.ass:fontsdir=fonts$/);
});
