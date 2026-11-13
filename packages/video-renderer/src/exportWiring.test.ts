/**
 * 静态回归：锁住「导出」四处同源，避免以后又把按钮改回禁用、或把路由/任务处理器删掉。
 * 真正的端到端验证由隔离端口的 REST 冒烟覆盖，这里只做最便宜的结构守卫。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file: string): string => fs.readFileSync(file, 'utf8');

test('导出按钮真实可点，且后端路由/任务处理器/能力标记都在', () => {
  const page = read('apps/web/src/pages/ExportPage.tsx');
  assert.ok(page.includes('startRender(mode)'), '导出页调用渲染 action');
  assert.ok(page.includes('renderTask?.progress'), '导出页显示进度');
  assert.ok(page.includes('播放成片'), '导出页能直接播放成片');
  assert.ok(!page.includes('阶段四开放'), '旧的「未开放」角标已移除');

  const app = read('apps/server/src/app.ts');
  assert.ok(app.includes('/api/projects/:id/render'), '渲染入队接口存在');
  assert.ok(app.includes('/api/tasks/:taskId'), '单任务进度接口存在');
  assert.ok(app.includes('videoExport: renderEnv.available'), '能力标记来自真实环境探测');

  const handlers = read('apps/server/src/handlers.ts');
  assert.ok(handlers.includes("register('video.render'"), '任务处理器已注册');

  const renderer = read('apps/server/src/render.ts');
  assert.ok(renderer.includes('computeTimeline'), '时间轴铁律接进渲染');
  assert.ok(renderer.includes('renderVideo'), '真实合成被调用');
  assert.ok(renderer.includes('voiceOverNote'), '配音状态如实标注');
});

test('文档与配置不再宣称 MP4 未开放，且 TTS 已接通真实引擎', () => {
  const readme = read('README.md');
  assert.ok(!readme.includes('MP4 导出也未开放'));
  assert.ok(!readme.includes('不会生成假 MP4'));
  assert.ok(readme.includes('docs/VIDEO_RENDER.md'));
  assert.ok(fs.existsSync('docs/VIDEO_RENDER.md'));

  const providers = JSON.parse(read('config/providers.json')) as {
    tts: {
      active: string;
      command?: string;
      args?: string[];
      outputExt?: string;
      voices?: Record<string, string>;
    };
  };
  assert.equal(providers.tts.active, 'command', 'TTS 已接通，不再是无声占位');
  assert.ok(providers.tts.command, '存在可执行的语音命令');
  const args = (providers.tts.args ?? []).join(' ');
  for (const token of ['{text}', '{voice}', '{output}']) {
    assert.ok(args.includes(token), `命令模板缺少 ${token}`);
  }
  assert.equal(providers.tts.outputExt, 'mp3', 'edge-tts 产出 mp3，由 Provider 转 WAV');
  assert.ok(providers.tts.voices?.zh && providers.tts.voices?.th, '中泰默认音色齐全');
});
