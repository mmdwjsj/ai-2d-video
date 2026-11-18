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

test('对白镜头必须逐帧动嘴，不能退回每镜头一张静帧', () => {
  const server = read('apps/server/src/render.ts');
  assert.ok(server.includes('mouthTimeline('), '按配音能量生成口型时间轴');
  assert.ok(server.includes('writeFrameSequence('), '口型铺成逐帧序列');
  assert.ok(server.includes('frameSequence: frameSequences[i]'), '帧序列交给合成器');
  assert.ok(server.includes('characterArt'), '口型坐标来自实测标定，不是拍脑袋写死');

  const video = read('packages/video-renderer/src/render.ts');
  assert.ok(video.includes('frameSequence'), '合成器支持帧序列输入');
  assert.ok(video.includes("['-framerate', String(fps), '-i', segment.frameSequence]"),
    '有序列时不再用单图 -loop 1');

  const art = read('packages/video-renderer/src/sceneArt.ts');
  assert.ok(art.includes('preserveAspectRatio="xMidYMax meet"'), '口型与人物图对齐');
});

test('配音链路：失败重试、失败原因如实上报、配音产物持久化供预览复用', () => {
  const server = read('apps/server/src/render.ts');
  assert.ok(server.includes('synthesizeWithRetry('), '单句 TTS 失败会重试，一次网络抖动不会清空整片配音');
  assert.ok(server.includes('voiceFailures'), '失败原因写进结果，界面不再误标「未配置 TTS」');
  assert.ok(server.includes('shotVoiceCachePath('), '配音产物持久化，预览可播、离线可兜底');
  assert.ok(server.includes('resolveAudio(line.slot)'), '单句失败回退镜头已挂 WAV');

  const frameData = read('apps/server/src/frameData.ts');
  assert.ok(frameData.includes('export const shotVoiceCacheUrl')
    && frameData.includes('export const previewAudioUrl'), '预览能拿到配音地址');
  assert.ok(read('apps/server/src/previewFrames.ts').includes('audioUrl: previewAudioUrl('),
    '预览接口返回配音地址');
  const player = read('apps/web/src/FramePlayer.tsx');
  assert.ok(player.includes('<audio') && player.includes('audio.currentTime'),
    '预览播放器按音频时钟对齐口型');
  assert.ok(read('apps/web/src/pages/PreviewPage.tsx').includes('audioUrl={previewShot?.audioUrl'),
    '预览页把配音交给播放器');
});

test('配音失败按真实原因归因，界面说明唯一联网点并展示完整报错', () => {
  const server = read('apps/server/src/render.ts');
  assert.ok(server.includes('deps.tts.preflight'), '导出前先做本机自检，缺包不必逐句重试');
  assert.ok(server.includes('diagnoseTtsError('), '失败原因分类后再写文案');
  assert.ok(server.includes('voiceDiagnosis'), '分类结果传给界面');
  assert.ok(!server.includes('联网恢复后重新导出即可补回人声'), '不再写死网络归因');
  assert.ok(!server.includes('f.reason.slice(0, 80)'), '逐句报错不再被截断成 edg');

  const provider = read('packages/tts-providers/src/index.ts');
  assert.ok(provider.includes('preflight') && provider.includes('pythonCandidates'),
    '多 Python 环境自动挑装了引擎模块的解释器');
  assert.ok(provider.includes('if (!result.ok) resolving = null'),
    '自检失败不缓存，装完包重新导出就能生效');

  const page = read('apps/web/src/pages/ExportPage.tsx');
  assert.ok(!page.includes('网络恢复后重新导出即可补回人声'), '界面不再误导用户等网络');
  assert.ok(page.includes('唯一联网点'), '直接回答「为什么会联网」');
  assert.ok(page.includes('voiceDiagnosis?.hint'), '按分类给可操作建议');
  assert.ok(page.includes('查看逐句原始报错'), '完整报错可展开查看');

  const config = JSON.parse(read('config/providers.json')) as { note: string };
  assert.ok(config.note.includes('唯一联网点'), '配置说明也不再宣称完全本地');
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
