import React from 'react';
import { useWorkbench } from '../store';
import type { Shot } from '@thai-video/core/types';
import { LANGUAGE_LABELS, showsTh, showsZh } from '../language';
import { Badge, Banner, Card, Empty, InlineBar, SectionTitle } from '../ui';
import { sceneThumbUrl } from '../sceneThumb';

const MODE_LABEL = { zh: '中文版', th: '泰语版', bilingual: '双语版' } as const;

export const PreviewPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const bundle = useWorkbench((s) => s.bundle)!;
  const config = useWorkbench((s) => s.config);
  const selectedShotId = useWorkbench((s) => s.selectedShotId);
  const selectShot = useWorkbench((s) => s.selectShot);
  const shots = bundle.shots;
  const totalSec = shots.reduce((sum, s) => sum + s.durationSec, 0);
  const shot = shots.find((s) => s.id === selectedShotId) ?? shots[0] ?? null;
  const scene = bundle.scenes.find((s) => s.id === shot?.sceneId);
  const fps = config?.app.video.fps ?? 30;
  const mode = bundle.meta.exportMode;
  const wantZh = showsZh(mode);
  const wantTh = showsTh(mode);
  const lineOf = (item: Shot): string =>
    (wantZh ? item.dialogueZh || item.dialogueTh : item.dialogueTh || item.dialogueZh) || '';

  return (
    <div>
      {embedded ? (
        <InlineBar
          hint={`按分镜顺序预览镜头与字幕版面，只显示「${LANGUAGE_LABELS[mode]}」对应的台词。`}
          right={<Badge tone="blue">{MODE_LABEL[mode]}</Badge>}
        />
      ) : (
        <SectionTitle
          title="视频预览"
          hint={`按分镜顺序预览镜头与字幕版面；当前只显示「${LANGUAGE_LABELS[mode]}」对应的台词。`}
          right={<Badge tone="blue">{MODE_LABEL[mode]}</Badge>}
        />
      )}
      <Banner tone="warn" action={
        <button className="underline" onClick={() => document.getElementById('sec-export')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>去下面「导出 MP4」 ↓</button>
      }>
        这里是「版面预览」，不是成品 MP4。想看真成片，往下到「导出 MP4」点一次按钮并等进度 100%。这里时长按镜头秒数相加（{totalSec.toFixed(1)}s），成片会按配音实测时长把每个镜头撑开，再加片头片尾。
      </Banner>

      {shots.length === 0 ? (
        <Empty title="没有可预览的镜头" hint="先回「制作」写完剧本，点顶部「提交并自动分镜」。" />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="w-full shrink-0 lg:w-64">
            <div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl border-4 border-stone-800 bg-gradient-to-b from-sky-100 to-orange-50 shadow-card">
              {(shot?.generatedImagePath || shot?.backgroundImagePath || scene) && (
                <img
                  src={shot?.generatedImagePath || shot?.backgroundImagePath
                    ? `/${shot.generatedImagePath || shot.backgroundImagePath}`
                    : sceneThumbUrl(scene)}
                  alt="预览画面" className="absolute inset-0 h-full w-full object-cover" />
              )}
              <div className="absolute inset-x-0 top-0 p-3 text-center text-xs font-semibold text-stone-700">
                {bundle.script.title || bundle.meta.name}
              </div>
              {shot && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 text-white">
                  <p className="text-[11px] opacity-80">{scene?.name || '未选场景'} · NO.{String(shot.order).padStart(2, '0')}</p>
                  <p className="mt-1 text-sm font-semibold">{lineOf(shot) || '（无台词）'}</p>
                  {mode === 'bilingual' && shot.dialogueTh && (
                    <p className="mt-1 text-[11px] opacity-90">{shot.dialogueTh}</p>
                  )}
                  {wantZh && shot.subtitleZh && (
                    <p className="mt-2 rounded bg-black/40 px-2 py-1 text-center text-[11px]">{shot.subtitleZh}</p>
                  )}
                  {wantTh && shot.subtitleTh && (
                    <p className="mt-1 rounded bg-black/40 px-2 py-1 text-center text-[11px]">{shot.subtitleTh}</p>
                  )}
                </div>
              )}
            </div>
            <p className="mt-2 text-center text-[11px] text-stone-400">
              {config?.app.video.width ?? 1080}×{config?.app.video.height ?? 1920} · {fps}fps · 9:16
            </p>
          </div>

          <Card className="min-w-0 flex-1">
            <p className="mb-3 text-sm font-semibold">镜头时间轴（{shots.length} 个镜头 / {totalSec.toFixed(1)}s）</p>
            <div className="flex h-10 w-full overflow-hidden rounded-lg border border-stone-200">
              {shots.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => selectShot(s.id)}
                  title={`NO.${s.order} ${s.durationSec}s`}
                  className={`flex min-w-0 items-center justify-center border-r border-white/60 text-[10px] font-medium text-white ${s.id === shot?.id ? 'bg-warm' : 'bg-stone-400 hover:bg-stone-500'}`}
                  style={{ flex: `${s.durationSec} 1 0` }}
                >
                  <span className="truncate px-1">#{i + 1}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {shots.map((s, i) => (
                <button key={s.id} onClick={() => selectShot(s.id)}
                  className={`rounded-lg border p-2 text-left text-xs ${s.id === shot?.id ? 'border-warm bg-orange-50' : 'border-stone-200'}`}>
                  <span className="font-semibold">NO.{String(i + 1).padStart(2, '0')}</span>
                  <span className="ml-2 text-stone-500">{s.durationSec.toFixed(1)}s · {bundle.scenes.find((x) => x.id === s.sceneId)?.name || '未选场景'}</span>
                  <p className="mt-1 truncate text-stone-500">{lineOf(s) || '（无台词）'}</p>
                </button>
              ))}
            </div>
            <div className="mt-4 rounded-lg bg-stone-50 p-3 text-[11px] leading-5 text-stone-600">
              <p>成片版本：{MODE_LABEL[mode]}（语言类型决定主版本，导出页可额外导出另两种）</p>
              <p>成片位置：项目根 output/&lt;项目ID&gt; · 下面「成片文件在哪看」</p>
              <p>合成：本地 Edge 画面渲染 + FFmpeg（H.264 / AAC），无需密钥</p>
              <p>音频：配音 WAV 实测时长定时间轴；未配置 TTS 时为字幕 + 本地氛围音</p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
