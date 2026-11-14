/**
 * 本地规则文本 Provider（第一阶段默认）。
 *
 * 它不调用任何外部模型，也不假装会翻译：中文/泰语台词来自一组**成对的
 * 泰国日常口语句式**（不是逐字互译），输出里带 note 要求人工或阶段二模型
 * 校对。这样第一阶段无需密钥就能完整走通「主题 → 双语剧本 → 分镜」验收。
 *
 * 粘贴/导入模式一律按项目规范解析（见 @thai-video/core/scriptLines），
 * 不判别「这是哪种剧本风格」——只有一套规则，用户能预期系统怎么读自己写的字。
 */
import { showsTh, showsZh } from '@thai-video/core/types';
import { NARRATION_SPEAKER, parseScriptLines } from '@thai-video/core/scriptLines';
import type { Character, LanguageMode, Scene, Script, ScriptInputMode, ScriptLine } from '@thai-video/core/types';
import type { GenerateScriptInput, ScriptDraft, ShotDraft, TextProvider } from './types.js';

type Pair = { zh: string; th: string; keys: string[]; emotion: string; action: string };

/** 中文与泰语各自自然、语义对应的日常口语短句。 */
const PAIRS: Pair[] = [
  { zh: '下班啦，今天想去哪儿吃？', th: 'เลิกงานแล้ว วันนี้ไปกินอะไรดี', keys: ['下班', '吃', '饭', '工作'], emotion: '轻松', action: '放下包、看向对方' },
  { zh: '走，去夜市逛一圈吧！', th: 'ไปเดินตลาดนัดกันเถอะ', keys: ['夜市', '逛', '买', '小吃'], emotion: '兴奋', action: '抬手招呼' },
  { zh: '这家的冬阴功真的绝了。', th: 'ต้มยำร้านนี้อร่อยมากเลยนะ', keys: ['冬阴功', '美食', '餐馆', '吃'], emotion: '满足', action: '端起碗、尝一口' },
  { zh: '老板，还是老样子，一份。', th: 'ลุงครับ ตามเดิมเลยหนึ่งที่', keys: ['老板', '小店', '点餐', '餐馆'], emotion: '熟络', action: '举手点单' },
  { zh: '今天怎么这么多人啊？', th: 'วันนี้คนเยอะขนาดนี้เลยเหรอ', keys: ['人', '排队', '商场', 'BTS', '通勤'], emotion: '好奇', action: '左右张望' },
  { zh: '慢慢来，泰国时间嘛。', th: 'ค่อย ๆ ไปครับ สบาย ๆ', keys: ['堵车', '迟到', '等', '慢慢'], emotion: '幽默', action: '笑着摊手' },
  { zh: '明天还要早起，先回啦。', th: 'พรุ่งนี้ต้องตื่นเช้า กลับก่อนนะ', keys: ['回家', '公寓', '早起', '累'], emotion: '温和', action: '挥手道别' },
  { zh: '这个我请客，别抢。', th: 'รอบนี้ผมเลี้ยงเองนะ อย่าแย่ง', keys: ['付钱', '请客', '便利店', '咖啡'], emotion: '爽快', action: '伸手拦住对方' },
];

const NOTE = '本地规则生成：泰语为泰国日常口语句式模板（非逐字翻译），正式生成前请人工校对；阶段二配置文本模型后可重写。';

/**
 * 按句末标点 / 换行切句，但引号内的标点不算句子结束。
 *
 * 规范台词是「妮娜微笑地说：“今天还有冬阴功吗？”」——引号里的问号属于台词，
 * 用正则一刀切会把整句劈成两段、还多出一个孤立的「”」镜头。
 * 手写剧本正文（没有对白行时）仍走这里做兜底切分。
 */
