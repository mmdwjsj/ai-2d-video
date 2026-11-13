import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyCharacter, emptyScene, emptyScript } from '@thai-video/core/types';
import { LocalRuleProvider } from './local.js';

const characters = ['char-a', 'char-b', 'char-c'].map((id) => ({ ...emptyCharacter(id), name: id }));
const scenes = [
  { ...emptyScene('scene-night-market'), keywords: ['夜市', '逛', '小吃'] },
  { ...emptyScene('scene-street-food'), keywords: ['吃', '冬阴功', '餐馆'] },
];
const provider = new LocalRuleProvider();

test('本地规则生成中/泰成对的双语剧本，且明确要求校对', async () => {
  const input = { topic: '下班后去夜市吃冬阴功', inputMode: 'topic' as const, characters, scenes };
  const draft = await provider.generateScript(input);
  assert.ok(draft.lines.length >= 3);
  assert.equal(draft.cast.length, 3);
  assert.ok(draft.zh.length > 0 && draft.th.length > 0);
  assert.match(draft.note, /校对/);
  for (const line of draft.lines) {
    assert.ok(line.textZh && line.textTh, '中泰台词必须成对');
  }
  const again = await provider.generateScript(input);
  assert.equal(JSON.stringify(again.lines), JSON.stringify(draft.lines), '本地规则必须确定性可复现');
});

test('中文文案输入时保留用户原句', async () => {
  const draft = await provider.generateScript({
    topic: '', inputMode: 'zh', characters, scenes,
    textZh: '今天市场好热闹。老板来一份。',
  });
  assert.match(draft.zh, /今天市场好热闹/);
  assert.ok(draft.th.length > 0);
});

test('项目语言类型决定剧本语种：单语项目不生成另一种语言的台词', async () => {
  const input = { topic: '下班后去夜市吃冬阴功', inputMode: 'topic' as const, characters, scenes };

  const zhOnly = await provider.generateScript({ ...input, languageMode: 'zh' });
  assert.ok(zhOnly.zh.length > 0);
  assert.equal(zhOnly.th, '');
  assert.equal(zhOnly.narrationTh, '');
  for (const line of zhOnly.lines) assert.equal(line.textTh, '', '中文项目泰语对白必须留空');

  const thOnly = await provider.generateScript({ ...input, languageMode: 'th' });
  assert.ok(thOnly.th.length > 0);
  assert.equal(thOnly.zh, '');
  assert.equal(thOnly.narrationZh, '');
  for (const line of thOnly.lines) assert.equal(line.textZh, '', '泰语项目中文对白必须留空');

  const bilingual = await provider.generateScript({ ...input, languageMode: 'bilingual' });
  assert.ok(bilingual.zh.length > 0 && bilingual.th.length > 0);

  // 单语剧本照样能切分镜，且镜头里另一种语言的字幕为空。
  const zhScript = { ...emptyScript(), topic: '夜市', lines: zhOnly.lines, zh: zhOnly.zh, th: '' };
  const zhShots = await provider.splitShots({ script: zhScript, characters, scenes });
  assert.equal(zhShots.length, zhOnly.lines.length);
  for (const shot of zhShots) {
    assert.ok(shot.dialogueZh.length > 0);
    assert.equal(shot.dialogueTh, '');
    assert.equal(shot.subtitleTh, '');
  }
  const thScript = { ...emptyScript(), topic: '夜市', lines: thOnly.lines, zh: '', th: thOnly.th };
  const thShots = await provider.splitShots({ script: thScript, characters, scenes });
  assert.equal(thShots.length, thOnly.lines.length);
  for (const shot of thShots) assert.ok(shot.dialogueTh.length > 0);
});

test('只写了泰语正文时，自动分镜也能按泰语切句', async () => {
  const script = { ...emptyScript(), zh: '', th: 'สวัสดีค่ะ\nไปกินต้มยำกันเถอะ' };
  const shots = await provider.splitShots({ script, characters, scenes });
  assert.equal(shots.length, 2);
  assert.equal(shots[0].dialogueZh, '');
  assert.ok(shots[0].dialogueTh.includes('สวัสดี'));
});

test('自动分镜按台词切分、匹配场景、给足够时长', async () => {
  const draft = await provider.generateScript({ topic: '夜市', inputMode: 'topic', characters, scenes });
  const script = { ...emptyScript(), topic: '夜市', lines: draft.lines, zh: draft.zh, th: draft.th };
  const shots = await provider.splitShots({ script, characters, scenes });
  assert.equal(shots.length, draft.lines.length);
  for (const shot of shots) {
    assert.ok(shot.durationSec >= 2.5);
    assert.ok(scenes.some((s) => s.id === shot.sceneId));
    assert.ok(shot.characterIds.length > 0);
    assert.equal(shot.subtitleZh, shot.dialogueZh);
  }
});

test('台词没有命中任何关键词时，镜头不会全堆在第一个场景', async () => {
  const generic = [
    { ...emptyScene('scene-apartment'), name: '公寓', type: '居家', keywords: ['zzz'] },
    { ...emptyScene('scene-street-motorcycle'), name: '街头', type: '交通', keywords: ['qqq'] },
    { ...emptyScene('scene-convenience-store'), name: '便利店', type: '日常', keywords: ['xxx'] },
  ];
  const draft = await provider.generateScript({
    topic: '随手记一下', inputMode: 'zh', characters, scenes: generic,
    textZh: '第一句在这里。第二句也在这里。第三句仍然在这里。',
  });
  const shots = await provider.splitShots({
    script: { ...emptyScript(), topic: '随手记一下', lines: draft.lines, zh: draft.zh, th: draft.th },
    characters, scenes: generic,
  });
  assert.equal(shots.length, 3);
  assert.equal(new Set(shots.map((s) => s.sceneId)).size, 3, '三个镜头应轮换到三个场景');
});
