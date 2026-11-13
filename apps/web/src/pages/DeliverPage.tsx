import React, { useState } from 'react';
import { useWorkbench } from '../store';
import { PreviewPage } from './PreviewPage';
import { ExportPage } from './ExportPage';
import { TasksPage } from './TasksPage';

/**
 * 出片页：预览 → 导出 → 任务记录，一页三段。
 * 预览与导出同时可见（等渲染时最想看的进度和成片就在眼前）；
 * 任务记录默认折叠，只有展开时才轮询，不折叠着一直打接口。
 */
export const DeliverPage: React.FC = () => {
  const bundle = useWorkbench((s) => s.bundle);
  const setPage = useWorkbench((s) => s.setPage);
  const setWorkSection = useWorkbench((s) => s.setWorkSection);
  const tasks = useWorkbench((s) => s.tasks);
  const renderResult = useWorkbench((s) => s.renderResult);
  const renderTask = useWorkbench((s) => s.renderTask);
  const [tasksOpen, setTasksOpen] = useState(false);

  if (!bundle) return null;

  const rendering = Boolean(renderTask && !['completed', 'failed', 'cancelled'].includes(renderTask.status));
  const runningTasks = tasks.filter((t) => ['pending', 'analyzing', 'generating', 'processing'].includes(t.status)).length;

  return (
    <div>
      <div className="sticky top-0 z-20 -mx-5 mb-4 border-b border-stone-200 bg-[#f5f2ec]/95 px-5 py-2 backdrop-blur">
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

      <section id="sec-preview" className="mb-4 scroll-mt-24 rounded-xl border border-stone-200 bg-white p-4 shadow-card">
        <p className="mb-2 text-xs font-semibold text-stone-500">1 · 成片预览（版面，不是 MP4）</p>
        <PreviewPage embedded />
      </section>

      <section id="sec-export" className="mb-4 scroll-mt-24 rounded-xl border border-stone-200 bg-white p-4 shadow-card">
        <p className="mb-2 text-xs font-semibold text-stone-500">2 · 导出 MP4</p>
        <ExportPage embedded />
      </section>

      <section id="sec-tasks" className="mb-4 scroll-mt-24 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-card">
        <header className="flex flex-wrap items-center gap-2 px-4 py-2.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-300 text-[11px] font-semibold text-white">3</span>
          <span className="text-sm font-semibold text-ink">任务记录</span>
          <span className="text-[11px] text-stone-500">
            {tasks.length ? `${tasks.length} 条 · 失败原因和重试都在这里` : '还没有任务'}
          </span>
          <div className="ml-auto">
            <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => setTasksOpen((v) => !v)}>
              {tasksOpen ? '收起' : '展开'}
            </button>
          </div>
        </header>
        {tasksOpen && (
          <div className="border-t border-stone-100 p-4">
            <TasksPage embedded active={tasksOpen} />
          </div>
        )}
      </section>
    </div>
  );
};
