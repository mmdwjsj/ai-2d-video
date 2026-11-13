import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useWorkbench } from '../store';
import type { Shot, ShotVersion } from '@thai-video/core/types';
import { LANGUAGE_LABELS, showsTh, showsZh } from '../language';
import { sceneThumbUrl } from '../sceneThumb';
import { Badge, Banner, Card, Empty, Field, InlineBar, SectionTitle, TextArea } from '../ui';

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
  const [scenePicker, setScenePicker] = useState(false);

  const shot = shots.find((s) => s.id === selectedShotId) ?? shots[0] ?? null;
  const scene = bundle.scenes.find((s) => s.id === shot?.sceneId);
  const charactersInShot = bundle.characters.filter((c) => shot?.characterIds.includes(c.id));
  const mode = bundle.meta.exportMode;
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
          hint={`每个镜头独立改、独立存，改一个不影响别的镜头；当前语言类型「${LANGUAGE_LABELS[mode]}」，只显示对应语种。`}
          right={<button className="btn btn-ghost py-1 text-xs" disabled={busy} onClick={() => void addShot()}>添加镜头</button>}
        />
      ) : (
        <SectionTitle
          title="分镜编辑"
          hint={`核心数据对象。每个镜头独立改人物/场景/动作/表情/台词；当前语言类型「${LANGUAGE_LABELS[mode]}」，只显示对应语种。`}
          right={
            <>
              <Badge tone="blue">{shots.length} 个镜头 · {totalSec.toFixed(1)}s</Badge>
              <button className="btn btn-primary" disabled={busy} onClick={() => void addShot()}>添加镜头</button>
            </>
          }
        />
      )}

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
                  <p className="mt-1 truncate text-xs text-stone-600">{itemScene?.name || '未选场景'}</p>
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
                {/* 9:16 画面预览 */}
                <div className="w-full shrink-0 md:w-48">
                  <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl border border-stone-300 bg-gradient-to-b from-sky-100 to-orange-50">
                    {(shot.generatedImagePath || shot.backgroundImagePath || scene) && (
                      <img
                        src={shot.generatedImagePath || shot.backgroundImagePath
                          ? `/${shot.generatedImagePath || shot.backgroundImagePath}`
                          : sceneThumbUrl(scene)}
                        alt="镜头画面" className="absolute inset-0 h-full w-full object-cover"
                      />
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 text-white">
                      <p className="text-xs font-semibold">{scene?.name || '未选场景'}</p>
                      <p className="mt-0.5 text-[10px] opacity-90">{charactersInShot.map((c) => c.name).join(' / ') || '未选人物'}</p>
                      <p className="mt-1 line-clamp-2 text-[10px]">{lineOf(shot)}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-center text-[11px] text-stone-400">
                    9:16 画面预览 · 阶段二接入真实素材
                  </p>
                </div>

                <Card className="flex-1">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge tone="orange">NO.{String(shot.order).padStart(2, '0')}</Badge>
                    <Badge tone={STATUS_TONE[shot.status]}>{shot.status}</Badge>
                    <span className="text-[11px] text-stone-400">版本 v{shot.version} · {shot.id}</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <span className="label">场景</span>
                      <button type="button" onClick={() => setScenePicker((v) => !v)}
                        className="input flex items-center justify-between gap-2 text-left">
                        <span className="flex min-w-0 items-center gap-2">
                          {scene
                            ? <img src={sceneThumbUrl(scene)} alt="" className="h-7 w-4 rounded-sm object-cover" />
                            : <span className="h-7 w-4 rounded-sm bg-stone-200" />}
                          <span className="truncate text-sm">{scene?.name || '未选场景'}</span>
                        </span>
                        <span className="shrink-0 text-[11px] text-stone-400">{scenePicker ? '收起' : '换场景 ▾'}</span>
                      </button>
                      {scenePicker && (
                        <div className="mt-2 grid grid-cols-4 gap-1.5 rounded-lg border border-stone-200 bg-stone-50 p-2 sm:grid-cols-6">
                          {bundle.scenes.map((item) => (
                            <button key={item.id} type="button"
                              onClick={() => { patch({ sceneId: item.id }); setScenePicker(false); }}
                              className={`overflow-hidden rounded-md border-2 text-left transition ${
                                item.id === shot.sceneId ? 'border-warm' : 'border-transparent hover:border-stone-300'}`}
                              title={item.name}>
                              <img src={sceneThumbUrl(item)} alt={item.name}
                                className="aspect-[9/16] w-full object-cover" />
                              <span className="block truncate bg-white px-1 py-0.5 text-[10px] leading-4 text-stone-600">
                                {item.name || item.id}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
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
