/**
 * 一致性回归：界面预览与导出成片必须是同一套画面、同一套口型时间轴。
 *
 * 以前预览页/分镜页各自用 React 另画背景、人物贴图、字幕，成片走 buildFrame，
 * 于是「预览能动、成片不动」「预览一套字幕、成片另一套字幕」反复出现。
 * 这些测试把同源接线和逐帧行为一起锁住。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { emptyCharacter, emptyScene, emptyScript, emptyShot } from '@thai-video/core/types';
import type { ProjectBundle } from '@thai-video/core/types';
import { buildPreviewFrames } from './previewFrames.js';
import { characterArtOf, shotFrameInput, subtitles } from './frameData.js';

const read = (file: string): string => fs.readFileSync(file, 'utf8');

const makeBundle = (): ProjectBundle => {
  const nina = { ...emptyCharacter('char-a'), name: '妮娜' };
  const scene = { ...emptyScene('scene-1'), name: '泰国夜市', keywords: ['夜市'] };
  const dialogue = {
    ...emptyShot(1, 'shot-1'),
    sceneId: scene.id, characterIds: [nina.id], durationSec: 2,
    subtitleZh: '下班啦，今天想吃冬阴功', dialogueZh: '下班啦，今天想吃冬阴功',
    subtitleTh: 'เลิกงานแล้ว', dialogueTh: 'เลิกงานแล้ว',
  };
  const narration = {
    ...emptyShot(2, 'shot-2'),
    sceneId: scene.id, characterIds: [], durationSec: 1.5,
    subtitleZh: '夜市的灯亮起来了', narrationZh: '夜市的灯亮起来了',
  };
  return {
    meta: {
      id: 'proj-test', name: '下班后去夜市', description: '', exportMode: 'zh',
      createdAt: '', updatedAt: '',
    },
    characters: [nina], scenes: [scene], script: emptyScript(),
    shots: [dialogue, narration],
  };
};

test('预览逐帧时间轴与四档画面：对白镜头动嘴，旁白镜头保持静帧', () => {
  const bundle = makeBundle();
  const payload = buildPreviewFrames({ bundle, mode: 'zh', fps: 30 });
  assert.equal(payload.fps, 30);
  assert.equal(payload.shots.length, 2);

  const [talking, narrated] = payload.shots;
  assert.equal(talking.timeline?.length, 60, '2s × 30fps = 60 帧，一帧一个嘴型');
  assert.equal(talking.lipSource, 'text', '没有配音 WAV 时如实标注为台词节奏');
  const htmls = Object.values(talking.frames).filter((v): v is string => Boolean(v));
  assert.ok(htmls.length >= 2, '至少生成闭嘴与张嘴两档');
  assert.equal(new Set(htmls).size, htmls.length, '每一档必须是不同画面');
  for (const html of htmls) {
    assert.ok(html.includes('下班啦，今天想吃冬阴功'), '字幕来自成片同一个 subtitles()');
    assert.ok(html.includes('妮娜'), '出场人物来自成片同一个 castOf()');
    assert.ok(html.includes('泰国夜市'), '场景来自成片同一个 sceneOf()');
    assert.ok(html.includes('person-svg'), '没有参考图时回退到成片同款程序化立绘');
  }

  assert.equal(narrated.timeline, null, '无人物 / 旁白镜头不生成口型时间轴');
  assert.deepEqual(Object.keys(narrated.frames), ['closed'], '旁白镜头只有一张静帧');
  assert.equal(narrated.lipSource, 'none');
});

test('导出与预览共用 shotFrameInput，不存在第二套字幕/人物/场景逻辑', () => {
  const bundle = makeBundle();
  const frame = shotFrameInput({
    bundle, shot: bundle.shots[0], mode: 'zh', index: 1, total: 2,
    durationSec: 2, characterArt: {},
  });
  assert.equal(frame.primarySubtitle, subtitles(bundle.shots[0], 'zh').primary);
  assert.equal(frame.speakerId, 'char-a');
  assert.equal(frame.scene?.name, '泰国夜市');
  assert.equal(frame.characters?.[0]?.name, '妮娜');
  assert.equal(frame.projectTitle, bundle.meta.name);

  const render = read('apps/server/src/render.ts');
  const preview = read('apps/server/src/previewFrames.ts');
  for (const source of [render, preview]) {
    assert.ok(source.includes("from './frameData.js'"), '画面入参统一取自 frameData');
    assert.ok(source.includes('shotFrameInput('), '走唯一的 FrameInput 构造入口');
    assert.ok(source.includes('buildFrame('), '画面用成片同一个 buildFrame');
  }
  assert.ok(!render.includes('const subtitles ='), '导出里不再残留第二份字幕取法');
  const app = read('apps/server/src/app.ts');
  assert.ok(app.includes('/api/projects/:id/preview-frames'), '预览画面接口已注册');
});

test('两个前端页面都用成片同款播放器，不再自画人物贴图/字幕', () => {
  for (const page of ['PreviewPage', 'StoryboardPage']) {
    const source = read(`apps/web/src/pages/${page}.tsx`);
    assert.ok(source.includes('FramePlayer') && source.includes('usePreviewFrames'),
      `${page} 用服务端生成的成片画面`);
    assert.ok(!source.includes('PHOTO_FADE') && !source.includes('assetUrl('),
      `${page} 不再自己贴人物图`);
    assert.ok(!source.includes('generatedImagePath'), `${page} 不再显示成片里根本不存在的生成图`);
  }
  const player = read('apps/web/src/FramePlayer.tsx');
  assert.ok(player.includes('MOUTH_SHAPES') && player.includes('timeline['), '播放器按口型时间轴切档');
  assert.ok(player.includes('visibility'), '四档 iframe 常驻叠放，切档不重载、不闪');

  const core = read('packages/video-renderer/src/mouthCore.ts');
  assert.ok(!/^\s*import .* from ['"]node:/m.test(core), '口型纯计算模块不 import 任何 node 内置模块，浏览器可用');
  assert.ok(read('packages/video-renderer/src/mouth.ts').includes("from './mouthCore.js'"),
    '导出侧与预览侧复用同一份档位阈值与文本节奏');
});

test('导出内联图与预览 URL 图共用同一组嘴部标定坐标', () => {
  const bundle = makeBundle();
  const rel = 'assets/characters/cutout/nina-cutout.png';
  if (!fs.existsSync(rel)) return; // 素材被删时不阻断测试
  bundle.characters[0].referenceImages.fullBody = rel;
  const inline = characterArtOf(bundle, { inline: true })['char-a'];
  const byUrl = characterArtOf(bundle)['char-a'];
  assert.ok(inline.src.startsWith('data:image/png;base64,'), '导出截图必须用 data URI');
  assert.ok(byUrl.src.startsWith('/assets/'), '预览走同源 URL，不塞几 MB base64');
  for (const key of ['width', 'height', 'mouthX', 'mouthY', 'mouthW', 'mouthH', 'skin'] as const) {
    assert.equal(inline[key], byUrl[key], `${key} 两边必须一致，否则嘴会贴歪或补丁色差`);
  }
});

test('吨吨这类原图张着大嘴的角色，标定必须带真实嘴高与肤色', () => {
  const bundle = makeBundle();
  const rel = 'assets/characters/library/dundun/fullBody.png';
  if (!fs.existsSync(rel)) return;
  bundle.characters[0].referenceImages.fullBody = rel;
  const art = characterArtOf(bundle, { inline: true })['char-a'];
  assert.ok(art.mouthH && art.mouthH > 50, '吨吨原嘴 59px 高，不能按「一条细线」处理');
  assert.equal(art.skin, 'rgb(197,140,93)', '补丁肤色来自实测标定');

  const payload = buildPreviewFrames({ bundle, mode: 'zh', fps: 30 });
  const html = payload.shots[0].frames.closed ?? '';
  assert.ok(html.includes('class="mouth-overlay"'), '闭嘴档也要盖掉原图张开的嘴');
  assert.ok(html.includes('rgb(197,140,93)'), '闭嘴档有肤色补丁，不是原图那个黑色口腔');
  const patch = /height="([\d.]+)"\s+rx="[\d.]+"\s+fill="rgb\(197,140,93\)" filter=/.exec(html);
  assert.ok(patch && Number(patch[1]) > 59, '补丁高度必须完全盖住 59px 的原嘴');
});
