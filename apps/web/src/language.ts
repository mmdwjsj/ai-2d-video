import { showsTh as coreShowsTh, showsZh as coreShowsZh } from '@thai-video/core/types';
import type { LanguageMode } from '@thai-video/core/types';

export type { LanguageMode };

export const LANGUAGE_LABELS: Record<LanguageMode, string> = {
  zh: '中文',
  th: '泰语',
  bilingual: '双语（中＋泰）',
};

export const LANGUAGE_OPTIONS: { value: LanguageMode; label: string; desc: string }[] = [
  { value: 'zh', label: '中文', desc: '只出现中文剧本框，只做中文配音 / 字幕 / 中文版 MP4' },
  { value: 'th', label: '泰语', desc: '只出现泰语剧本框，只做泰语配音 / 字幕 / 泰语版 MP4' },
  { value: 'bilingual', label: '双语（中＋泰）', desc: '中泰双栏都出现，导出双语版（泰语对白＋中文旁白/字幕）' },
];

export const showsZh = (mode: LanguageMode): boolean => coreShowsZh(mode);
export const showsTh = (mode: LanguageMode): boolean => coreShowsTh(mode);

export const languageNotice = (mode: LanguageMode): string =>
  `已切换为「${LANGUAGE_LABELS[mode]}」：剧本框、台词、字幕、配音与成片都只用该语种；另一种语言已写的内容仍保留在文件里，不会被删除。`;

export const SCRIPT_RULES: { title: string; detail: string }[] = [
  { title: '一行一句', detail: '每行只写一个人说的一句话，不要把整段小说粘进来。' },
  { title: '对白格式', detail: '人物名＋表情/动作＋说：“台词”。例：妮娜微笑地说：“你好，需要吃点什么吗？”' },
  { title: '旁白格式', detail: '旁白：一句话。用来交代场景或收尾，不指定说话人。' },
  { title: '场景格式', detail: '【场景】场景名 · 时间 · 光线。例：【场景】曼谷街边餐馆 · 傍晚 · 暖光' },
  { title: '人物要对得上', detail: '名字必须是「制作 · 人物」段里那三个人物的名字，系统才好分配参考图与声音。' },
  { title: '台词别太长', detail: '一句 ≤ 25 字（泰语 ≤ 35 字符），9:16 竖屏字幕才不会挤成三行。' },
  { title: '结构完整', detail: '开头吸引点 → 2～4 轮对话 → 一句生活感受收尾，约 5～8 行。' },
  { title: '泰语要口语', detail: '写泰国人日常真会说的句子，不要把中文逐字硬译。' },
];

export const SCRIPT_MISTAKES = [
  '整段散文 / 小说，没有分行',
  '只写台词不写人物名，系统不知道谁在说',
  '一句话三四十个字，字幕放不下',
  '中文项目里混进泰语句子（或反过来）',
  '泰语用书面语、逐字翻译腔',
];

type ExampleCharacter = { name: string; nameTh?: string };

/** 按项目里真实的人物名生成规范示例，用户点「填入示例」即可直接改。 */
export const buildScriptExample = (
  characters: ExampleCharacter[],
  lang: 'zh' | 'th',
): string => {
  const fallbackZh = ['妮娜', '阿顿', '颂猜叔'];
  const fallbackTh = ['นีน่า', 'อาร์ต', 'ลุงสงชัย'];
  const name = (i: number): string =>
    lang === 'zh'
      ? (characters[i]?.name || fallbackZh[i])
      : (characters[i]?.nameTh || characters[i]?.name || fallbackTh[i]);
  const [a, b, c] = [name(0), name(1), name(2)];
  if (lang === 'th') {
    return [
      'ฉาก: ร้านอาหารข้างถนนกรุงเทพฯ · เย็น · แสงอุ่น',
      'บรรยาย: เลิกงานแล้ว ตลาดเพิ่งเริ่มคึกคัก',
      `${a}ยิ้มแล้วถามว่า “สวัสดีค่ะ จะรับอะไรดีคะ”`,
      `${b}ถามอย่างสงสัยว่า “วันนี้ยังมีต้มยำไหมครับ”`,
      `${c}ตอบอย่างอารมณ์ดีว่า “เพิ่งต้มเสร็จเลย นั่งก่อนลูก”`,
      `${a}บอกอย่างดีใจว่า “งั้นเอาสองที่นะคะ ใส่กะทิเพิ่มหน่อย”`,
      'บรรยาย: ซุปชามร้อน ๆ คือวิธีปิดวันที่ดีที่สุด',
    ].join('\n');
  }
  return [
    '【场景】曼谷街边餐馆 · 傍晚 · 暖光',
    '旁白：下班后的曼谷，最热闹的时候才刚开始。',
    `${a}微笑地说：“你好，需要吃点什么吗？”`,
    `${b}好奇地说：“今天还有冬阴功吗？”`,
    `${c}热情地说：“刚煮好，坐吧！”`,
    `${a}开心地说：“那来两份，多加椰奶。”`,
    '旁白：一碗热汤，就是一天的收尾。',
  ].join('\n');
};
