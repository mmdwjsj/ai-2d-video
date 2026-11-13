import React, { useState } from 'react';
import { useWorkbench } from '../store';
import type { LanguageMode, ScriptInputMode, ScriptLine } from '@thai-video/core/types';
import {
  LANGUAGE_LABELS, SCRIPT_MISTAKES, SCRIPT_RULES,
  buildScriptExample, showsTh, showsZh,
} from '../language';
import { Banner, Badge, Card, Field, InlineBar, SectionTitle, Select, TextArea } from '../ui';

const ALL_MODES: { value: ScriptInputMode; label: string }[] = [
  { value: 'topic', label: '输入主题，由 AI 创作（最省事）' },
  { value: 'zh', label: '粘贴我写好的中文文案' },
  { value: 'th', label: '粘贴我写好的泰语文案' },
  { value: 'import', label: '导入已有剧本（中/泰分别粘贴）' },
];

export const ScriptPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const bundle = useWorkbench((s) => s.bundle)!;
  const script = bundle.script;
  const updateScript = useWorkbench((s) => s.updateScript);
  const generateScript = useWorkbench((s) => s.generateScript);
  const syncScript = useWorkbench((s) => s.syncScript);
  const dismissSync = useWorkbench((s) => s.dismissSync);
  const setLanguageMode = useWorkbench((s) => s.setLanguageMode);
  const busy = useWorkbench((s) => s.busy);

  const mode: LanguageMode = bundle.meta.exportMode;
  const wantZh = showsZh(mode);
  const wantTh = showsTh(mode);
  const both = wantZh && wantTh;

  const [inputMode, setInputMode] = useState<ScriptInputMode>('topic');
  const [topic, setTopic] = useState('下班后去夜市吃冬阴功');
  const [textZh, setTextZh] = useState('');
  const [textTh, setTextTh] = useState('');
  const [rulesOpen, setRulesOpen] = useState(true);
  const [exampleLoaded, setExampleLoaded] = useState(false);

  const availableModes = ALL_MODES.filter((item) => {
    if (item.value === 'zh') return wantZh;
    if (item.value === 'th') return wantTh;
    if (item.value === 'import') return both;
    return true;
  });
  const effectiveInputMode = availableModes.some((m) => m.value === inputMode) ? inputMode : 'topic';

  const patch = (partial: Partial<typeof script>): void => updateScript({ ...script, ...partial });

  const updateLine = (index: number, linePatch: Partial<ScriptLine>): void => {
    const lines = script.lines.map((line, i) => (i === index ? { ...line, ...linePatch } : line));
    patch({ lines });
  };

  const fillExample = (): void => {
    setExampleLoaded(true);
    setTopic('下班后去夜市吃冬阴功');
    setInputMode(both ? 'import' : wantZh ? 'zh' : 'th');
    if (wantZh) setTextZh(buildScriptExample(bundle.characters, 'zh'));
    if (wantTh) setTextTh(buildScriptExample(bundle.characters, 'th'));
  };

  const generateLabel = mode === 'zh' ? '生成中文剧本' : mode === 'th' ? '生成泰语剧本' : '生成中泰双语剧本';
  const hiddenOther = (mode === 'zh' && script.th.trim()) || (mode === 'th' && script.zh.trim());
  const exampleText = wantZh
    ? buildScriptExample(bundle.characters, 'zh')
    : buildScriptExample(bundle.characters, 'th');

  return (
    <div>
      {embedded ? (
        <InlineBar
          hint={`当前语言类型「${LANGUAGE_LABELS[mode]}」：只编辑${both ? '中、泰两栏' : LANGUAGE_LABELS[mode] + '一栏'}，配音与成片也只用这个语种。`}
          right={
            <>
              <Badge tone="orange">预计 {script.durationEstimateSec || 0}s</Badge>
              <button className="btn btn-ghost py-1 text-xs" disabled={busy} onClick={() => void setLanguageMode(both ? 'zh' : 'bilingual')}>
                {both ? '切成中文单语' : '切成双语查看'}
              </button>
            </>
          }
        />
      ) : (
        <SectionTitle
          title="剧本编辑"
          hint={`当前语言类型「${LANGUAGE_LABELS[mode]}」：只编辑${both ? '中、泰两栏' : LANGUAGE_LABELS[mode] + '一栏'}，配音与成片也只用这个语种。`}
          right={
            <>
              <Badge tone="orange">预计 {script.durationEstimateSec || 0}s</Badge>
              <button className="btn btn-ghost" disabled={busy} onClick={() => void setLanguageMode(both ? 'zh' : 'bilingual')}>
                {both ? '切成中文单语' : '切成双语查看'}
              </button>
            </>
          }
        />
      )}

      {hiddenOther && (
        <Banner tone="warn" action={
          <button className="underline" onClick={() => void setLanguageMode('bilingual')}>切换为双语查看</button>
        }>
          这个项目里还存着另一种语言的剧本内容，当前「{LANGUAGE_LABELS[mode]}」把它隐藏了。内容没有被删除，切到「双语」即可看到并继续编辑。
        </Banner>
      )}

      {/* 剧本规范：格式、要素、示例、常见错误，一键可填入 */}
      <Card className="mb-4 border-amber-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-ink">剧本规范（照这个格式写，自动分镜才切得准）</p>
            <p className="mt-0.5 text-[11px] text-stone-500">一行一句 · 谁说 + 什么表情/动作 + 说了什么</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary py-1 text-xs" onClick={fillExample}>填入规范示例</button>
            <button className="btn btn-ghost py-1 text-xs" onClick={() => setRulesOpen(!rulesOpen)}>{rulesOpen ? '收起规范' : '展开规范'}</button>
          </div>
        </div>

        <div className="mt-3 rounded-lg bg-stone-50 px-3 py-2 font-mono text-xs text-stone-700">
          妮娜微笑地说：“你好，需要吃点什么吗？”
        </div>
        <p className="mt-1 text-[11px] text-stone-500">↑ 这就是一句标准对白：人物名 + 表情动作 + 说：“台词”。</p>

        {rulesOpen && (
          <>
            <div className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-2">
              {SCRIPT_RULES.map((rule) => (
                <p key={rule.title} className="text-[11px] leading-5 text-stone-600">
                  · <span className="font-semibold text-stone-700">{rule.title}</span>：{rule.detail}
                </p>
              ))}
            </div>
            <p className="mt-3 text-xs font-semibold text-stone-700">完整示例（{wantZh ? '中文' : '泰语'}）</p>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg border border-stone-200 bg-white p-3 text-[11px] leading-6 text-stone-700">{exampleText}</pre>
            <p className="mt-2 text-[11px] leading-5 text-stone-500">
              常见错误：{SCRIPT_MISTAKES.join('；')}。
            </p>
          </>
        )}
        {exampleLoaded && (
          <Banner tone="info">
            规范示例已填入下方「{both ? '中/泰' : LANGUAGE_LABELS[mode]}文案」框。点「{generateLabel}」把它切成对白行；也可以直接改下面的剧本正文框。
          </Banner>
        )}
      </Card>

      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-[1.5fr_1.4fr_auto] md:items-end">
          <Select label="① 输入方式" value={effectiveInputMode}
            onChange={(v) => setInputMode(v as ScriptInputMode)} options={availableModes} />
          <Field label="② 主题（输入方式选主题时生效）" value={topic} onChange={setTopic}
            placeholder="例：下班后去夜市吃冬阴功" />
          <button className="btn btn-primary" disabled={busy}
            onClick={() => void generateScript({ topic, inputMode: effectiveInputMode, textZh, textTh })}>
            ③ {generateLabel}
          </button>
        </div>
        {wantZh && (effectiveInputMode === 'zh' || effectiveInputMode === 'import') && (
          <div className="mt-3">
            <TextArea label="中文文案（一行一句，按规范写）" rows={5} value={textZh} onChange={setTextZh}
              placeholder={'【场景】曼谷街边餐馆 · 傍晚 · 暖光\n妮娜微笑地说：“你好，需要吃点什么吗？”'} />
          </div>
        )}
        {wantTh && (effectiveInputMode === 'th' || effectiveInputMode === 'import') && (
          <div className="mt-3">
            <TextArea label="泰语文案（日常口语，一行一句）" rows={5} value={textTh} onChange={setTextTh}
              placeholder={'ฉาก: ร้านอาหารข้างถนน · เย็น\nนีน่ายิ้มแล้วถามว่า “สวัสดีค่ะ จะรับอะไรดีคะ”'} />
          </div>
        )}
        <p className="mt-2 text-[11px] leading-5 text-stone-500">
          点「③ {generateLabel}」会按句子切成对白行，自动分配人物、场景与时长。
          <span className="font-semibold text-stone-700">注意：生成会覆盖当前剧本正文</span>（包括你手工改过的台词），重要内容请先在「出片 · 导出」下载项目 JSON 备份。
        </p>
      </Card>

      {script.title && (
        <Card className="mb-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1 text-xs text-stone-600">
              <p><span className="font-semibold text-ink">标题：</span>{script.title}</p>
              <p><span className="font-semibold text-ink">故事结构：</span>{script.structure}</p>
              <p><span className="font-semibold text-ink">开头吸引点：</span>{script.hook}</p>
              <p><span className="font-semibold text-ink">人物分配：</span>{script.cast.map((c) => bundle.characters.find((x) => x.id === c.characterId)?.name ?? c.characterId).join('、')}</p>
            </div>
            <div className="space-y-1 text-xs text-stone-600">
              <p><span className="font-semibold text-ink">情绪：</span>{script.emotion}</p>
              <p><span className="font-semibold text-ink">动作建议：</span>{script.actionSuggestion}</p>
              <p><span className="font-semibold text-ink">场景建议：</span>{script.sceneSuggestions.join('、') || '—'}</p>
              <p><span className="font-semibold text-ink">镜头数 / 预计时长：</span>{script.shotCountEstimate} 个 / {script.durationEstimateSec}s</p>
            </div>
          </div>
          {wantTh && <Banner tone="warn">本地规则生成的泰语是常用口语句式模板（非逐字翻译），正式出片前请人工校对，或在阶段二配置文本模型重写。</Banner>}
        </Card>
      )}

      {both && script.syncPending && (
        <Banner tone="warn" action={
          <>
            <button className="underline" onClick={() => void syncScript('zh')}>用中文覆盖泰文</button>
            <button className="underline" onClick={() => void syncScript('th')}>用泰文覆盖中文</button>
            <button className="underline" onClick={() => void dismissSync()}>保持独立</button>
          </>
        }>
          检测到只修改了一种语言，另一栏保持原样。需要同步请显式选择（不会自动覆盖）。
        </Banner>
      )}

      {!script.zh.trim() && !script.th.trim() && (
        <Banner tone="info">
          还没有剧本内容：按上方 ① 选输入方式 → ② 填主题 → ③ 点生成剧本；不会写就先点「填入规范示例」。也可以直接在下面的剧本正文框里手写。
        </Banner>
      )}

      <div className={`grid gap-4 ${both ? 'lg:grid-cols-2' : ''}`}>
        {wantZh && (
          <Card>
            <p className="mb-2 text-xs font-semibold text-stone-600">中文剧本正文（改完自动保存）</p>
            <TextArea label="中文剧本" rows={9} value={script.zh}
              onChange={(v) => patch({ zh: v })}
              placeholder={'一行一句；对白写「人物名＋表情动作＋说：台词」，旁白写「旁白：……」'} />
            <div className="mt-3"><TextArea label="中文旁白" rows={2} value={script.narrationZh} onChange={(v) => patch({ narrationZh: v })} /></div>
          </Card>
        )}
        {wantTh && (
          <Card>
            <p className="mb-2 text-xs font-semibold text-stone-600">泰语剧本正文（改完自动保存）</p>
            <TextArea label="泰语剧本" rows={9} value={script.th}
              onChange={(v) => patch({ th: v })}
              placeholder={'一行一句 บทสนทนาภาษาไทย ที่เป็นภาษาพูดประจำวัน'} />
            <div className="mt-3"><TextArea label="泰语旁白" rows={2} value={script.narrationTh} onChange={(v) => patch({ narrationTh: v })} /></div>
          </Card>
        )}
      </div>

      {script.lines.length > 0 && (
        <Card className="mt-4">
          <p className="mb-3 text-sm font-semibold">对白行（{script.lines.length}）· 逐句确认说话人、台词与情绪</p>
          <div className="space-y-2">
            {script.lines.map((line, index) => (
              <div key={line.id} className={`grid gap-2 rounded-lg border border-stone-200 p-2 ${both ? 'md:grid-cols-[110px_1fr_1fr_90px]' : 'md:grid-cols-[130px_1fr_110px]'}`}>
                <Select label="说话人" value={line.speakerId}
                  onChange={(v) => updateLine(index, { speakerId: v })}
                  options={bundle.characters.map((c) => ({ value: c.id, label: c.name }))} />
                {wantZh && <Field label="中文对白" value={line.textZh} onChange={(v) => updateLine(index, { textZh: v })} />}
                {wantTh && <Field label="泰语对白" value={line.textTh} onChange={(v) => updateLine(index, { textTh: v })} />}
                <Field label="情绪 / 动作" value={line.emotion} onChange={(v) => updateLine(index, { emotion: v })} />
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-stone-500">确认无误后点页面顶部「提交并自动分镜」，系统会按这些对白行切成镜头。</p>
        </Card>
      )}
    </div>
  );
};
