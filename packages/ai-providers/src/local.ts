/**
 * 本地规则文本 Provider（第一阶段默认）。
 *
 * 它不调用任何外部模型，也不假装会翻译：中文/泰语台词来自一组**成对的
 * 泰国日常口语句式**（不是逐字互译），输出里带 note 要求人工或阶段二模型
 * 校对。这样第一阶段无需密钥就能完整走通「主题 → 双语剧本 → 分镜」验收。
 */
import { showsTh, showsZh } from '@thai-video/core/types';
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

const splitSentences = (text: string): string[] =>
  text.split(/[。！？!?\n]+/).map((s) => s.trim()).filter(Boolean).slice(0, 12);

/**
 * 按关键词给一句话挑场景。
 *
 * 只有「真的命中关键词」才算匹配，返回 null 交给上层兜底——这样不会因为所有分数都是 0
 * 就把每个镜头都塞进 scenes[0]（以前所有镜头堆在街边餐馆的直接原因）。
 */
const matchScene = (text: string, scenes: Scene[]): Scene | null => {
  let best: Scene | null = null;
  let bestScore = 0;
  for (const scene of scenes) {
    const score = (scene.keywords ?? []).reduce((sum, key) => sum + (key && text.includes(key) ? 1 : 0), 0);
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
    const zhInput = wantZh ? splitSentences(input.textZh ?? '') : [];
    const thInput = wantTh ? splitSentences(input.textTh ?? '') : [];
    const count = Math.max(3, Math.min(6, zhInput.length || thInput.length || 5));
    const pairs = pickPairs(topic, count);
    const cast = input.characters.slice(0, 3).map((c, i) => ({
      characterId: c.id,
      role: i === 0 ? '主视角' : i === 1 ? '对话搭档' : '社区熟人',
    }));

    const lines: ScriptLine[] = pairs.map((pair, i) => {
      const useInput = (mode === 'zh' || mode === 'th' || mode === 'import');
      const zh = !wantZh ? '' : useInput && zhInput.length
        ? zhInput[i % zhInput.length] : pair.zh;
      const th = !wantTh ? '' : useInput && thInput.length
        ? thInput[i % thInput.length] : pair.th;
      const scene = pickScene(`${zh} ${th}`, topic, input.scenes, i);
      return {
        id: `line-${i + 1}`,
        speakerId: cast.length ? cast[i % cast.length].characterId : '',
        textZh: zh,
        textTh: th,
        emotion: pair.emotion,
        action: pair.action,
        sceneSuggestion: scene?.name ?? '',
      };
    });

    const zh = wantZh ? lines.map((l) => l.textZh).filter(Boolean).join('\n') : '';
    const th = wantTh ? lines.map((l) => l.textTh).filter(Boolean).join('\n') : '';
    const durationEstimateSec = lines.reduce(
      (sum, l) => sum + estimateDuration(l.textZh, l.textTh), 0,
    );
    const suggested = [...new Set(lines.map((l) => l.sceneSuggestion).filter(Boolean))];
    return {
      title: `${topic}｜泰国日常`,
      structure: '开场吸引点 → 三人日常对话（起因 / 小插曲 / 收尾）→ 一句生活感受旁白',
      hook: `在曼谷，${topic}这样的小事，也能变成一天里最放松的时刻。`,
      cast,
      lines,
      zh,
      th,
      narrationZh: wantZh ? '泰国的日常，就藏在这些不起眼的小瞬间里。' : '',
      narrationTh: wantTh ? 'ชีวิตประจำวันของไทยอยู่ในช่วงเวลาเล็ก ๆ แบบนี้เอง' : '',
      emotion: '轻松、温暖、带一点轻喜剧',
      actionSuggestion: '以对话和小动作为主；复杂动作（走路/骑摩托/跳舞）留给阶段二 AI 视频镜头',
      sceneSuggestions: suggested.length ? suggested : input.scenes.slice(0, 2).map((s) => s.name),
      shotCountEstimate: lines.length,
      durationEstimateSec: Math.round(durationEstimateSec * 10) / 10,
      note: language === 'bilingual'
        ? NOTE
        : `本地规则生成：项目语言类型为「${language === 'zh' ? '中文' : '泰语'}」，只生成该语种台词，另一语种留空；泰语口语句式需人工校对。`,
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
      const speaker = line.speakerId || characters[i % Math.max(1, characters.length)]?.id || '';
      const partner = characters[(i + 1) % Math.max(1, characters.length)]?.id;
      const characterIds = i % 3 === 2 && partner && partner !== speaker ? [speaker, partner] : [speaker];
      return {
        sceneId: scene?.id ?? '',
        characterIds: characterIds.filter(Boolean),
        action: line.action || '自然对话',
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
