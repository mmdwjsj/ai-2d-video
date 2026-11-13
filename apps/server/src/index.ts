import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 4173);
const { app, stop } = createApp();

const server = app.listen(port, () => {
  console.log(`泰国本地生活 AI 双语短视频工作台：http://localhost:${port}`);
  console.log('已启用：项目 / 人物 / 场景 / 双语剧本 / 分镜 / 任务 / 预览 / 本地 MP4 导出');
});

const shutdown = (): void => {
  server.close(() => {
    stop();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
