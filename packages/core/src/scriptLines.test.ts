import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyCharacter } from './types.js';
import {
  ACTION_OPTIONS, EMOTION_OPTIONS, NARRATION_SPEAKER,
  formatScriptLine, keepsCustomMood, parseSceneName, parseScriptLines, rewriteScriptText,
} from './scriptLines.js';

const chars = [
  { ...emptyCharacter('char-a'), name: '妮娜', nameTh: 'นีน่า' },
  { ...emptyCharacter('char-b'), name: '阿顿', nameTh: 'อาร์ต' },
  { ...emptyCharacter('char-c'), name: '吨吨', nameTh: 'ดันดัน' },
];

/** 用户实际粘贴的规范剧本：1 行场景 + 4 行旁白 + 5 行对白。 */
const SCRIPT = [
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

test('场景行只提取场景名，不生成对白行也不占镜头', () => {
  assert.equal(parseSceneName('【场景】家里客厅・白天・自然光'), '家里客厅');
  assert.equal(parseSceneName('场景：曼谷街边餐馆 · 傍晚 · 暖光'), '曼谷街边餐馆');
  assert.equal(parseSceneName('妮娜说：“你好”'), null);
  const { lines, sceneName } = parseScriptLines(SCRIPT, chars);
  assert.equal(sceneName, '家里客厅');
  assert.equal(lines.length, 9, '10 行去掉场景行 = 9 个对白行');
  assert.ok(lines.every((l) => l.sceneSuggestion === '家里客厅'), '场景提示下发给每一行');
  assert.deepEqual(lines.map((l) => l.sourceIndex), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('说话人按台词里的人名取，旁白用哨兵，不再按 3 人轮换', () => {
  const { lines } = parseScriptLines(SCRIPT, chars);
  assert.deepEqual(lines.map((l) => l.speakerId), [
    NARRATION_SPEAKER, 'char-a', 'char-b', 'char-c', NARRATION_SPEAKER,
    'char-a', 'char-b', 'char-a', NARRATION_SPEAKER,
  ]);
  assert.ok(lines.filter((l) => l.speakerId === NARRATION_SPEAKER).every((l) => !l.emotion && !l.action),
    '旁白行不留情绪/动作');
});

test('台词列只留引号内的纯台词，人物名与「地说」不再混进字幕', () => {
  const { lines } = parseScriptLines(SCRIPT, chars);
  assert.equal(lines[1].textZh, '阿顿，交给你一个重要任务，看好吨吨！');
  assert.equal(lines[2].textZh, '放心！包在我身上！');
  assert.equal(lines[0].textZh, '本以为是轻松带娃任务');
  assert.ok(lines.every((l) => !l.textZh.includes('说：') && !l.textZh.includes('【场景】')));
});

test('情绪/动作从描述段自动匹配；认不出的给中性默认值', () => {
  const { lines } = parseScriptLines(SCRIPT, chars);
  assert.deepEqual(lines[1].emotion, '认真');
  assert.deepEqual(lines[1].action, '正视对方');
  assert.equal(lines[2].emotion, '自信');
  assert.equal(lines[3].emotion, '兴奋');
  assert.deepEqual([lines[5].emotion, lines[5].action], ['不满', '皱眉']);
  assert.equal(lines[6].emotion, '慌张');
  assert.equal(lines[7].emotion, '不屑');
  assert.ok(EMOTION_OPTIONS.includes(lines[7].emotion) && ACTION_OPTIONS.includes(lines[7].action),
    '自动匹配出来的值必须都在下拉词表里');
  const unknown = parseScriptLines('妮娜神秘兮兮地说：“猜猜看。”', chars);
  assert.equal(unknown.lines[0].emotion, '自然');
  assert.equal(unknown.lines[0].action, '自然对话');
});

test('认不出人名或无冒号的纯文本行不猜，留空给用户选', () => {
  const { lines } = parseScriptLines('路人甲说：“你好。”\n一句没有冒号的旁白', chars);
  assert.equal(lines[0].speakerId, '');
  assert.equal(lines[0].textZh, '你好。');
  assert.equal(lines[1].speakerId, '');
  assert.equal(lines[1].textZh, '一句没有冒号的旁白');
});

test('场景行出现在中间时只影响后续行', () => {
  const { lines } = parseScriptLines('旁白：开场\n【场景】泰国夜市・傍晚\n妮娜说：“来一份。”', chars);
  assert.equal(lines[0].sceneSuggestion, '');
  assert.equal(lines[1].sceneSuggestion, '泰国夜市');
});

test('改对白行可重建规范文本并只写回正文对应行', () => {
  const { lines } = parseScriptLines(SCRIPT, chars);
  const edited = { ...lines[1], emotion: '严肃', action: '叉腰', textZh: '看好吨吨，别看电视！' };
  const next = rewriteScriptText(SCRIPT, edited, chars);
  const rows = next.split('\n');
  assert.equal(rows[2], '妮娜严肃地叉腰说：“看好吨吨，别看电视！”');
  assert.equal(rows[0], '【场景】家里客厅・白天・自然光', '场景行原样保留');
  assert.equal(rows[1], '旁白：本以为是轻松带娃任务', '其它行原样保留');
  assert.equal(formatScriptLine(lines[0], chars), '旁白：本以为是轻松带娃任务');
  const reparsed = parseScriptLines(next, chars);
  assert.equal(reparsed.lines[1].textZh, '看好吨吨，别看电视！');
  assert.equal(reparsed.lines[1].emotion, '严肃');
});

test('改说话人为旁白时按旁白格式写回', () => {
  const { lines } = parseScriptLines(SCRIPT, chars);
  const edited = { ...lines[1], speakerId: NARRATION_SPEAKER, emotion: '', action: '' };
  assert.equal(rewriteScriptText(SCRIPT, edited, chars).split('\n')[2], '旁白：阿顿，交给你一个重要任务，看好吨吨！');
});

test('重新解析时保留用户自己填的情绪/动作，只有描述段被改才重新匹配', () => {
  const { lines } = parseScriptLines(SCRIPT, chars);
  const custom = { ...lines[1], emotion: '瞳孔地震', action: '原地转圈' };
  const written = rewriteScriptText(SCRIPT, custom, chars).split('\n')[2];
  assert.match(written, /瞳孔地震.*原地转圈/);
  // 只改台词：描述段没变，自定义情绪动作不能被词表覆盖回去。
  assert.equal(keepsCustomMood(written.replace('看好吨吨！', '看好吨吨，别看电视！'), custom, chars), true);
  // 手改描述段：按新描述重新自动匹配。
  assert.equal(keepsCustomMood('妮娜冷笑地说：“看好吨吨！”', custom, chars), false);
  assert.equal(keepsCustomMood('旁白：本以为是轻松带娃任务', lines[0], chars), true);
});
