import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyCharacter, emptyScene, emptyShot } from '@thai-video/core/types';
import {
  buildFrame, buildIntroFrame, buildOutroFrame, buildSceneThumb, paletteFor,
  FRAME_HEIGHT, FRAME_WIDTH,
} from './sceneArt.js';

const scene = { ...emptyScene('scene-night-market'), name: '泰国夜市', keywords: ['夜市'] };
const nina = { ...emptyCharacter('char-a'), name: '妮娜', nameTh: 'นีน่า' };
const shot = {
  ...emptyShot(1, 'shot-1'),
  expression: '微笑地', action: '递过一碗冬阴功',
  dialogueZh: '下班啦，今天想去哪儿吃？',
  dialogueTh: 'เลิกงานแล้ว วันนี้ไปกินอะไรดี',
  subtitleZh: '下班啦，今天想去哪儿吃？',
  subtitleTh: 'เลิกงานแล้ว วันนี้ไปกินอะไรดี',
};

const base = {
  projectTitle: '下班后去夜市吃冬阴功',
  scene, characters: [nina], speakerId: 'char-a', shot,
  index: 1, total: 5, durationSec: 4.5,
};

/** 模拟 server/render.ts 的 subtitles()：按语言类型挑主/次字幕。 */
const shotFrame = (mode: 'zh' | 'th' | 'bilingual', overrides: Record<string, unknown> = {}): string =>
  buildFrame({
    ...base, kind: 'shot', mode,
    primarySubtitle: mode === 'th' ? shot.subtitleTh : shot.subtitleZh,
    secondarySubtitle: mode === 'bilingual' ? shot.subtitleTh : '',
    ...overrides,
  });

test('画面尺寸固定 9:16，且三个语言的片头片尾都能生成', () => {
  assert.equal(FRAME_WIDTH, 1080);
  assert.equal(FRAME_HEIGHT, 1920);
  for (const mode of ['zh', 'th', 'bilingual'] as const) {
    for (const html of [
      buildIntroFrame({ ...base, kind: 'intro', mode }),
      buildOutroFrame({ ...base, kind: 'outro', mode }),
    ]) {
      assert.ok(html.includes('1080px') && html.includes('1920px'));
      assert.ok(html.includes('下班后去夜市吃冬阴功'));
    }
  }
  assert.ok(shotFrame('zh').includes('NO.01'));
});

test('语言类型决定字幕：中文版只中文、泰语版只泰文、双语版两行都在', () => {
  const zh = shotFrame('zh');
  const th = shotFrame('th');
  const bi = shotFrame('bilingual');
  assert.ok(zh.includes('下班啦，今天想去哪儿吃？'));
  assert.ok(!zh.includes('เลิกงานแล้ว'));
  assert.ok(th.includes('เลิกงานแล้ว'));
  assert.ok(!th.includes('下班啦，今天想去哪儿吃？'));
  assert.ok(bi.includes('下班啦，今天想去哪儿吃？') && bi.includes('เลิกงานแล้ว'));
  assert.ok(bi.includes('class="secondary"'), '双语版第二行用次字幕样式');
});

test('人物名字牌语言跟随导出版本，中文版不混进泰文名', () => {
  assert.ok(shotFrame('zh').includes('妮娜'));
  assert.ok(!shotFrame('zh').includes('นีน่า'));
  assert.ok(shotFrame('th').includes('นีน่า'));
});

test('用户文本会被转义，泰文与引号不会破坏 HTML', () => {
  const html = shotFrame('zh', {
    projectTitle: '<script>alert("x")</script> & \'泰日常\'',
    primarySubtitle: '他说"你好" & <再见>',
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&amp;'), '与号已转义');
  assert.ok(html.includes('他说&quot;你好&quot;'));
});

test('12 个场景各有配色，且能按 id 精确命中', () => {
  const ids = [
    'scene-street-food', 'scene-night-market', 'scene-fresh-market',
    'scene-convenience-store', 'scene-bts-mrt', 'scene-apartment',
    'scene-cafe', 'scene-office', 'scene-school', 'scene-mall',
    'scene-park', 'scene-street-motorcycle',
  ];
  const colors = new Set(ids.map((id) => paletteFor({ ...scene, id }).skyTop));
  assert.ok(colors.size >= 8, '配色不是全场景复用同一套');
  assert.equal(paletteFor({ ...scene, id: 'scene-night-market' }).motif, 'lanterns');
  assert.equal(paletteFor({ ...scene, id: 'scene-convenience-store' }).motif, 'shelf');
  assert.equal(paletteFor(null).motif, 'food-stall');
});

test('长台词自动缩小字号，避免字幕溢出画面', () => {
  const long = '今天下班以后我们先去夜市逛一圈再吃一碗热乎乎的冬阴功然后慢慢走回家顺便买点水果';
  const sizeOf = (html: string): number =>
    Number(/--main-size:(\d+)px/.exec(html)?.[1] ?? 0);
  const shortSize = sizeOf(shotFrame('zh'));
  const longSize = sizeOf(shotFrame('zh', { primarySubtitle: long }));
  assert.ok(longSize < shortSize);
  assert.ok(longSize >= 40);
});

test('场景缩略图是合法独立 SVG，且体积可控', () => {
  const svg = buildSceneThumb(scene);
  assert.ok(svg.trimStart().startsWith('<svg '));
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.equal(svg.match(/xmlns=/g)?.length, 1, 'xmlns 只能出现一次，重复会让 SVG 非法');
  assert.match(svg, /width="270"/, '缩略图按 1/4 尺寸声明，避免逐张按 1080×1920 解码');
  // 噪点层（feTurbulence）在十几张同屏时开销很大，缩略图必须去掉
  assert.ok(!svg.includes('url(#grain)'));
  assert.ok(svg.length < 40_000, `缩略图过大：${svg.length}`);
  // 不同场景必须画出不同配色，否则「选了没反应」的观感又回来了
  const other = buildSceneThumb({ ...emptyScene('scene-park'), name: '公园', keywords: ['公园'] });
  assert.notEqual(svg, other);
});

test('场景缩略图在没有场景时退回默认画面而不是报错', () => {
  const svg = buildSceneThumb(null);
  assert.ok(svg.includes('<svg'));
});

test('对白行下拉里的情绪词能画出不同眉眼/嘴型，选了不是没反应', () => {
  const frameOf = (expression: string): string => shotFrame('zh', { shot: { ...shot, expression } });
  const frames = ['自然', '开心', '皱眉', '慌张', '冷笑', '认真'].map(frameOf);
  assert.equal(new Set(frames).size, 6, '六种情绪应是六张不同的画面');
  // 「冷笑」含「笑」，不能被宽泛的「笑」判成大笑张嘴。
  assert.ok(!frameOf('冷笑').includes('M96 176 Q120 208 144 176'));
  assert.ok(frameOf('开心').includes('M96 176 Q120 208 144 176'));
  assert.ok(frameOf('皱眉').includes('M84 130 l28 8'), '皱眉要有内压的眉头');
});
