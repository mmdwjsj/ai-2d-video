import React, { useEffect, useRef, useState } from 'react';
import { useWorkbench } from '../store';
import type { SaveLabel, WorkSection } from '../store';
import { sectionScrollStyle, stickyHeaderStyle, useStickyStack } from '../stickyStack';
import { CharactersPage } from './CharactersPage';
import { ScenesPage } from './ScenesPage';
import { ScriptPage } from './ScriptPage';
import { StoryboardPage } from './StoryboardPage';

const SECTIONS: { key: WorkSection; no: number; title: string }[] = [
  { key: 'characters', no: 1, title: '人物' },
  { key: 'scenes', no: 2, title: '场景' },
  { key: 'script', no: 3, title: '剧本' },
  { key: 'storyboard', no: 4, title: '分镜' },
];
// 模块级常量：hook 的滚动监听不该因为 render 时新建数组而反复重绑。
const SECTION_KEYS: WorkSection[] = SECTIONS.map((s) => s.key);

const OPEN_KEY = 'thai-video.work.open.v2';
const ALL_CLOSED: Record<WorkSection, boolean> = {
  characters: false, scenes: false, script: false, storyboard: false,
};

const readOpen = (): Record<WorkSection, boolean> | null => {
  try {
    const raw = window.localStorage.getItem(OPEN_KEY);
    if (!raw) return null;
    return { ...ALL_CLOSED, ...(JSON.parse(raw) as Partial<Record<WorkSection, boolean>>) };
  } catch { return null; }
};

/** 段头右侧的落盘状态：改了显示「保存中…」，落盘后回显时间。 */
const SaveHint: React.FC<{ label: SaveLabel }> = ({ label }) => {
  const saving = useWorkbench((s) => s.saving[label]);
  const at = useWorkbench((s) => s.savedAt[label]);
  if (saving) return <span className="text-[11px] text-amber-600">保存中…</span>;
  if (at) return <span className="text-[11px] text-emerald-600">已保存 {at}</span>;
  return <span className="text-[11px] text-stone-400">自动保存</span>;
};

/**
 * 制作页：人物 / 场景 / 剧本 / 分镜一页四段，靠折叠与锚点控制长度，不换页。
 * 每段内容仍是原来的页面组件（embedded 模式只去掉大标题），避免逻辑重复。
 */
