import React, { useState } from 'react';
import { useWorkbench } from '../store';
import type { LanguageMode } from '../language';
import { LANGUAGE_LABELS, LANGUAGE_OPTIONS } from '../language';
import { Badge, Banner, Card, Empty, Field, SectionTitle } from '../ui';

export const ProjectsPage: React.FC = () => {
  const projects = useWorkbench((s) => s.projects);
  const createProject = useWorkbench((s) => s.createProject);
  const openProjectAt = useWorkbench((s) => s.openProjectAt);
  const duplicateProject = useWorkbench((s) => s.duplicateProject);
  const deleteProject = useWorkbench((s) => s.deleteProject);
  const currentId = useWorkbench((s) => s.currentId);
  const busy = useWorkbench((s) => s.busy);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [languageMode, setLanguageMode] = useState<LanguageMode>('zh');

  const submit = async () => {
    if (!name.trim()) return;
    await createProject(name.trim(), description.trim(), languageMode);
    setName(''); setDescription('');
  };

  const sample = projects.find((p) => p.name.includes('示例'));

  return (
    <div>
      <SectionTitle
        title="项目库"
        hint="一个项目 = 一个视频：人物、场景、剧本、分镜都单独保存。先选语言类型，建好后直接进「制作」。"
        right={<Badge tone="green">{projects.length} 个项目</Badge>}
      />

      <Card className="mb-4 border-amber-200 bg-amber-50/50">
        <p className="text-sm font-semibold text-ink">第一次用？从这里开始，不用从空白摸索</p>
        <div className="mt-2 grid gap-2 text-xs leading-5 text-stone-700 sm:grid-cols-2">
          <p>① 下面填项目名、选「语言类型」→ 点「新建项目」</p>
          <p>② 进「制作」：人物 → 场景 → 剧本 → 分镜，一页四段从上往下填</p>
          <p>③ 不会写剧本：第 3 段有「剧本规范」和一键示例</p>
          <p>④ 成片在「出片 → 导出 MP4」</p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {sample ? (
            <button className="btn btn-primary py-1 text-xs" onClick={() => void openProjectAt(sample.id)}>
              打开示例项目，直接照着看 →
            </button>
          ) : (
            <span className="text-[11px] text-stone-500">还没有示例项目，在项目根目录跑 <code className="rounded bg-white px-1">npm run example</code> 会自动造一个完整示例。</span>
          )}
          <span className="text-[11px] text-stone-500">示例项目：下班后去夜市吃冬阴功（含中/泰剧本与 5 个分镜）</span>
        </div>
      </Card>

      <Card className="mb-5 max-w-3xl">
        <div className="grid gap-3 sm:grid-cols-[1fr_1.3fr_1fr_auto] sm:items-end">
          <Field label="项目名称" value={name} onChange={setName} placeholder="例：下班后的夜市" />
          <Field label="简介" value={description} onChange={setDescription} placeholder="一句话说明内容方向" />
          <label className="block">
            <span className="label">语言类型（决定剧本框与成片版本）</span>
            <select className="input" value={languageMode} onChange={(e) => setLanguageMode(e.target.value as LanguageMode)}>
              {LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void submit()}>
            新建项目
          </button>
        </div>
        <Banner tone="info">
          当前选择：<span className="font-semibold">{LANGUAGE_LABELS[languageMode]}</span> — {LANGUAGE_OPTIONS.find((o) => o.value === languageMode)?.desc}。新建后自动带入 3 个人物与 12 个场景，并直接进「制作」第 3 段。
        </Banner>
      </Card>

      {projects.length === 0 ? (
        <Empty title="还没有项目" hint="在上方输入名称、选好语言类型，创建第一个项目。" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <Card key={project.id} className={currentId === project.id ? 'ring-2 ring-warm/40' : ''}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{project.name}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-stone-500">{project.description || '（无简介）'}</p>
                </div>
                {currentId === project.id && <Badge tone="orange">当前</Badge>}
              </div>
              <p className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-stone-400">
                <Badge tone="blue">{LANGUAGE_LABELS[project.exportMode]}</Badge>
                创建 {new Date(project.createdAt).toLocaleString('zh-CN')}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn btn-primary py-1 text-xs" onClick={() => void openProjectAt(project.id)}>打开</button>
                <button className="btn btn-ghost py-1 text-xs" onClick={() => void duplicateProject(project.id)}>复制</button>
                <button
                  className="btn btn-danger py-1 text-xs"
                  onClick={() => { if (window.confirm(`删除项目「${project.name}」？该项目的剧本与分镜会一并移除。`)) void deleteProject(project.id); }}
                >删除</button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
