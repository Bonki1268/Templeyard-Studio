// 廟埕影室：node server.js 後開啟 http://localhost:3000
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT || 3000);
const app = createApp();
app.server.listen(PORT, '127.0.0.1', () => {
  console.log(`廟埕影室：http://localhost:${PORT}（AI 服務：${app.ctx.config.aiProvider}）`);
});