export const WorkPage: React.FC = () => {
  const bundle = useWorkbench((s) => s.bundle);
  const workSection = useWorkbench((s) => s.workSection);
  const focusSeq = useWorkbench((s) => s.focusSeq);
  const setWorkSection = useWorkbench((s) => s.setWorkSection);
  const submitAll = useWorkbench((s) => s.submitAll);
  const flushNow = useWorkbench((s) => s.flushNow);
  const busy = useWorkbench((s) => s.busy);

  const [open, setOpen] = useState<Record<WorkSection, boolean>>(
    () => readOpen() ?? { ...ALL_CLOSED, [workSection]: true },
  );
  const mounted = useRef(false);
  const { rootRef, barRef, current, lockTo, refresh } = useStickyStack<WorkSection>({ keys: SECTION_KEYS });

  useEffect(() => {
    try { window.localStorage.setItem(OPEN_KEY, JSON.stringify(open)); } catch { /* 无痕模式忽略 */ }
  }, [open]);

  // 展开 / 收起会改变段高，当前段判定要跟着重算一次。
  useEffect(() => { refresh(); }, [open, refresh]);

  // 跨页跳转（新建项目、提交分镜、项目库打开、点锚点）时展开目标段并滚过去。
  // 刚进页面这一下只展开、不滚动，免得把顶部引导卡片顶到吸顶条下面。
  useEffect(() => {
    if (!focusSeq) { mounted.current = true; return; }
    setOpen((prev) => ({ ...prev, [workSection]: true }));
    if (!mounted.current) { mounted.current = true; return; }
    const timer = window.setTimeout(() => {
      document.getElementById(`sec-${workSection}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [focusSeq, workSection]);

  if (!bundle) return null;

  const charOk = bundle.characters.length > 0 && bundle.characters.every((c) => c.name.trim());
  const sceneOk = bundle.scenes.length > 0;
  const scriptOk = Boolean(bundle.script.zh.trim() || bundle.script.th.trim());
  const shotOk = bundle.shots.length > 0;
  const doneCount = [charOk, sceneOk, scriptOk, shotOk].filter(Boolean).length;
  const shotSec = bundle.shots.reduce((sum, s) => sum + s.durationSec, 0);

  const summaryOf = (key: WorkSection): string => {
    if (key === 'characters') return `${bundle.characters.length} 个人物`;
    if (key === 'scenes') return `${bundle.scenes.length} 个场景`;
    if (key === 'script') {
      return scriptOk
        ? `预计 ${bundle.script.durationEstimateSec || 0}s · ${bundle.script.lines.length} 句对白`
        : '还没有内容';
    }
    return shotOk ? `${bundle.shots.length} 个镜头 · ${shotSec.toFixed(1)}s` : '提交后生成';
  };

  const doneOf = (key: WorkSection): boolean =>
    key === 'characters' ? charOk : key === 'scenes' ? sceneOk : key === 'script' ? scriptOk : shotOk;

  const toggle = (key: WorkSection): void => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const bodyOf = (key: WorkSection): React.ReactNode => {
    if (key === 'characters') return <CharactersPage embedded />;
    if (key === 'scenes') return <ScenesPage embedded />;
    if (key === 'script') return <ScriptPage embedded />;
    if (!shotOk) {
      return (
        <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50/60 px-4 py-8 text-center">
          <p className="text-sm font-medium text-stone-700">还没有分镜</p>
          <p className="mt-1 text-[11px] leading-5 text-stone-500">
            前 3 段填完，点上方「提交并自动分镜」，这里会按台词逐句生成镜头，再逐镜头审核。
          </p>
          <button className="btn btn-primary mt-3 py-1 text-xs" disabled={busy} onClick={() => void submitAll()}>
            提交并自动分镜
          </button>
        </div>
      );
    }
    // 分镜是左右两栏：只在段内横向滚动，整页不横滚。
    return (
      <div className="scroll-thin overflow-x-auto pb-1">
        <div className="min-w-[900px]">
          <StoryboardPage embedded />
        </div>
      </div>
    );
  };

  return (
    <div ref={rootRef} className="sticky-stack">
      {/* 第一层吸顶：项目名 + 进度 + 提交 + 段导航，滚到哪儿都能点到 */}
      <div ref={barRef} className="sticky top-0 z-20 -mx-5 mb-4 border-b border-stone-200 bg-[#f5f2ec]/95 px-5 pb-2 pt-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <span className="max-w-[45%] truncate text-sm font-semibold text-ink">{bundle.meta.name}</span>
          <span className={`chip ${doneCount === 4 ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-200/70 text-stone-600'}`}>
            {doneCount}/4 段已填
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn btn-ghost py-1 text-xs" onClick={flushNow}>立即保存</button>
            <button
              className="btn btn-primary py-1 text-xs"
              disabled={busy}
              onClick={() => {
                // 已经有分镜时再提交会按剧本重切，先确认一句，别把手工改的镜头覆盖掉。
                if (shotOk && !window.confirm('重新生成分镜会按剧本台词重切镜头，第 4 段的手工修改会被覆盖。继续吗？')) return;
                void submitAll();
              }}
            >
              {shotOk ? '重新生成分镜' : '提交并自动分镜'}
            </button>
          </div>
        </div>
        {/* 高亮表示「当前滚到哪一段」，浅橙表示「已展开但不是当前段」：两个状态分开，别让用户看矛盾信息 */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SECTIONS.map((section) => {
            const isCurrent = current === section.key;
            const isOpen = open[section.key];
            const done = doneOf(section.key);
            return (
              <button
                key={section.key}
                onClick={() => { setWorkSection(section.key); lockTo(section.key); }}
                title={`跳到第 ${section.no} 段`}
                aria-current={isCurrent ? 'location' : undefined}
                className={`chip border transition-colors ${
                  isCurrent ? 'border-warm bg-warm text-white'
                    : isOpen ? 'border-orange-300 bg-orange-50 text-warm hover:border-warm'
                      : 'border-stone-300 bg-white text-stone-600 hover:border-warm/60'
                }`}
              >
                {done ? '✓' : section.no} {section.title}
                <span className="ml-1 text-[10px] opacity-70">{summaryOf(section.key)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {SECTIONS.map((section) => {
        const isOpen = open[section.key];
        const isCurrent = current === section.key;
        return (
          // 不能用 overflow-hidden：它会把内部 sticky 困死在这里，段头就永远吸不住外层滚动容器。
          <section
            key={section.key}
            id={`sec-${section.key}`}
            style={sectionScrollStyle}
            className="mb-4 rounded-xl border border-stone-200 bg-white shadow-card"
          >
            {/* 第二层吸顶：只在自己这一段里粘住，z-10 低于顶部条 z-20；滚到下一会被下一段段头自然顶走 */}
            <header
              style={stickyHeaderStyle}
              className={`frozen-head sticky z-10 flex flex-wrap items-center gap-2 px-4 py-2.5 transition-colors ${
                isCurrent ? 'bg-[#fffcf7]' : 'bg-white'
              } ${isOpen ? 'rounded-t-xl border-b border-stone-100' : 'rounded-xl'}`}
            >
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${
                doneOf(section.key) ? 'bg-emerald-500' : 'bg-warm'
              } ${isCurrent ? 'ring-2 ring-orange-200' : ''}`}>
                {section.no}
              </span>
              <span className="text-sm font-semibold text-ink">{section.title}</span>
              <span className="text-[11px] text-stone-500">{summaryOf(section.key)}</span>
              {isCurrent && (
                <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-warm">正在看</span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <SaveHint label={section.key} />
                <button className="text-[11px] text-stone-500 underline hover:text-warm" onClick={flushNow}>立即保存</button>
                <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => toggle(section.key)}>
                  {isOpen ? '收起' : '展开'}
                </button>
              </div>
            </header>
            {isOpen && <div className="rounded-b-xl p-4">{bodyOf(section.key)}</div>}
          </section>
        );
      })}
    </div>
  );
};
