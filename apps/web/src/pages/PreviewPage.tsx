import React from 'react';
import { useWorkbench } from '../store';
import type { Shot } from '@thai-video/core/types';
import { LANGUAGE_LABELS, showsZh } from '../language';
import { Badge, Banner, Card, Empty, InlineBar, SectionTitle } from '../ui';
import { FramePlayer } from '../FramePlayer';
import { frameOf, usePreviewFrames } from '../previewFrames';
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
  const fps = config?.app.video.fps ?? 30;
  const mode = bundle.meta.exportMode;
  const wantZh = showsZh(mode);
  const lineOf = (item: Shot): string =>
    (wantZh ? item.dialogueZh || item.dialogueTh : item.dialogueTh || item.dialogueZh) || '';
  // 画面由服务端用成片同一个 buildFrame 生成，这里只负责按时间轴播放口型。
  const preview = usePreviewFrames(bundle, mode);
  const previewShot = frameOf(preview.payload, shot?.id);

  return (
    <div>
      {embedded ? (
        <InlineBar
          hint={`与成片同一套画面、同一套口型时间轴；只显示「${LANGUAGE_LABELS[mode]}」对应的台词。`}
          right={<Badge tone="blue">{MODE_LABEL[mode]}</Badge>}
        />
      ) : (
        <SectionTitle
          title="视频预览"
          hint="与成片同一套画面、同一套口型时间轴；只显示当前语言类型对应的台词。"
          right={<Badge tone="blue">{MODE_LABEL[mode]}</Badge>}
        />
      )}
      <Banner tone="info" action={
        <button className="underline" onClick={() => document.getElementById('sec-export')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>去下面「导出 MP4」 ↓</button>
      }>
        这里用的是成片同一个画面渲染器，对话人物会按配音音量或台词节奏动嘴；已导出的镜头还能直接试听配音。但不是成品 MP4：预览时长按镜头秒数相加（{totalSec.toFixed(1)}s），成片会按配音实测时长撑开每个镜头，再加片头片尾和推近动效。
      </Banner>

      {shots.length === 0 ? (
        <Empty title="没有可预览的镜头" hint="先回「制作」写完剧本，点顶部「提交并自动分镜」。" />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <FramePlayer
            shot={previewShot}
            audioUrl={previewShot?.audioUrl ?? null}
            controls
            className="w-full shrink-0 lg:w-64"
            hint={preview.loading
              ? '成片画面生成中…'
              : preview.error ? `预览画面加载失败：${preview.error}` : '暂无预览画面'}
          />

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
              {shots.map((s, i) => {
                const scene = bundle.scenes.find((x) => x.id === s.sceneId);
                return (
                  <button key={s.id} onClick={() => selectShot(s.id)}
                    className={`rounded-lg border p-2 text-left text-xs ${s.id === shot?.id ? 'border-warm bg-orange-50' : 'border-stone-200'}`}>
                    <div className="flex items-center gap-1.5">
                      {scene
                        ? <img src={sceneThumbUrl(scene)} alt="" className="h-6 w-4 shrink-0 rounded-sm object-cover" />
                        : <span className="h-6 w-4 shrink-0 rounded-sm bg-stone-200" />}
                      <span className="font-semibold">NO.{String(i + 1).padStart(2, '0')}</span>
                      <span className="min-w-0 truncate text-stone-500">
                        {s.durationSec.toFixed(1)}s · {scene?.name || '未选场景'}
                      </span>
                      {s.sceneSource === 'manual' && (
                        <span className="chip shrink-0 bg-emerald-50 text-[10px] text-emerald-700">手动</span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-stone-500">{lineOf(s) || '（无台词）'}</p>
                    <p className="mt-0.5 truncate text-[10px] text-stone-400">
                      出场：{s.characterIds.map((id) => bundle.characters.find((c) => c.id === id)?.name ?? id).join('、') || '无（情境 / 旁白镜头）'}
                    </p>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 rounded-lg bg-stone-50 p-3 text-[11px] leading-5 text-stone-600">
              <p>成片版本：{MODE_LABEL[mode]}（语言类型决定主版本，导出页可额外导出另两种）</p>
              <p>成片位置：项目根 output/&lt;项目ID&gt; · 下面「成片文件在哪看」</p>
              <p>合成：本地 Edge 画面渲染 + FFmpeg（H.264 / AAC），无需密钥</p>
              <p>音频：配音 WAV 实测时长定时间轴，导出后留存供预览试听；配音不可用时为字幕 + 本地氛围音</p>
              <p>画面：与成片共用 buildFrame / 人物标定（{config?.app.video.width ?? 1080}×{config?.app.video.height ?? 1920} · {fps}fps · 9:16），口型按同一条 mouthTimeline 逐帧切换</p>
              <p>
                预览画面：{preview.loading ? '生成中…' : preview.error ? `加载失败（${preview.error}）` : '已同步'}
                <button className="ml-2 underline" onClick={preview.refresh}>重新取画面</button>
              </p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
