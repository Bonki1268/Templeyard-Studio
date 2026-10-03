// 依設定選擇 AI 服務實作。換成真實服務時只換這一層。
const { createFakeProviders } = require('./fake');

const PROVIDERS = {
  fake: createFakeProviders,
};

function createProviders({ aiProvider, mediaDir, output } = {}) {
  const name = aiProvider || 'fake';
  const factory = PROVIDERS[name];
  if (!factory) throw new Error(`不認得的 AI 服務「${name}」，可用的選項：${Object.keys(PROVIDERS).join('、')}`);
  return factory({ mediaDir, output });
}

module.exports = { createProviders, PROVIDERS };