const splitSentences = (text: string): string[] => {
  const out: string[] = [];
  let buf = '';
  let quoteDepth = 0;
  for (const ch of text) {
    if (ch === '“' || ch === '「' || ch === '『') quoteDepth += 1;
    else if ((ch === '”' || ch === '」' || ch === '』') && quoteDepth > 0) quoteDepth -= 1;
    if (quoteDepth === 0 && /[。！？!?\n]/.test(ch)) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.slice(0, 12);
};

/**
 * 场景的「可匹配词表」= 用户填的关键词 + 场景名切出来的词。
 *
 * 场景名也参与匹配，是为了「改了名字却忘了同步关键词」时仍能命中（例如把
 * 「曼谷公寓」改成「家里 · 客厅」）。只取 name，不取 location：像「街角 24 小时
 * 便利店」会切出「小时」这类泛词，反而把不相干的台词吸过去。
 */
const sceneWords = (scene: Scene): string[] => {
  const fromName = (scene.name ?? '')
    .split(/[\s·・/、，,（）()｜|\-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !/^\d+$/.test(w));
  return [...new Set([...(scene.keywords ?? []).filter(Boolean), ...fromName])];
};

/**
 * 按可匹配词表给一句话挑场景。
 *
 * 只有「真的命中」才算匹配，返回 null 交给上层兜底——这样不会因为所有分数都是 0
 * 就把每个镜头都塞进 scenes[0]（以前所有镜头堆在街边餐馆的直接原因）。
 */
const matchScene = (text: string, scenes: Scene[]): Scene | null => {
  let best: Scene | null = null;
  let bestScore = 0;
  for (const scene of scenes) {
    const score = sceneWords(scene).reduce((sum, key) => sum + (text.includes(key) ? 1 : 0), 0);
    if (score > bestScore) { best = scene; bestScore = score; }
  }
  return best;
};

/** 完全没命中时的兜底：优先日常通用场景，并在其中按下标轮换，避免整片都是同一个地方。 */
const fallbackScene = (scenes: Scene[], index: number): Scene | null => {
  if (!scenes.length) return null;
  const generic = scenes.filter((s) =>
    /家|公寓|apartment|街|street|便利|convenience|咖啡|cafe/i.test(`${s.id} ${s.name} ${s.type} ${s.location}`));
  const pool = generic.length ? generic : scenes;
  return pool[index % pool.length];
};

/** 一句话定场景：先看这句台词/场景提示，再退到整篇主题，最后轮换兜底。 */
const pickScene = (lineText: string, topic: string, scenes: Scene[], index: number): Scene | null =>
  matchScene(lineText, scenes) ?? matchScene(topic, scenes) ?? fallbackScene(scenes, index);


const estimateDuration = (zh: string, th: string): number => {
  const spoken = Math.max(zh.length / 4.2, th.length / 8);
  return Math.round(Math.min(12, Math.max(2.5, spoken + 1.2)) * 10) / 10;
};

const pickPairs = (topic: string, count: number): Pair[] => {
  const ranked = [...PAIRS].sort((a, b) => {
    const score = (p: Pair) => p.keys.reduce((n, k) => n + (topic.includes(k) ? 1 : 0), 0);
    return score(b) - score(a);
  });
  const out: Pair[] = [];
  for (let i = 0; out.length < count; i += 1) {
    out.push(ranked[i % ranked.length]);
  }
  return out;
};

export class LocalRuleProvider implements TextProvider {
  readonly id = 'local-rule-v1';

  async generateScript(input: GenerateScriptInput): Promise<ScriptDraft> {
    const topic = input.topic.trim() || '泰国日常生活';
    const mode: ScriptInputMode = input.inputMode;
    // 项目语言类型：单语项目只生成一种语言的台词，另一栏留空（不删除用户已有内容）。
    const language: LanguageMode = input.languageMode ?? 'bilingual';
    const wantZh = showsZh(language);
    const wantTh = showsTh(language);
    const useInput = mode !== 'topic';

    const zhText = (input.textZh ?? '').trim();
    const thText = (input.textTh ?? '').trim();
    const parsedZh = wantZh && useInput && zhText ? parseScriptLines(zhText, input.characters) : null;
    const parsedTh = wantTh && useInput && thText ? parseScriptLines(thText, input.characters) : null;
    const fromTemplate = !parsedZh && !parsedTh;
    const zhRows = parsedZh?.lines ?? [];
    const thRows = (parsedTh?.lines ?? []).map((l) => ({ ...l, textTh: l.textZh, textZh: '' }));
    const count = fromTemplate ? 5 : Math.min(12, Math.max(zhRows.length, thRows.length));
    const pairs = pickPairs(topic, count);

    const lines: ScriptLine[] = Array.from({ length: count }, (_, i) => {
      if (fromTemplate) {
        const pair = pairs[i];
        const scene = pickScene(`${pair.zh} ${pair.th}`, topic, input.scenes, i);
        const castId = input.characters[i % Math.max(1, input.characters.length)]?.id ?? '';
        return {
          id: `line-${i + 1}`,
          speakerId: castId,
          textZh: wantZh ? pair.zh : '',
          textTh: wantTh ? pair.th : '',
          emotion: pair.emotion,
          action: pair.action,
          sceneSuggestion: scene?.name ?? '',
        };
      }
      const a = zhRows[i];
      const b = thRows[i];
      const base = a ?? b!;
      return {
        ...base,
        id: `line-${i + 1}`,
        // 双语项目只粘了一侧时，另一侧仍用内置口语句式补齐（沿用既有能力，明确不是翻译）。
        textZh: a?.textZh ?? (wantZh && !parsedZh ? pairs[i]?.zh ?? '' : ''),
        textTh: b?.textTh ?? (wantTh && !parsedTh ? pairs[i]?.th ?? '' : ''),
        speakerId: a?.speakerId || b?.speakerId || '',
        emotion: a?.emotion ?? b?.emotion ?? '',
        action: a?.action ?? b?.action ?? '',
        sceneSuggestion: a?.sceneSuggestion || b?.sceneSuggestion || '',
        // 只记中文正文行号：前端改对白行时按它写回，泰语栏行号不一定对应。
        sourceIndex: a?.sourceIndex,
      };
    });

    const castIds = fromTemplate
      ? input.characters.slice(0, 3).map((c) => c.id)
      : [...new Set(lines.map((l) => l.speakerId).filter((id) => id && id !== NARRATION_SPEAKER))];
    const cast = castIds.map((characterId, i) => ({
      characterId,
      role: i === 0 ? '主视角' : i === 1 ? '对话搭档' : '出场人物',
    }));

    // 粘贴模式保留用户写的规范原文（含【场景】行和「人物名＋描述＋说」前缀）；
    // 主题模式才用内置句式拼正文。对白行是正文的结构化视图，不再覆盖掉原文。
    const zh = wantZh
      ? (parsedZh ? zhText : lines.map((l) => l.textZh).filter(Boolean).join('\n'))
      : '';
    const th = wantTh
      ? (parsedTh ? thText : lines.map((l) => l.textTh).filter(Boolean).join('\n'))
      : '';
    const durationEstimateSec = lines.reduce(
      (sum, l) => sum + estimateDuration(l.textZh, l.textTh), 0,
    );
    const suggested = [...new Set([
      parsedZh?.sceneName ?? '', parsedTh?.sceneName ?? '',
      ...lines.map((l) => l.sceneSuggestion),
    ].filter(Boolean))];
    return {
      title: `${topic}｜泰国日常`,
      structure: fromTemplate
        ? '开场吸引点 → 三人日常对话（起因 / 小插曲 / 收尾）→ 一句生活感受旁白'
        : '按规范剧本逐行解析：场景提示 → 对白 / 旁白逐行切镜',
      hook: fromTemplate ? `在曼谷，${topic}这样的小事，也能变成一天里最放松的时刻。` : scriptHook(lines),
      cast,
      lines,
      zh,
      th,
      // 旁白已经是对白行了，不再额外塞一条模板旁白到第一个镜头，避免重复。
      narrationZh: fromTemplate && wantZh ? '泰国的日常，就藏在这些不起眼的小瞬间里。' : '',
      narrationTh: fromTemplate && wantTh ? 'ชีวิตประจำวันของไทยอยู่ในช่วงเวลาเล็ก ๆ แบบนี้เอง' : '',
      emotion: fromTemplate
        ? '轻松、温暖、带一点轻喜剧'
        : [...new Set(lines.map((l) => l.emotion).filter(Boolean))].join('、') || '自然',
      actionSuggestion: fromTemplate
        ? '以对话和小动作为主；复杂动作（走路/骑摩托/跳舞）留给阶段二 AI 视频镜头'
        : '情绪与动作已从剧本描述自动匹配，可在下方对白行逐行下拉选择或自行填写。',
      sceneSuggestions: suggested.length ? suggested : input.scenes.slice(0, 2).map((s) => s.name),
      shotCountEstimate: lines.length,
      durationEstimateSec: Math.round(durationEstimateSec * 10) / 10,
      note: fromTemplate
        ? (language === 'bilingual' ? NOTE : `本地规则生成：项目语言类型为「${language === 'zh' ? '中文' : '泰语'}」，只生成该语种台词，另一语种留空；泰语口语句式需人工校对。`)
        : '已按项目规范拆成对白行：说话人、台词、情绪、动作都可在下方逐行修改；认不出的人名请手动选择。',
    };
  }

  async splitShots(input: { script: Script; characters: Character[]; scenes: Scene[] }): Promise<ShotDraft[]> {
    const { script, characters, scenes } = input;
    // 手写剧本框时也要按语言类型切分：泰语单语项目不能从空的 zh 栏切出 0 个镜头。
    const fallbackSource = script.zh.trim() ? 'zh' : 'th';
    const lines = script.lines.length
      ? script.lines
      : splitSentences(fallbackSource === 'zh' ? script.zh : script.th).map((text, i) => ({
          id: `line-${i + 1}`,
          speakerId: characters[i % Math.max(1, characters.length)]?.id ?? '',
          textZh: fallbackSource === 'zh' ? text : '',
          textTh: fallbackSource === 'th' ? text : '',
          emotion: '自然', action: '', sceneSuggestion: '',
        }));
    const sizes = ['中景', '近景', '过肩中景', '特写', '广角'];
    const angles = ['平视', '平视', '略俯', '平视', '低机位'];

    return lines.map((line, i) => {
      const scene = pickScene(`${line.textZh} ${line.textTh} ${line.sceneSuggestion}`, script.topic, scenes, i);
      // 旁白行不指向具体人物：画面是场景空镜 + 旁白字幕，名字牌由渲染层显示「旁白」。
      const isNarration = line.speakerId === NARRATION_SPEAKER;
      const speaker = isNarration ? '' : (line.speakerId || characters[i % Math.max(1, characters.length)]?.id || '');
      const partner = characters[(i + 1) % Math.max(1, characters.length)]?.id;
      const characterIds = isNarration
        ? []
        : [speaker, ...(i % 3 === 2 && partner && partner !== speaker ? [partner] : [])].filter(Boolean);
      return {
        sceneId: scene?.id ?? '',
        characterIds,
        action: isNarration ? '' : (line.action || '自然对话'),
        expression: line.emotion || '自然',
        shotSize: sizes[i % sizes.length],
        cameraAngle: angles[i % angles.length],
        cameraMove: i % 4 === 3 ? '缓慢推近' : '固定',
        dialogueZh: line.textZh,
        dialogueTh: line.textTh,
        narrationZh: i === 0 ? script.narrationZh : '',
        narrationTh: i === 0 ? script.narrationTh : '',
        subtitleZh: line.textZh,
        subtitleTh: line.textTh,
        durationSec: estimateDuration(line.textZh, line.textTh),
      } satisfies ShotDraft;
    });
  }
}

/** 粘贴模式下用第一句台词做开场提示，不再凭主题编一句跟剧情无关的话。 */
const scriptHook = (lines: ScriptLine[]): string =>
  lines.find((l) => l.textZh || l.textTh)?.textZh || lines.find((l) => l.textTh)?.textTh || '';
