import React, { useEffect, useRef, useState } from 'react';
import { hasPendingSaves, useWorkbench } from './store';
import type { Page } from './store';
import { Banner, Empty } from './ui';
import { HelpModal, StepGuide, STEPS } from './guide';
import { LANGUAGE_LABELS, LANGUAGE_OPTIONS } from './language';
import { ProjectsPage } from './pages/ProjectsPage';
import { WorkPage } from './pages/WorkPage';
import { DeliverPage } from './pages/DeliverPage';

/** 三个菜单就是三段工序；项目库不是步骤，所以不带序号。 */
const NAV: { page: Page; label: string; icon: string; needsProject: boolean }[] = [
  { page: 'projects', label: '项目库', icon: '▦', needsProject: false },
  { page: 'work', label: '制作', icon: '✎', needsProject: true },
  { page: 'deliver', label: '出片', icon: '▶', needsProject: true },
];

const SIDEBAR_KEY = 'thai-video.sidebar.collapsed.v1';

const readCollapsed = (): boolean => {
  try { return window.localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { return false; }
};

/** 顶部常驻的语言类型开关：改一次，剧本框 / 台词 / 字幕 / 配音 / 成片版本一起变。 */
const LanguageSelect: React.FC = () => {
  const bundle = useWorkbench((s) => s.bundle);
  const setLanguageMode = useWorkbench((s) => s.setLanguageMode);
  if (!bundle) return null;
  return (
    <label className="flex items-center gap-1.5 text-xs text-stone-500">
      语言类型
      <select
        className="input w-auto py-1 text-xs"
        value={bundle.meta.exportMode}
        title="决定剧本编辑框、台词、字幕、配音语种与最终成片版本"
        onChange={(e) => void setLanguageMode(e.target.value as typeof bundle.meta.exportMode)}
      >
        {LANGUAGE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
};

export const App: React.FC = () => {
  const page = useWorkbench((s) => s.page);
  const setPage = useWorkbench((s) => s.setPage);
  const bootstrap = useWorkbench((s) => s.bootstrap);
  const projects = useWorkbench((s) => s.projects);
  const currentId = useWorkbench((s) => s.currentId);
  const bundle = useWorkbench((s) => s.bundle);
  const openProject = useWorkbench((s) => s.openProject);
  const busy = useWorkbench((s) => s.busy);
  const saving = useWorkbench((s) => s.saving);
  const error = useWorkbench((s) => s.error);
  const notice = useWorkbench((s) => s.notice);
  const clearMessages = useWorkbench((s) => s.clearMessages);
  const [helpOpen, setHelpOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 换菜单时回到内容顶部，否则会带着上一页的滚动位置，看起来像「跳到了中间」。
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [page]);

  useEffect(() => { void bootstrap(); }, [bootstrap]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(clearMessages, 4000);
    return () => clearTimeout(timer);
  }, [notice, clearMessages]);

  // 还有没落盘的改动时，关页/刷新先补发一次，并让浏览器弹原生确认。
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!hasPendingSaves()) return;
      useWorkbench.getState().flushNow();
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const toggleSidebar = (): void => {
    const next = !collapsed;
    setCollapsed(next);
    try { window.localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0'); } catch { /* 无痕模式忽略 */ }
  };

  const activeStep = STEPS.findIndex((s) => s.page === page) + 1;
  const anySaving = Object.values(saving).some(Boolean);

  const renderPage = (): React.ReactNode => {
    if (page === 'projects') return <ProjectsPage />;
    if (!bundle) return (
      <Empty
        title="还没有打开项目"
        hint="到「项目库」新建或打开一个项目，人物、场景、剧本、分镜都在「制作」一页里。"
        action={<button className="btn btn-primary mt-2" onClick={() => setPage('projects')}>去项目库</button>}
      />
    );
    return page === 'work' ? <WorkPage /> : <DeliverPage />;
  };

  return (
    <div className="flex h-full min-w-0">
      <aside
        className={`flex shrink-0 flex-col border-r border-stone-200 bg-[#1f302e] text-stone-200 transition-[width] duration-150 ${
          collapsed ? 'w-14' : 'w-56'
        }`}
      >
        <div className={`flex border-b border-white/10 ${collapsed ? 'flex-col items-center gap-2 px-1.5 py-3' : 'items-start justify-between px-4 py-5'}`}>
          {collapsed ? (
            <span className="flex h-7 w-7 items-center justify-center rounded bg-white/10 text-xs font-semibold">泰</span>
          ) : (
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-wide">泰国本地生活</p>
              <p className="mt-1 text-[11px] text-stone-400">AI 双语短视频工作台 · V1.0</p>
            </div>
          )}
          <button
            onClick={toggleSidebar}
            title={collapsed ? '展开菜单' : '折叠菜单'}
            aria-label={collapsed ? '展开菜单' : '折叠菜单'}
            className={`shrink-0 rounded border border-white/20 text-stone-300 hover:bg-white/10 ${
              collapsed ? 'px-1 py-0.5 text-[11px]' : 'px-1.5 py-0.5 text-xs'
            }`}
          >
            {collapsed ? '››' : '‹‹'}
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-auto px-2 py-3">
          {NAV.map((item) => {
            const disabled = item.needsProject && !bundle;
            const active = page === item.page;
            return (
              <button
                key={item.page}
                disabled={disabled}
                onClick={() => setPage(item.page)}
                title={collapsed ? item.label : undefined}
                className={`flex w-full items-center rounded-md text-sm transition-colors ${
                  collapsed ? 'justify-center px-0 py-2.5' : 'gap-2 px-3 py-2'
                } ${active ? 'bg-warm text-white' : 'text-stone-300 hover:bg-white/10'} ${
                  disabled ? 'cursor-not-allowed opacity-35' : ''
                }`}
              >
                <span className="w-4 shrink-0 text-center text-xs">{item.icon}</span>
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className={`border-t border-white/10 ${collapsed ? 'px-1.5 py-2' : 'px-3 py-3'}`}>
          <button
            onClick={() => setHelpOpen(true)}
            title="完整使用帮助"
            className={`w-full rounded-md border border-white/20 text-xs text-stone-200 hover:bg-white/10 ${
              collapsed ? 'py-2 text-center' : 'mb-2 px-3 py-2 text-left'
            }`}
          >
            {collapsed ? '?' : `？ 完整使用帮助（${activeStep}/3 步）`}
          </button>
          {!collapsed && (
            <p className="text-[11px] leading-5 text-stone-400">
              基础工作台 + MP4 导出已启用<br />
              画面 / 配音可换 AI Provider
            </p>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-stone-200 bg-white px-5 py-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="text-xs text-stone-500">当前项目</span>
            <select
              className="input max-w-xs py-1 text-xs"
              value={currentId ?? ''}
              onChange={(e) => {
                if (!e.target.value) return;
                void openProject(e.target.value);
                if (page === 'projects') setPage('work');
              }}
            >
              <option value="">（未选择）</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {bundle && (
              <>
                <span className="chip bg-orange-50 text-orange-700">{LANGUAGE_LABELS[bundle.meta.exportMode]}</span>
                <span className="text-xs text-stone-400">{bundle.shots.length} 个镜头 · {bundle.characters.length} 个人物</span>
              </>
            )}
          </div>
          <LanguageSelect />
          {busy && <span className="chip bg-amber-50 text-amber-700">处理中…</span>}
          <span className={`chip ${anySaving ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
            {anySaving ? '保存中…' : '已自动保存'}
          </span>
          <button className="btn btn-ghost py-1 text-xs" onClick={() => setHelpOpen(true)}>使用帮助</button>
        </header>

        {(error || notice) && (
          <div className="shrink-0 px-5 pt-3">
            {error && <Banner tone="error" action={<button className="underline" onClick={clearMessages}>关闭</button>}>{error}</Banner>}
            {notice && <Banner tone="info">{notice}</Banner>}
          </div>
        )}

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-5">
          <StepGuide page={page} />
          {renderPage()}
        </div>
      </main>
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
};
