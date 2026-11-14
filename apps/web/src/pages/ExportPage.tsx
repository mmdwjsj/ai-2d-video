import React, { useEffect, useState } from 'react';
import { useWorkbench } from '../store';
import type { OutputFile } from '../store';
import { LANGUAGE_LABELS, LANGUAGE_OPTIONS } from '../language';
import { Badge, Banner, Card, Field, InlineBar, Modal, SectionTitle } from '../ui';

const MODE_LABEL = { zh: '中文版', th: '泰语版', bilingual: '双语版' } as const;
const MP4_LABEL = { zh: '导出中文版 MP4', th: '导出泰语版 MP4', bilingual: '导出双语版 MP4' } as const;
const ALL_MODES = ['zh', 'th', 'bilingual'] as const;

const humanSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const stageText = (progress: number, status: string): string => {
  if (status === 'pending') return '已排队，等待后台任务接管…';
  if (progress < 24) return '准备配音与音频时长…';
  if (progress < 50) return '逐镜头绘制画面（场景、人物、双语字幕）…';
  if (progress < 80) return 'FFmpeg 拼接镜头、加入缓慢推近动效…';
  if (progress < 96) return '对齐音轨、混入氛围音…';
  return '封装 MP4（H.264 / AAC）…';
};

export const ExportPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const bundle = useWorkbench((s) => s.bundle)!;
  const config = useWorkbench((s) => s.config);
  const patchProject = useWorkbench((s) => s.patchProject);
  const setLanguageMode = useWorkbench((s) => s.setLanguageMode);
  const exportJson = useWorkbench((s) => s.exportJson);
  const outputs = useWorkbench((s) => s.outputs);
  const outputDir = useWorkbench((s) => s.outputDir);
  const refreshOutputs = useWorkbench((s) => s.refreshOutputs);
  const downloadFile = useWorkbench((s) => s.downloadFile);
  const startRender = useWorkbench((s) => s.startRender);
  const clearRender = useWorkbench((s) => s.clearRender);
  const renderTask = useWorkbench((s) => s.renderTask);
  const renderResult = useWorkbench((s) => s.renderResult);
  const renderError = useWorkbench((s) => s.renderError);
  const busy = useWorkbench((s) => s.busy);
  const [playing, setPlaying] = useState<OutputFile | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const mode = bundle.meta.exportMode;
  const exportReady = config?.capabilities.videoExport !== false;
  const rendering = Boolean(renderTask && !['completed', 'failed', 'cancelled'].includes(renderTask.status));
  const progress = renderTask?.progress ?? 0;

  useEffect(() => { void refreshOutputs(); }, [refreshOutputs]);

  const myOutputs = outputs.filter((f) => f.projectId === bundle.meta.id);
  const otherOutputs = outputs.filter((f) => f.projectId !== bundle.meta.id);
  const shown = [...myOutputs, ...otherOutputs];

  return (
    <div>
      {embedded ? (
        <InlineBar
          hint="点一次「导出 MP4」就会真实合成可播放的成片；下面能看到进度、文件位置和播放器。"
          right={<Badge tone="green">MP4 导出已启用</Badge>}
        />
      ) : (
        <SectionTitle
          title="导出页面"
          hint="点一次「导出 MP4」就会真实合成可播放的成片；下方能看到进度、文件位置和播放器。"
          right={<Badge tone="green">MP4 导出已启用</Badge>}
        />
      )}

      {!exportReady && (
        <Banner tone="error">
          本机渲染环境未就绪：{config?.capabilities.renderer?.reason ?? '缺少 Edge/Chrome 或 FFmpeg'}。装好 FFmpeg 并放到 PATH 后重启服务端即可。
        </Banner>
      )}

      <Card className="mb-4 border-amber-200 bg-amber-50/50">
        <p className="text-sm font-semibold text-ink">① 确认语言类型（默认只导出这一个版本）</p>
        <p className="mt-1 text-[11px] text-stone-600">
          中文项目只出中文剧本、中文字幕与中文版 MP4；切换不会删除另一种语言已写的内容。
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {LANGUAGE_OPTIONS.map((option) => {
            const active = mode === option.value;
            return (
              <button key={option.value} onClick={() => void setLanguageMode(option.value)}
                className={`rounded-lg border bg-white p-3 text-left ${active ? 'border-warm ring-2 ring-warm/40' : 'border-stone-200'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{option.label}</span>
                  {active && <Badge tone="orange">当前</Badge>}
                </div>
                <p className="mt-1 text-[11px] leading-5 text-stone-500">{option.desc}</p>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">② 导出 {LANGUAGE_LABELS[mode]} MP4</p>
          <Badge tone={rendering ? 'orange' : renderResult ? 'green' : 'blue'}>
            {rendering ? '渲染中' : renderResult ? '已有成片' : '可导出'}
          </Badge>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" disabled={!exportReady || rendering || busy || !bundle.shots.length}
            onClick={() => void startRender(mode)}>
            {MP4_LABEL[mode]}
          </button>
          {renderResult && <button className="btn btn-ghost" onClick={clearRender}>清空本次结果</button>}
          <span className="text-[11px] text-stone-500">
            {bundle.shots.length ? `${bundle.shots.length} 个镜头 · 含片头片尾` : '还没有分镜，先回「制作」写完剧本并提交分镜'}
          </span>
        </div>

        {rendering && renderTask && (
          <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50/60 p-3">
            <div className="flex items-center justify-between text-xs font-semibold text-orange-800">
              <span>{stageText(progress, renderTask.status)}</span><span>{progress}%</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded bg-orange-100">
              <div className="h-full rounded bg-warm transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-stone-500">
              任务 {renderTask.id} · 后台执行，可以切到别的页面，回来继续看进度；关掉程序也不会丢任务记录。
            </p>
          </div>
        )}

        {renderError && (
          <Banner tone="error" action={<button className="underline" onClick={() => void startRender(mode)}>重试</button>}>
            {renderError}
          </Banner>
        )}

        {renderResult && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
            <p className="text-sm font-semibold text-emerald-900">成片已生成 · {renderResult.name}</p>
            <p className="mt-1 text-[11px] leading-5 text-emerald-800">
              {renderResult.width}×{renderResult.height} · {renderResult.fps}fps · {renderResult.codec} ·
              {' '}{renderResult.durationSec}s · {humanSize(renderResult.sizeBytes)} · {renderResult.shotCount} 个镜头
            </p>
            <p className="mt-1 text-[11px] leading-5 text-emerald-800">配音：{renderResult.voiceOverNote}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-primary py-1 text-xs"
                onClick={() => setPlaying({
                  path: renderResult.path, url: renderResult.url, kind: 'video',
                  sizeBytes: renderResult.sizeBytes, modifiedAt: renderResult.renderedAt,
                  projectId: bundle.meta.id,
                })}>播放成片</button>
              <button className="btn btn-ghost py-1 text-xs" disabled={busy}
                onClick={() => void downloadFile(renderResult.path)}>下载 MP4</button>
            </div>
          </div>
        )}

        <p className="mt-3 text-[11px] leading-5 text-stone-500">
          本地渲染，不需要任何 AI 密钥：画面是程序化 2D 插画（场景配色 + 人物立绘），字幕来自你的分镜台词，
          镜头带缓慢推近动效，音轨是本地合成的氛围音。镜头时长按配音实测值撑开，视频不会早于配音结束。
          想换成 AI 生成的画面或真人配音，见下方「以后还能换什么」。
        </p>
      </Card>

      <Card className="mb-4">
        <button className="flex w-full items-center justify-between text-left text-sm font-semibold"
          onClick={() => setMoreOpen((v) => !v)}>
          <span>③ 需要别的语言版本？（可选）</span>
          <span className="text-[11px] font-normal text-stone-500">{moreOpen ? '收起' : '展开'}</span>
        </button>
        {moreOpen && (
          <div className="mt-3">
            <p className="text-[11px] leading-5 text-stone-500">
              主按钮只出当前语言类型那一个版本。这里可以额外导出另外两种，互不影响，成片都落在同一个 output 目录。
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {ALL_MODES.filter((m) => m !== mode).map((m) => (
                <button key={m} className="btn btn-ghost py-1 text-xs" disabled={rendering || busy || !exportReady}
                  onClick={() => void startRender(m)}>额外导出{MODE_LABEL[m]} MP4</button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* 成片在哪看：真实列出 output 目录，有 MP4 就能直接播放 */}
      <Card className="mb-4 border-sky-200">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">④ 成片文件在哪看</p>
            <p className="mt-1 text-[11px] text-stone-600">MP4 保存在这个文件夹，导出完成后自动出现在下面的列表里：</p>
            <p className="mt-1 break-all rounded bg-stone-50 px-2 py-1 font-mono text-[11px] text-stone-700">
              {outputDir ? `${outputDir}\\` : '（读取中…若一直为空，请重启服务端后刷新页面）'}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-stone-500">
              下载按钮走后端专用接口，保存的是真正的 MP4（中文原名）。若提示「下载失败」，说明后端没启动：
              推荐 <code className="rounded bg-stone-100 px-1">npm run build &amp;&amp; npm start</code> 后用
              <code className="rounded bg-stone-100 px-1">http://localhost:4173</code> 打开；
              用 5173 开发页时要另开一个终端跑 <code className="rounded bg-stone-100 px-1">npm run dev:server</code>。
            </p>
          </div>
          <button className="btn btn-ghost py-1 text-xs" onClick={() => void refreshOutputs()}>刷新文件列表</button>
        </div>

        {shown.length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed border-stone-300 bg-white p-4 text-center">
            <p className="text-xs font-medium text-stone-700">还没有成片</p>
            <p className="mt-1 text-[11px] leading-5 text-stone-500">
              回到上面第 ② 步点「导出 MP4」，等进度到 100% 就会出现在这里。
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {shown.map((file) => (
              <div key={file.path} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-ink">{file.path}</p>
                  <p className="mt-0.5 text-[11px] text-stone-400">
                    {file.kind === 'video' ? '视频' : file.kind === 'audio' ? '音频' : file.kind === 'image' ? '图片' : '文件'}
                    {' · '}{humanSize(file.sizeBytes)}{' · '}{new Date(file.modifiedAt).toLocaleString('zh-CN')}
                    {file.projectId === bundle.meta.id ? ' · 当前项目' : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  {file.kind === 'video' && (
                    <button className="btn btn-primary py-1 text-xs" onClick={() => setPlaying(file)}>播放</button>
                  )}
                  <button className="btn btn-ghost py-1 text-xs" disabled={busy}
                    onClick={() => void downloadFile(file.path)}>下载</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="mb-3 text-sm font-semibold">项目设置</p>
          <div className="space-y-2">
            <Field label="项目名称" value={bundle.meta.name} onChange={(v) => void patchProject({ name: v })} />
            <Field label="项目简介" value={bundle.meta.description} onChange={(v) => void patchProject({ description: v })} />
          </div>
        </Card>
        <Card>
          <p className="mb-3 text-sm font-semibold">项目 JSON（备份 / 迁移）</p>
          <p className="mb-3 text-xs leading-5 text-stone-500">
            包含人物、场景、剧本、分镜与任务历史。它是纯数据备份，不含 MP4；成片本体在 output 目录里。
          </p>
          <button className="btn btn-ghost" disabled={busy} onClick={() => void exportJson()}>下载项目 JSON</button>
        </Card>
      </div>

      <Card className="mt-4">
        <p className="mb-2 text-sm font-semibold">以后还能换什么（当前成片是本地渲染版）</p>
        <ul className="space-y-1 text-xs leading-5 text-stone-600">
          <li>· 画面：配置图像 Provider 后，镜头可换成 AI 生成的半写实插画，人物参考图自动注入</li>
          <li>· 配音：在 config/providers.json 配置任意 TTS 命令，或把 WAV 放进镜头音频路径，渲染时自动混入并按实测时长撑开镜头</li>
          <li>· 未配置 TTS 时成片是字幕 + 本地氛围音，任务结果会明确写「未配音」，不会用假人声冒充</li>
          <li>· 复杂动作镜头（走路 / 骑摩托 / 跳舞）可后续接 AI 视频模型，替换单镜头画面</li>
        </ul>
      </Card>

      {playing && (
        <Modal title={`成片播放 · ${playing.path}`} onClose={() => setPlaying(null)}>
          <video controls className="w-full rounded-lg bg-black" src={playing.url} />
          <p className="mt-2 text-[11px] text-stone-500">文件位置：{outputDir}\\{playing.path.replace(/\//g, '\\')}</p>
        </Modal>
      )}
    </div>
  );
};
