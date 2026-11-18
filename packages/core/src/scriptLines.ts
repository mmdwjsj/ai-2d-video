/**
 * 规范剧本 → 对白行的**唯一**解析器。
 *
 * 项目只约定一种写法（见 SCRIPT_RULES）：
 *   【场景】家里客厅・白天・自然光
 *   旁白：本以为是轻松带娃任务
 *   妮娜认真地说：“阿顿，交给你一个重要任务，看好吨吨！”
 *
 * 这里刻意不做「格式判别」：每一行都按同一套确定性规则解释，认不出来的部分
 * 留空或给默认值，交给用户在下拉框里选。以前靠启发式区分「分镜脚本 / 一句一行」
 * 会让用户无法预期系统怎么读自己写的字，那种中间态不再引入。
 */
import type { Character, ScriptLine } from '@thai-video/core/types';

/**
 * 情境 / 旁白行的「类型」哨兵（复用 speakerId 字段存放，仅为不改动既有数据结构）。
 * 旁白不是人物、不是说话人：splitShots 据此生成「无出场人物 + 画外音字幕」的情境镜头，
 * 前端也不会把它列进说话人下拉，更不给它情绪/动作。
 */
export const NARRATION_SPEAKER = '__narration__';

export const DEFAULT_EMOTION = '自然';
export const DEFAULT_ACTION = '自然对话';

/** 情绪下拉词表。sceneArt 的 expressionOf 会按这些词映射不同眉眼/嘴型。 */
export const EMOTION_OPTIONS: string[] = [
  '自然', '平静', '认真', '自信', '严肃', '温柔', '开心', '微笑', '大笑', '兴奋', '得意',
  '好奇', '疑惑', '惊讶', '紧张', '慌张', '无奈', '尴尬', '不满', '生气', '不屑', '冷笑',
  '疲惫', '感动', '失落',
];

/** 动作下拉词表：都是通用舞台动作，剧本特有的动作由用户自己填。 */
export const ACTION_OPTIONS: string[] = [
  '自然对话', '看向对方', '正视对方', '点头', '摇头', '挥手', '摊手', '摆手', '皱眉',
  '抱臂', '托腮', '歪头', '抬手指', '走近', '转身', '低头', '抬头', '愣住', '拍肩',
  '递东西', '端起杯子', '放下东西', '捂脸', '叉腰',
];

type Hint = { keys: string[]; emotion: string; action: string };

/**
 * 描述段 → 情绪/动作的先验映射。用户原文里的「认真地说」「皱眉说」「慌张地说」
 * 都是「人物名＋表情/动作＋说」里的那一段，先按常识给一组值，不对再让用户在下拉里改。
 */
const HINTS: Hint[] = [
  { keys: ['认真'], emotion: '认真', action: '正视对方' },
  { keys: ['自信'], emotion: '自信', action: '抬头' },
  { keys: ['兴奋'], emotion: '兴奋', action: '挥手' },
  { keys: ['皱眉'], emotion: '不满', action: '皱眉' },
  { keys: ['慌张'], emotion: '慌张', action: '摆手' },
  { keys: ['冷笑'], emotion: '不屑', action: '抱臂' },
  { keys: ['微笑'], emotion: '微笑', action: '看向对方' },
  { keys: ['好奇'], emotion: '好奇', action: '歪头' },
  { keys: ['生气', '愤怒'], emotion: '生气', action: '叉腰' },
  { keys: ['无奈'], emotion: '无奈', action: '摊手' },
  { keys: ['惊讶', '吃惊', '瞳孔地震'], emotion: '惊讶', action: '愣住' },
  { keys: ['温柔', '轻声'], emotion: '温柔', action: '看向对方' },
  { keys: ['开心', '大笑', '笑'], emotion: '开心', action: '挥手' },
  { keys: ['严肃'], emotion: '严肃', action: '正视对方' },
  { keys: ['紧张'], emotion: '紧张', action: '低头' },
  { keys: ['疑惑', '纳闷'], emotion: '疑惑', action: '托腮' },
  { keys: ['尴尬'], emotion: '尴尬', action: '捂脸' },
  { keys: ['疲惫', '累'], emotion: '疲惫', action: '低头' },
  { keys: ['得意'], emotion: '得意', action: '抱臂' },
];

/** 描述段没命中先验表时，退到「词表里出现的词」，仍然认不出就给中性默认值。 */
const hintFor = (descriptor: string): { emotion: string; action: string } => {
  const hit = HINTS.find((h) => h.keys.some((k) => descriptor.includes(k)));
  if (hit) return { emotion: hit.emotion, action: hit.action };
  const emotion = EMOTION_OPTIONS.find((w) => w !== DEFAULT_EMOTION && descriptor.includes(w)) ?? DEFAULT_EMOTION;
  const action = ACTION_OPTIONS.find((w) => w !== DEFAULT_ACTION && descriptor.includes(w)) ?? DEFAULT_ACTION;
  return { emotion, action };
};

/** 【场景】家里客厅・白天・自然光 → 家里客厅；只取第一段，时间/光线不进场景名。 */
export const parseSceneName = (raw: string): string | null => {
  const m = raw.trim().match(/^(?:【场景】|场景\s*[:：]|ฉาก\s*[:：])\s*(.+)$/u);
  if (!m) return null;
  return m[1].split(/[・·/｜|，,、\s]+/u)[0].trim() || null;
};

