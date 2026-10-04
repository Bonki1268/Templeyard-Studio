// 依設定選擇 AI 服務實作。換成真實服務時只換這一層。
//   fake：全部假實作（預設，測試與開發用，不花錢）
//   real：文字用 Claude、圖片與影片用 Higgsfield；語音合成依 TTS_PROVIDER（macOS 預設 say，見 ./voice.js）；
//         背景音樂仍用本機佔位（見 docs/BLOCKED.md 第 5 項）
const { createFakeProviders } = require('./fake');
const { createClaudeText } = require('./claude');
const { createHiggsfieldMedia } = require('./higgsfield');
const { createRealVoice } = require('./voice');

function createRealProviders({ mediaDir, output, videoHeight, env = process.env, platform = process.platform, anthropicClient, fetchImpl, pollIntervalMs }) {
  if (!env.HF_API_KEY_ID || !env.HF_API_KEY_SECRET) {
    throw new Error('真實服務需要設定環境變數 HF_API_KEY_ID、HF_API_KEY_SECRET（Higgsfield），以及 Claude 的 ANTHROPIC_API_KEY（或先執行 ant auth login）');
  }
  const local = createFakeProviders({ mediaDir, output });
  const text = createClaudeText({ client: anthropicClient, model: env.CLAUDE_MODEL, effort: env.CLAUDE_EFFORT || 'high' });
  const media = createHiggsfieldMedia({
    keyId: env.HF_API_KEY_ID, keySecret: env.HF_API_KEY_SECRET, fetchImpl, mediaDir, output, videoHeight, pollIntervalMs,
    imageModel: env.HIGGSFIELD_IMAGE_MODEL || undefined, videoModel: env.HIGGSFIELD_VIDEO_MODEL || undefined,
  });
  const voice = createRealVoice({ env, platform, mediaDir, fetchImpl, local });
  return {
    name: 'real',
    models: { text: text.model, image: media.imageModel, video: media.videoModel, voice: voice.model, music: local.models.music },
    ruleModels: media.ruleModels,
    calls: local.calls,
    failNext: local.failNext,
    text,
    image: media.image,
    video: media.video,
    voice,
    music: local.music,
  };
}

const PROVIDERS = {
  fake: createFakeProviders,
  real: createRealProviders,
};

function createProviders({ aiProvider, ...rest } = {}) {
  const name = aiProvider || 'fake';
  const factory = PROVIDERS[name];
  if (!factory) throw new Error(`不認得的 AI 服務「${name}」，可用的選項：${Object.keys(PROVIDERS).join('、')}`);
  return factory(rest);
}

module.exports = { createProviders, PROVIDERS };
