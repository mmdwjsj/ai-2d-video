import React, { useEffect, useState } from 'react';
import { useWorkbench } from '../store';
import { PreviewPage } from './PreviewPage';
import { ExportPage } from './ExportPage';
import { TasksPage } from './TasksPage';
import {
  sectionScrollStyle, stickyHeaderStyle, useStickyStack,
} from '../stickyStack';

const DELIVER_KEYS = ['preview', 'export', 'tasks'] as const;
type DeliverSection = typeof DELIVER_KEYS[number];

const TITLES: Record<DeliverSection, string> = {
  preview: '成片预览', export: '导出 MP4', tasks: '任务记录',
};

/** 三段共用的冻结段头；alone 表示这一段当前收起、只剩段头自己。 */
const FrozenHead: React.FC<{
  no: number; section: DeliverSection; hint?: string; current: boolean; alone?: boolean;
  children?: React.ReactNode;
}> = ({ no, section, hint, current, alone = false, children }) => (
  <header
    style={stickyHeaderStyle}
    className={`frozen-head sticky z-10 flex flex-wrap items-center gap-2 px-4 py-2.5 transition-colors ${
      current ? 'bg-[#fffcf7]' : 'bg-white'
    } ${alone ? 'rounded-xl' : 'rounded-t-xl border-b border-stone-100'}`}
  >
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${
      current ? 'bg-warm ring-2 ring-orange-200' : 'bg-stone-300'
    }`}>
      {no}
    </span>
    <span className="text-sm font-semibold text-ink">{TITLES[section]}</span>
    {hint && <span className="text-[11px] text-stone-500">{hint}</span>}
    {current && <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-warm">正在看</span>}
    {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
  </header>
);

/**
 * 出片页：预览 → 导出 → 任务记录，一页三段。
 * 预览与导出同时可见（等渲染时最想看的进度和成片就在眼前）；
 * 任务记录默认折叠，只有展开时才轮询，不折叠着一直打接口。
 * 段头与制作页共用同一套冻结逻辑，两个页面的滚动行为保持一致。
 */
export const DeliverPage: React.FC = () => {
  const bundle = useWorkbench((s) => s.bundle);
  const setPage = useWorkbench((s) => s.setPage);
  const setWorkSection = useWorkbench((s) => s.setWorkSection);
  const tasks = useWorkbench((s) => s.tasks);
  const renderResult = useWorkbench((s) => s.renderResult);
  const renderTask = useWorkbench((s) => s.renderTask);
  const [tasksOpen, setTasksOpen] = useState(false);
  const { rootRef, barRef, current, refresh } = useStickyStack<DeliverSection>({ keys: DELIVER_KEYS });

  // 展开任务记录会突然撑高页面，当前段判定要跟着重算。
  useEffect(() => { refresh(); }, [tasksOpen, refresh]);

  if (!bundle) return null;

  const rendering = Boolean(renderTask && !['completed', 'failed', 'cancelled'].includes(renderTask.status));
  const runningTasks = tasks.filter((t) => ['pending', 'analyzing', 'generating', 'processing'].includes(t.status)).length;

  return (
    <div ref={rootRef} className="sticky-stack">
      <div ref={barRef} className="sticky top-0 z-20 -mx-5 mb-4 border-b border-stone-200 bg-[#f5f2ec]/95 px-5 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <span className="max-w-[45%] truncate text-sm font-semibold text-ink">{bundle.meta.name}</span>
          <span className="chip bg-stone-200/70 text-stone-600">{bundle.shots.length} 个镜头</span>
          {rendering && <span className="chip bg-amber-50 text-amber-700">渲染中 {renderTask?.progress ?? 0}%</span>}
          {!rendering && renderResult && <span className="chip bg-emerald-50 text-emerald-700">已出成片</span>}
          {runningTasks > 0 && <span className="chip bg-sky-50 text-sky-700">{runningTasks} 个任务进行中</span>}
          <div className="ml-auto flex items-center gap-2">
            <button
              className="btn btn-ghost py-1 text-xs"
              onClick={() => { setPage('work'); setWorkSection('storyboard'); }}
            >
              ← 回制作改分镜
            </button>
          </div>
        </div>
      </div>

      <section id="sec-preview" style={sectionScrollStyle} className="mb-4 rounded-xl border border-stone-200 bg-white shadow-card">
        <FrozenHead no={1} section="preview" hint="版面，不是 MP4" current={current === 'preview'} />
        <div className="rounded-b-xl p-4"><PreviewPage embedded /></div>
      </section>

      <section id="sec-export" style={sectionScrollStyle} className="mb-4 rounded-xl border border-stone-200 bg-white shadow-card">
        <FrozenHead no={2} section="export" hint="本地合成竖屏 MP4" current={current === 'export'} />
        <div className="rounded-b-xl p-4"><ExportPage embedded /></div>
      </section>

      <section id="sec-tasks" style={sectionScrollStyle} className="mb-4 rounded-xl border border-stone-200 bg-white shadow-card">
        <FrozenHead
          no={3}
          section="tasks"
          hint={tasks.length ? `${tasks.length} 条 · 失败原因和重试都在这里` : '还没有任务'}
          current={current === 'tasks'}
          alone={!tasksOpen}
        >
          <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => setTasksOpen((v) => !v)}>
            {tasksOpen ? '收起' : '展开'}
          </button>
        </FrozenHead>
        {tasksOpen && (
          <div className="rounded-b-xl p-4"><TasksPage embedded active={tasksOpen} /></div>
        )}
      </section>
    </div>
  );
};
