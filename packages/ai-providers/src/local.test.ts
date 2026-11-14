import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.ok(draft.th.length > 0, '双语项目只粘中文时，泰语栏仍由内置句式补齐（不是翻译）');
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
    // 规范写法是一行一句；这里仍验证「三句都没命中关键词时不堆在同一个场景」。
    textZh: '第一句在这里。\n第二句也在这里。\n第三句仍然在这里。',
  });
  const shots = await provider.splitShots({
    script: { ...emptyScript(), topic: '随手记一下', lines: draft.lines, zh: draft.zh, th: draft.th },
    characters, scenes: generic,
  });
  assert.equal(shots.length, 3);
  assert.equal(new Set(shots.map((s) => s.sceneId)).size, 3, '三个镜头应轮换到三个场景');
});

test('规范台词里引号内的问号不会把句子切碎', async () => {
  const lines = [
    '妮娜微笑地说：“你好，要吃点什么吗？”',
    '阿顿好奇地说：“今天还有冬阴功吗？”',
    '旁白：一碗热汤，就是一天的收尾。',
  ];
  const draft = await provider.generateScript({
    topic: '夜市', inputMode: 'zh', characters, scenes, textZh: lines.join('\n'),
  });
  assert.equal(draft.lines.length, 3, '三句就是三行，不再凭空补模板句');
  // 规范剧本会拆出四要素：台词列只留引号内的纯台词，人物名和「地说」不再混进字幕。
  assert.equal(draft.lines[0].textZh, '你好，要吃点什么吗？');
  assert.equal(draft.lines[1].textZh, '今天还有冬阴功吗？');
  assert.equal(draft.lines[0].emotion, '微笑');
  assert.equal(draft.lines[1].emotion, '好奇');
  assert.ok(draft.lines.every((l) => l.textZh !== '”'), '不能出现孤立的右引号镜头');
});

test('手写规范格式的剧本正文切分镜时同样不会被切开', async () => {
  const script = {
    ...emptyScript(),
    zh: '妮娜微笑地说：“你好，要吃点什么吗？”\n阿顿好奇地说：“今天还有冬阴功吗？”',
  };
  const shots = await provider.splitShots({ script, characters, scenes });
  assert.equal(shots.length, 2);
  assert.ok(shots[0].dialogueZh.includes('什么吗？”'));
});

test('粘贴模式按实际句数（最多 12 句），主题模式固定 5 句', async () => {
  const many = Array.from({ length: 15 }, (_, i) => `第 ${i + 1} 句台词。`).join('\n');
  const pasted = await provider.generateScript({
    topic: '夜市', inputMode: 'zh', characters, scenes, textZh: many,
  });
  assert.equal(pasted.lines.length, 12);
  const byTopic = await provider.generateScript({
    topic: '夜市', inputMode: 'topic', characters, scenes, textZh: many,
  });
  assert.equal(byTopic.lines.length, 5, '切回主题模式后残留文案不能影响句数');
});

test('场景名切出的词也参与匹配：改了名字忘了填关键词仍能命中', async () => {
  const street = { ...emptyScene('scene-street'), name: '曼谷街边餐馆', keywords: ['吃', '饭'] };
  const home = { ...emptyScene('scene-home'), name: '家里 · 客厅', keywords: [] };
  const script = { ...emptyScript(), zh: '阿顿瘫在客厅沙发上。' };
  const shots = await provider.splitShots({ script, characters, scenes: [street, home] });
  assert.equal(shots.length, 1);
  assert.equal(shots[0].sceneId, 'scene-home', '只填场景名也能命中「客厅」');
});