const NARRATION_LINE = /^(?:旁白|画外音|บรรยาย|Narrator)\s*[:：]\s*(.*)$/iu;
const QUOTE_EDGES = /^[“”"「」『』]+|[“”"「」『』]+$/gu;
const SPEAK_TAIL = /(?:地|的)?(?:说|道|问|答|喊|叫|讲|说道|问道|答道)$/u;

/** 从「妮娜认真地说」里找项目里真实存在的人物名，长名优先，避免「吨吨」被「吨」截断。 */
const matchSpeaker = (head: string, characters: Character[]): { id: string; name: string } | null => {
  const names = characters
    .flatMap((c) => [c.name, c.nameTh].filter((n): n is string => Boolean(n && n.trim())).map((name) => ({ id: c.id, name })))
    .sort((a, b) => b.name.length - a.name.length);
  return names.find((n) => head.startsWith(n.name)) ?? null;
};

const parseDialogue = (raw: string, characters: Character[]): Pick<ScriptLine, 'speakerId' | 'textZh' | 'emotion' | 'action'> => {
  const colon = raw.match(/^(.+?)\s*[:：]\s*(.+)$/u);
  if (!colon) {
    // 没有冒号：仍算一行，但说话人留空让用户在下拉里指定，不静默猜人。
    return { speakerId: '', textZh: raw, emotion: DEFAULT_EMOTION, action: DEFAULT_ACTION };
  }
  const head = colon[1].trim();
  const tail = colon[2].trim().replace(QUOTE_EDGES, '').trim();
  const speaker = matchSpeaker(head, characters);
  const descriptor = (speaker ? head.slice(speaker.name.length) : head)
    .replace(SPEAK_TAIL, '').replace(/地$/u, '').trim();
  const { emotion, action } = hintFor(descriptor);
  return {
    speakerId: speaker?.id ?? '',
    textZh: tail,
    emotion,
    action,
  };
};

export type ParsedScript = {
  lines: ScriptLine[];
  /** 【场景】行提取出的场景名；不生成对白行，只作为全片场景提示。 */
  sceneName: string;
};

/**
 * 把规范剧本正文解析成对白行。
 * sourceIndex 记录该行在原文里的行号，供前端「改对白行 → 写回正文对应行」使用。
 */
export const parseScriptLines = (text: string, characters: Character[]): ParsedScript => {
  const rows = (text ?? '').split('\n');
  const lines: ScriptLine[] = [];
  let sceneName = '';
  rows.forEach((raw, sourceIndex) => {
    const line = raw.trim();
    if (!line) return;
    const scene = parseSceneName(line);
    if (scene !== null) { sceneName = scene; return; }

    const narration = line.match(NARRATION_LINE);
    const base: ScriptLine = narration
      ? { id: '', speakerId: NARRATION_SPEAKER, textZh: narration[1].trim(), textTh: '', emotion: '', action: '', sceneSuggestion: '' }
      : { id: '', ...parseDialogue(line, characters), textTh: '', sceneSuggestion: '' };
    lines.push({
      ...base,
      id: `line-${lines.length + 1}`,
      sceneSuggestion: sceneName,
      sourceIndex,
    });
  });
  return { lines, sceneName };
};

/** 把一行对白行重建为规范文本，用于编辑后写回剧本正文。 */
export const formatScriptLine = (line: ScriptLine, characters: Character[]): string => {
  const text = line.textZh ?? '';
  if (line.speakerId === NARRATION_SPEAKER) return `旁白：${text}`;
  if (!line.speakerId) return text;
  const name = characters.find((c) => c.id === line.speakerId)?.name ?? '';
  if (!name) return text;
  const emotion = (line.emotion ?? '').trim();
  const action = (line.action ?? '').trim();
  const parts: string[] = [];
  if (emotion && emotion !== DEFAULT_EMOTION) parts.push(`${emotion}地`);
  if (action && action !== DEFAULT_ACTION && !parts.join('').includes(action)) parts.push(action);
  return `${name}${parts.join('')}说：“${text}”`;
};

/** 只替换 sourceIndex 指向的那一行，其余原文（含【场景】行）保持不动。 */
export const rewriteScriptText = (text: string, line: ScriptLine, characters: Character[]): string => {
  if (line.sourceIndex == null || line.sourceIndex < 0) return text;
  const rows = (text ?? '').split('\n');
  if (line.sourceIndex >= rows.length) return text;
  rows[line.sourceIndex] = formatScriptLine(line, characters);
  return rows.join('\n');
};

/**
 * 重新解析正文时，判断这一行的「情绪/动作」该不该沿用对白行里用户改过的值。
 *
 * 只比较人物名＋描述段（台词可以忽略）：只改台词 → 保留用户自定义值；
 * 手改了描述词（如「认真地说」改「冷笑地说」）→ 按新描述重新自动匹配。
 * 否则用户自己填的情绪一重新解析就被词表覆盖回去，「支持自己填写」就落空了。
 */
export const keepsCustomMood = (rawLine: string, line: ScriptLine, characters: Character[]): boolean => {
  const prefix = (s: string): string => s.split(/说[：“]/u)[0];
  return prefix(rawLine.trim()) === prefix(formatScriptLine(line, characters));
};
