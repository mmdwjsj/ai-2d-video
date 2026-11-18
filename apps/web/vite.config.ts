import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const webRoot = fileURLToPath(new URL('.', import.meta.url));
const coreSrc = path.resolve(webRoot, '../../packages/core/src');
const rendererSrc = path.resolve(webRoot, '../../packages/video-renderer/src');
// 开发页把 API、成片、素材一起代理到后端，避免 /output 被 Vite 的 SPA 回退成 index.html。
const apiTarget = process.env.THAI_VIDEO_API ?? 'http://localhost:4173';

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  resolve: {
    // 前端只用 core 的纯类型文件，绝不把 node:sqlite 打进浏览器 bundle。
    alias: [
      // 只取场景插画这一段（纯字符串拼接，不碰 node:child_process），用来在界面上画缩略图。
      { find: '@thai-video/video-renderer/sceneArt', replacement: path.join(rendererSrc, 'sceneArt.ts') },
      // 口型档位/类型是纯计算，浏览器可用；mouth.ts 要读 WAV、铺帧序列，绝不能进 bundle。
      { find: '@thai-video/video-renderer/mouthCore', replacement: path.join(rendererSrc, 'mouthCore.ts') },
      { find: '@thai-video/core/types', replacement: path.join(coreSrc, 'types.ts') },
      // 规范剧本解析器前后端共用；必须排在宽泛的 '@thai-video/core' 之前，否则会被拼成 index.ts/xxx。
      { find: '@thai-video/core/scriptLines', replacement: path.join(coreSrc, 'scriptLines.ts') },
      // 场景匹配是纯计算，审阅面板与服务端自动分镜共用；同样要走子路径，别把 core 入口的 node:sqlite 打进来。
      { find: '@thai-video/core/sceneMatch', replacement: path.join(coreSrc, 'sceneMatch.ts') },
      { find: '@thai-video/core', replacement: path.join(coreSrc, 'index.ts') },
    ],
  },
  build: {
    outDir: path.join(webRoot, 'dist'),
    // 服务端把 /assets 留给了人物参考图等本地素材，打包产物改用 /static，避免互相 404。
    assetsDir: 'static',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/output': { target: apiTarget, changeOrigin: true },
      '/assets': { target: apiTarget, changeOrigin: true },
    },
  },
});