test('默认场景库识别家庭日常台词，不再乱跳便利店 / 咖啡厅 / 街道', async () => {
  const defaults = JSON.parse(
    readFileSync(new URL('../../../config/scenes.json', import.meta.url), 'utf8'),
  );
  const script = {
    ...emptyScript(),
    zh: [
      '阿顿瘫沙发玩手机，妮娜端水杯走过来',
      '吨吨拿着马克笔，正在往白墙画画',
      '爸爸，你看我画的恐龙',
      '妮娜走近，看见墙上画，皱眉',
    ].join('\n'),
  };
  const shots = await provider.splitShots({ script, characters, scenes: defaults });
  assert.equal(shots.length, 4);
  assert.ok(
    shots.every((s) => s.sceneId === 'scene-apartment'),
    `四句都应落到「家里 · 客厅」，实测：${shots.map((s) => s.sceneId).join(', ')}`,
  );
});

const NAMED = [
  { ...emptyCharacter('char-a'), name: '妮娜' },
  { ...emptyCharacter('char-b'), name: '阿顿' },
  { ...emptyCharacter('char-c'), name: '吨吨' },
];
const FAMILY_SCRIPT = [
  '【场景】家里客厅・白天・自然光',
  '旁白：本以为是轻松带娃任务',
  '妮娜认真地说：“阿顿，交给你一个重要任务，看好吨吨！”',
  '阿顿自信地说：“放心！包在我身上！”',
  '吨吨兴奋地说：“爸爸，你看我画的恐龙！”',
  '旁白：转头直接暴击',
  '妮娜皱眉说：“墙上怎么画成这样？”',
  '阿顿慌张地说：“是我画的！别骂孩子！”',
  '妮娜冷笑地说：“行，那今晚你来擦墙。”',
  '旁白：父爱，代价是擦墙',
].join('\n');

test('粘贴规范剧本：9 行对白四要素齐全，正文保留用户原文', async () => {
  const draft = await provider.generateScript({
    topic: '', inputMode: 'zh', characters: NAMED, scenes, languageMode: 'zh', textZh: FAMILY_SCRIPT,
  });
  assert.equal(draft.lines.length, 9, '场景行不生成对白行');
  assert.equal(draft.lines[1].speakerId, 'char-a', '说话人按台词里的人名取');
  assert.equal(draft.lines[1].textZh, '阿顿，交给你一个重要任务，看好吨吨！', '台词列不留人物名和「地说」');
  assert.equal(draft.lines[1].emotion, '认真');
  assert.equal(draft.lines[5].action, '皱眉');
  assert.equal(draft.lines[0].speakerId, '__narration__');
  assert.equal(draft.zh, FAMILY_SCRIPT, '生成不再把正文覆盖成纯台词');
  assert.ok(draft.lines.every((l) => l.sceneSuggestion === '家里客厅'), '场景提示下发给每行');
  assert.ok(draft.sceneSuggestions.includes('家里客厅'));
});

test('粘贴模式切分镜：旁白行不画人物，其余镜头按对白行说话人出场', async () => {
  const draft = await provider.generateScript({
    topic: '', inputMode: 'zh', characters: NAMED, scenes, languageMode: 'zh', textZh: FAMILY_SCRIPT,
  });
  const script = { ...emptyScript(), ...draft };
  const shots = await provider.splitShots({ script, characters: NAMED, scenes });
  assert.equal(shots.length, 9);
  assert.deepEqual(shots[0].characterIds, [], '旁白镜头不指向具体人物');
  assert.deepEqual(shots[1].characterIds, ['char-a']);
  assert.equal(shots[1].expression, '认真');
  assert.equal(shots[1].action, '正视对方');
  assert.equal(shots[1].subtitleZh, '阿顿，交给你一个重要任务，看好吨吨！');
  assert.ok(shots.every((s) => !s.characterIds.includes('__narration__')), '哨兵不能漏进人物列表');
});

test('主题模式仍是 5 句内置模板，不受规范解析影响', async () => {
  const draft = await provider.generateScript({
    topic: '下班后去夜市吃冬阴功', inputMode: 'topic', characters: NAMED, scenes, languageMode: 'bilingual',
  });
  assert.equal(draft.lines.length, 5);
  assert.ok(draft.lines.every((l) => l.textZh && l.textTh));
});
