/**
 * 场景自动匹配回归：程序只是按关键词猜，所以结果必须可解释；
 * 人工纠正过的场景必须真的算数，不能被下一次「自动分镜」冲掉。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyScene, emptyShot } from './types.js';
import type { Scene } from './types.js';
import {
  inheritManualSceneSelections, sceneWords, shotSceneSuggestion, suggestScene,
} from './sceneMatch.js';

const scene = (id: string, name: string, keywords: string[]): Scene => ({
  ...emptyScene(id), name, keywords,
});

const home = scene('scene-home', '家里 · 客厅', ['马克笔', '白墙']);
const market = scene('scene-market', '泰国夜市', ['夜市', '小吃']);

test('可匹配词表 = 关键词 + 场景名切词，单字与数字不会混进来', () => {
  assert.deepEqual(sceneWords(home), ['马克笔', '白墙', '家里', '客厅']);
  assert.deepEqual(sceneWords(scene('s', '24 小时便利店', ['买水'])), ['买水', '小时便利店']);
});

test('台词命中：给出命中词、依据、置信度与排序后的备选', () => {
  const result = suggestScene({ text: '吨吨拿着马克笔往白墙画画', scenes: [market, home], index: 0 });
  assert.equal(result.sceneId, 'scene-home');
  assert.equal(result.reason, 'keyword');
  assert.ok(result.matchedWords.includes('马克笔'));
  assert.ok(result.confidence >= 0.6, '两个长词命中，依据应当充分');
  assert.equal(result.candidates[0].sceneId, 'scene-home');
});

test('剧本里用户写的场景提示优先于台词里偶然出现的词', () => {
  const result = suggestScene({ text: '你好呀', hint: '泰国夜市', scenes: [home, market], index: 0 });
  assert.equal(result.sceneId, 'scene-market');
  assert.equal(result.reason, 'hint');
  assert.ok(result.matchedWords.includes('夜市'));
});

test('台词没线索时只靠主题，明确标成弱依据', () => {
  const result = suggestScene({ text: '今天天气不错', topic: '去逛夜市', scenes: [home, market], index: 0 });
  assert.equal(result.sceneId, 'scene-market');
  assert.equal(result.reason, 'topic');
  assert.ok(result.confidence > 0 && result.confidence <= 0.5);
});

test('一个关键词都没命中：标成程序兜底、零把握，且轮换不堆在同一个场景', () => {
  const scenes = [scene('a', '场景甲', ['zzz']), scene('b', '场景乙', ['qqq']), scene('c', '场景丙', ['xxx'])];
  const first = suggestScene({ text: '嗯', scenes, index: 0 });
  const second = suggestScene({ text: '嗯', scenes, index: 1 });
  assert.equal(first.reason, 'fallback');
  assert.equal(first.confidence, 0);
  assert.deepEqual(first.matchedWords, []);
  assert.notEqual(first.sceneId, second.sceneId, '兜底轮换不能把整片都塞进同一个地方');
});

test('场景库为空时不假装匹配成功', () => {
  const result = suggestScene({ text: '去逛夜市', scenes: [], index: 0 });
  assert.equal(result.reason, 'none');
  assert.equal(result.sceneId, '');
});

test('长词权重高于「吃」「家」这类单字泛词', () => {
  const vague = scene('scene-vague', '家', ['吃']);
  const result = suggestScene({ text: '吃马克笔', scenes: [vague, home], index: 0 });
  assert.equal(result.sceneId, 'scene-home', '具体词命中不该被一个泛词压过去');
});

test('镜头的自动建议与自动分镜用的同一个纯函数、同一份台词取法', () => {
  const shot = { ...emptyShot(1, 'shot-1'), dialogueZh: '去逛夜市', dialogueTh: '', sceneHint: '' };
  const viaShot = shotSceneSuggestion(shot, [home, market], '', 0);
  const direct = suggestScene({ text: '去逛夜市', hint: '', topic: '', scenes: [home, market], index: 0 });
  assert.deepEqual(viaShot, direct, '审阅面板显示的建议必须就是自动分镜采用的建议');
});

test('重新自动分镜：手动指定的场景按台词继承，自动镜头保持新结果', () => {
  const previous = [
    { ...emptyShot(1, 'old-1'), dialogueZh: '去逛夜市', sceneId: 'scene-market', sceneSource: 'manual' as const },
    { ...emptyShot(2, 'old-2'), dialogueZh: '在家画画', sceneId: 'scene-home', sceneSource: 'auto' as const },
    { ...emptyShot(3, 'old-3'), dialogueZh: '随便走走', sceneId: 'scene-park', sceneSource: 'manual' as const },
  ];
  const next = [
    { ...emptyShot(1, 'new-1'), dialogueZh: '去逛夜市', sceneId: 'scene-home' },
    { ...emptyShot(2, 'new-2'), dialogueZh: '在家画画', sceneId: 'scene-market' },
    // 台词被改过、对不上时按镜头序号继承，仍然保住用户的手动选择
    { ...emptyShot(3, 'new-3'), dialogueZh: '台词被改过了', sceneId: 'scene-cafe' },
  ];
  const out = inheritManualSceneSelections(next, previous);
  assert.equal(out[0].sceneId, 'scene-market');
  assert.equal(out[0].sceneSource, 'manual');
  assert.equal(out[1].sceneId, 'scene-market', '旧镜头是 auto，不该把它的场景搬过来');
  assert.equal(out[1].sceneSource, 'auto');
  assert.equal(out[2].sceneId, 'scene-park');
  assert.equal(out[2].sceneSource, 'manual');
});

test('没有手动场景时原样返回；同一条手动选择不会被重复套到两个镜头', () => {
  const next = [
    { ...emptyShot(1, 'n1'), dialogueZh: '同一句', sceneId: 'auto-a' },
    { ...emptyShot(2, 'n2'), dialogueZh: '同一句', sceneId: 'auto-b' },
  ];
  assert.equal(inheritManualSceneSelections(next, []), next);
  const previous = [
    { ...emptyShot(1, 'p1'), dialogueZh: '同一句', sceneId: 'manual-a', sceneSource: 'manual' as const },
  ];
  const out = inheritManualSceneSelections(next, previous);
  assert.equal(out[0].sceneId, 'manual-a');
  assert.equal(out[1].sceneId, 'auto-b');
});
