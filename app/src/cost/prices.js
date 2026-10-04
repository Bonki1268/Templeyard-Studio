// 價格表（美元）與預設上限。
// 圖片：Higgsfield Grok Imagine Image 2.0 估價約 US$0.06／張。
// 影片：Higgsfield Seedance 2.0 以 token 計價：token = 秒數 × 寬 × 高 × 24 ÷ 1024，
//       480p／720p／1080p 每千 token US$0.014、4K US$0.008；每段至少 4 秒。
const VIDEO_TIERS = [
  { minHeight: 2160, width: 3840, height: 2160, per1kTokens: 0.008 },
  { minHeight: 1080, width: 1920, height: 1080, per1kTokens: 0.014 },
  { minHeight: 720, width: 1280, height: 720, per1kTokens: 0.014 },
  { minHeight: 0, width: 854, height: 480, per1kTokens: 0.014 },
];
const tierFor = height => VIDEO_TIERS.find(t => height >= t.minHeight);
const videoTokens = (seconds, height) => { const t = tierFor(height); return Math.ceil(seconds * t.width * t.height * 24 / 1024); };
const videoPerSecond = (height = 1080) => +(videoTokens(1, height) * tierFor(height).per1kTokens / 1000).toFixed(4);
const billedSeconds = seconds => Math.max(4, Math.ceil(Number(seconds) || 0));

const PRICES = {
  text: { perCall: 0.01 },
  image: { perImage: 0.06 },
  video: { minSeconds: 4, perSecond: videoPerSecond },
  voice: { perCall: 0.01 },
  music: { perCall: 0 },
};

// 每支影片上限 US$20；單筆超過 US$5 需再次同意（使用者 2026-10-04 決定）。
const DEFAULTS = { costCap: 20, threshold: 5 };

const round = n => +Number(n).toFixed(4);

// video：clips 為各段秒數（或單段 seconds），每段至少以 4 秒計，單價依輸出高度。
function estimateCost(kind, { seconds = 0, clips, height = 1080, count = 1 } = {}) {
  switch (kind) {
    case 'text': return round(PRICES.text.perCall * count);
    case 'image': return round(PRICES.image.perImage * count);
    case 'video': {
      const total = (clips || [seconds]).reduce((sum, s) => sum + billedSeconds(s), 0);
      return round(total * videoTokens(1, height) * tierFor(height).per1kTokens / 1000);
    }
    case 'voice': return round(PRICES.voice.perCall * count);
    case 'music': return round(PRICES.music.perCall * count);
    default: return 0;
  }
}

module.exports = { PRICES, DEFAULTS, estimateCost, round, videoPerSecond, videoTokens, billedSeconds, tierFor };
