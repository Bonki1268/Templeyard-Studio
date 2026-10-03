// 價格表（美元）與預設上限。實際價格待定，見 docs/BLOCKED.md 第 3 項。
const PRICES = {
  text: { perCall: 0.01 },
  image: { perImage: 0.04 },
  video: { perSecond: 0.10 },
  voice: { perCall: 0.01 },
  music: { perCall: 0 },
};

const DEFAULTS = { costCap: 20, threshold: 2 };

const round = n => +Number(n).toFixed(4);

function estimateCost(kind, { seconds = 0, count = 1 } = {}) {
  switch (kind) {
    case 'text': return round(PRICES.text.perCall * count);
    case 'image': return round(PRICES.image.perImage * count);
    case 'video': return round(PRICES.video.perSecond * seconds);
    case 'voice': return round(PRICES.voice.perCall * count);
    case 'music': return round(PRICES.music.perCall * count);
    default: return 0;
  }
}

module.exports = { PRICES, DEFAULTS, estimateCost, round };
