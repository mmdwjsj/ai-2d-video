import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useWorkbench } from '../store';
import type { Shot, ShotVersion } from '@thai-video/core/types';
import { shotSceneSuggestion } from '@thai-video/core/sceneMatch';
import { LANGUAGE_LABELS, showsTh, showsZh } from '../language';
import { sceneThumbUrl } from '../sceneThumb';
import { Badge, Banner, Card, Empty, Field, InlineBar, SectionTitle, TextArea } from '../ui';
import { FramePlayer } from '../FramePlayer';
import { frameOf, usePreviewFrames } from '../previewFrames';
import { ScenePicker } from '../ScenePicker';
import { SceneMatchReview } from '../SceneMatchReview';

const STATUS_TONE: Record<Shot['status'], 'gray' | 'green' | 'orange' | 'red' | 'blue'> = {
  draft: 'gray', queued: 'blue', generating: 'orange', ready: 'green', failed: 'red',
};

export const StoryboardPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const bundle = useWorkbench((s) => s.bundle)!;
  const shots = bundle.shots;
  const selectedShotId = useWorkbench((s) => s.selectedShotId);
  const selectShot = useWorkbench((s) => s.selectShot);
  const updateShot = useWorkbench((s) => s.updateShot);
  const addShot = useWorkbench((s) => s.addShot);
  const removeShot = useWorkbench((s) => s.removeShot);
  const reorderShots = useWorkbench((s) => s.reorderShots);
  const restoreShot = useWorkbench((s) => s.restoreShot);
  const regenerateShot = useWorkbench((s) => s.regenerateShot);
  const busy = useWorkbench((s) => s.busy);
  const [versions, setVersions] = useState<ShotVersion[]>([]);

  const shot = shots.find((s) => s.id === selectedShotId) ?? shots[0] ?? null;
  const shotIndex = shots.findIndex((s) => s.id === shot?.id);
  // 与自动分镜、审阅面板共用同一个纯函数，详情里显示的「自动建议」不会是另一套算法。
  const detailSuggestion = shot
    ? shotSceneSuggestion(shot, bundle.scenes, bundle.script.topic, Math.max(0, shotIndex))
    : null;
  const mode = bundle.meta.exportMode;
  // 画面与预览页、成片导出共用服务端 buildFrame 生成的同一套帧。
  const preview = usePreviewFrames(bundle, mode);
  const previewShot = frameOf(preview.payload, shot?.id);
  const wantZh = showsZh(mode);
  const wantTh = showsTh(mode);
  const both = wantZh && wantTh;
  // 预览里只挑当前语言类型的台词；单语项目不该把另一种语言的字显示出来。
  const lineOf = (item: Shot): string =>
    (wantZh ? item.dialogueZh || item.dialogueTh : item.dialogueTh || item.dialogueZh) || '';

  useEffect(() => {
    if (!shot) { setVersions([]); return; }
    void api.get<{ versions: ShotVersion[] }>(
      `/api/projects/${bundle.meta.id}/shots/${shot.id}/versions`,
    ).then((r) => setVersions(r.versions)).catch(() => setVersions([]));
  }, [bundle.meta.id, shot?.id, shot?.version]);

  const patch = (p: Partial<Shot>): void => { if (shot) updateShot(shot.id, p); };

  const move = (index: number, delta: number): void => {
    const ids = shots.map((s) => s.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void reorderShots(ids);
  };

  const toggleCharacter = (id: string): void => {
    if (!shot) return;
    const next = shot.characterIds.includes(id)
      ? shot.characterIds.filter((c) => c !== id)
      : [...shot.characterIds, id];
    patch({ characterIds: next });
  };

  const totalSec = shots.reduce((sum, s) => sum + s.durationSec, 0);

  return (
    <div>
      {embedded ? (
        <InlineBar
          hint={`每个镜头独立改、独立存；上方「场景匹配审阅」可看自动匹配依据并手动换场景，当前语言类型「${LANGUAGE_LABELS[mode]}」。`}
          right={<button className="btn btn-ghost py-1 text-xs" disabled={busy} onClick={() => void addShot()}>添加镜头</button>}
        />
      ) : (
        <SectionTitle
          title="分镜编辑"
          hint={`核心数据对象。上方「场景匹配审阅」可看自动匹配依据并手动换场景；当前语言类型「${LANGUAGE_LABELS[mode]}」。`}
          right={
            <>
              <Badge tone="blue">{shots.length} 个镜头 · {totalSec.toFixed(1)}s</Badge>
              <button className="btn btn-primary" disabled={busy} onClick={() => void addShot()}>添加镜头</button>
            </>
          }
        />
      )}

      <SceneMatchReview bundle={bundle} updateShot={updateShot} embedded={embedded} />

      {shots.length === 0 ? (
        <Empty title="还没有分镜" hint="回第 3 段写完剧本，点顶部「提交并自动分镜」；也可以点上面「添加镜头」手动建一个。" />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          {/* 镜头列表 */}
          <div className="w-full shrink-0 space-y-2 lg:w-72">
            {shots.map((item, index) => {
              const itemScene = bundle.scenes.find((s) => s.id === item.sceneId);
              const active = item.id === shot?.id;
              return (
                <button
                  key={item.id}
                  onClick={() => selectShot(item.id)}
                  className={`card w-full p-3 text-left ${active ? 'ring-2 ring-warm/60' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">NO.{String(item.order).padStart(2, '0')} · {item.durationSec.toFixed(1)}s</span>
                    <div className="flex items-center gap-1">
                      {item.locked && <span title="已锁定">🔒</span>}
                      <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    {itemScene
                      ? <img src={sceneThumbUrl(itemScene)} alt="" className="h-7 w-4 shrink-0 rounded-sm object-cover" />
                      : <span className="h-7 w-4 shrink-0 rounded-sm bg-stone-200" />}
                    <span className="min-w-0 truncate text-xs text-stone-600">{itemScene?.name || '未选场景'}</span>
                    {item.sceneSource === 'manual' && (
                      <span className="chip shrink-0 bg-emerald-50 text-[10px] text-emerald-700">手动</span>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-stone-400">{lineOf(item) || '（无台词）'}</p>
                  <div className="mt-2 flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <span className="chip bg-stone-100 text-stone-500">v{item.version}</span>
                    <button className="btn btn-ghost px-2 py-0.5 text-xs" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                    <button className="btn btn-ghost px-2 py-0.5 text-xs" disabled={index === shots.length - 1} onClick={() => move(index, 1)}>↓</button>
                  </div>
                </button>
              );
            })}
          </div>

          {/* 单镜头详情 */}
          {shot && (
            <div className="min-w-0 flex-1 space-y-4">
              {shot.locked && (
                <Banner tone="warn">该镜头已锁定：编辑、重生成、删除与批量分镜都会被拒绝。需要改动请先解锁。</Banner>
              )}

              <div className="flex flex-col gap-4 md:flex-row">
                {/* 9:16 画面：成片同款，按同一条口型时间轴动嘴 */}
                <FramePlayer
                  shot={previewShot}
                  controls
                  className="w-full shrink-0 md:w-48"
                  hint={preview.loading
                    ? '成片画面生成中…'
                    : preview.error ? `预览画面加载失败：${preview.error}` : '暂无预览画面'}
                />

                <Card className="flex-1">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge tone="orange">NO.{String(shot.order).padStart(2, '0')}</Badge>
                    <Badge tone={STATUS_TONE[shot.status]}>{shot.status}</Badge>
                    <span className="text-[11px] text-stone-400">版本 v{shot.version} · {shot.id}</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="label">场景</span>
                        <span className="flex items-center gap-2">
                          <Badge tone={shot.sceneSource === 'manual' ? 'green' : 'gray'}>
                            {shot.sceneSource === 'manual' ? '手动指定' : '自动匹配'}
                          </Badge>
                          {(shot.sceneSource === 'manual'
                            || (detailSuggestion?.sceneId && detailSuggestion.sceneId !== shot.sceneId)) && (
                            <button type="button" disabled={shot.locked}
                              className="text-[11px] text-stone-500 hover:text-warm hover:underline disabled:opacity-50"
                              onClick={() => patch({
                                sceneId: detailSuggestion?.sceneId || shot.sceneId,
                                sceneSource: 'auto',
                              })}>
                              恢复自动
                            </button>
                          )}
                        </span>
                      </div>
                      <ScenePicker
                        scenes={bundle.scenes}
                        value={shot.sceneId}
                        suggestion={detailSuggestion}
                        disabled={shot.locked}
                        onSelect={(sceneId) => patch({ sceneId, sceneSource: 'manual' })}
                      />
                    </div>
                    <Field label="镜头时长（秒）" type="number" step={0.1} min={0.5} max={60}
                      value={shot.durationSec} onChange={(v) => patch({ durationSec: Number(v) })} />
                    <Field label="动作" value={shot.action} onChange={(v) => patch({ action: v })} />
                    <Field label="表情" value={shot.expression} onChange={(v) => patch({ expression: v })} />
                    <Field label="景别" value={shot.shotSize} onChange={(v) => patch({ shotSize: v })} />
                    <Field label="镜头角度" value={shot.cameraAngle} onChange={(v) => patch({ cameraAngle: v })} />
                    <Field label="镜头运动" value={shot.cameraMove} onChange={(v) => patch({ cameraMove: v })} />
                  </div>
                  <div className="mt-3">
                    <p className="label">出场人物（可多选）</p>
                    <div className="flex flex-wrap gap-2">
                      {bundle.characters.map((c) => (
                        <label key={c.id} className={`chip cursor-pointer border ${shot.characterIds.includes(c.id) ? 'border-warm bg-orange-50 text-warm' : 'border-stone-300 text-stone-600'}`}>
                          <input type="checkbox" className="mr-1" checked={shot.characterIds.includes(c.id)} onChange={() => toggleCharacter(c.id)} />
                          {c.name}
                        </label>
                      ))}
                    </div>
                  </div>
                </Card>
              </div>

              <Card>
                <p className="mb-2 text-xs font-semibold text-stone-600">
                  {both ? '双语台词' : `${LANGUAGE_LABELS[mode]}台词`}（改完自动保存{both ? '，两栏互不自动覆盖' : ''}）
                </p>
                <div className={`grid gap-3 ${both ? 'md:grid-cols-2' : ''}`}>
                  {wantZh && (
                    <>
                      <TextArea label="中文对白" rows={3} value={shot.dialogueZh} onChange={(v) => patch({ dialogueZh: v })} />
                      <TextArea label="中文旁白" rows={2} value={shot.narrationZh} onChange={(v) => patch({ narrationZh: v })} />
                    </>
                  )}
                  {wantTh && (
                    <>
                      <TextArea label="泰语对白" rows={3} value={shot.dialogueTh} onChange={(v) => patch({ dialogueTh: v })} />
                      <TextArea label="泰语旁白" rows={2} value={shot.narrationTh} onChange={(v) => patch({ narrationTh: v })} />
                    </>
                  )}
                </div>
                <div className={`mt-3 grid gap-2 ${both ? 'md:grid-cols-2' : ''}`}>
                  {wantZh && <TextArea label="中文字幕" rows={2} value={shot.subtitleZh} onChange={(v) => patch({ subtitleZh: v })} />}
                  {wantTh && <TextArea label="泰语字幕" rows={2} value={shot.subtitleTh} onChange={(v) => patch({ subtitleTh: v })} />}
                </div>
                {!both && (
                  <p className="mt-2 text-[11px] text-stone-400">
                    另一种语言的台词仍保存在项目文件里，切到「双语」即可看到并编辑。
                  </p>
                )}
              </Card>

              <Card>
                <p className="mb-2 text-xs font-semibold text-stone-600">单镜头操作（不影响其它镜头）</p>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-ghost" disabled={busy || shot.locked} onClick={() => void regenerateShot(shot.id, 'image')}>重新生成画面</button>
                  {wantZh && <button className="btn btn-ghost" disabled={busy || shot.locked} onClick={() => void regenerateShot(shot.id, 'audio.zh')}>重新生成中文配音</button>}
                  {wantTh && <button className="btn btn-ghost" disabled={busy || shot.locked} onClick={() => void regenerateShot(shot.id, 'audio.th')}>重新生成泰语配音</button>}
                  <button className="btn btn-ghost" onClick={() => patch({ locked: !shot.locked })}>{shot.locked ? '解锁镜头' : '锁定镜头'}</button>
                  <button className="btn btn-danger" disabled={shot.locked} onClick={() => { if (window.confirm('删除这个镜头？')) void removeShot(shot.id); }}>删除镜头</button>
                </div>
                <p className="mt-2 text-[11px] text-stone-400">
                  {wantZh && <>中文音频：{shot.audioZhPath || '未生成'} · </>}
                  {wantTh && <>泰语音频：{shot.audioThPath || '未生成'} · </>}
                  最近任务：{shot.lastTaskId || '无'}
                </p>
              </Card>

              <Card>
                <p className="mb-2 text-xs font-semibold text-stone-600">历史版本（{versions.length}）</p>
                {versions.length === 0 ? (
                  <p className="text-xs text-stone-400">编辑镜头后会自动留下版本快照。</p>
                ) : (
                  <div className="space-y-1">
                    {versions.map((v) => (
                      <div key={v.version} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-stone-200 px-3 py-2 text-xs">
                        <span>v{v.version} · {new Date(v.savedAt).toLocaleString('zh-CN')} · {v.note}</span>
                        <button className="btn btn-ghost px-2 py-0.5 text-xs" disabled={shot.locked || busy}
                          onClick={() => void restoreShot(shot.id, v.version)}>恢复此版本</button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
