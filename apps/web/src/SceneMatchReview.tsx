import React, { useMemo, useState } from 'react';
import { shotSceneSuggestion } from '@thai-video/core/sceneMatch';
import type { SceneSuggestion } from '@thai-video/core/sceneMatch';
import type { ProjectBundle, Scene, Shot } from '@thai-video/core/types';
import { Badge, Banner, Card } from './ui';
import { ScenePicker } from './ScenePicker';
import { sceneThumbUrl } from './sceneThumb';

type Props = {
  bundle: ProjectBundle;
  updateShot: (id: string, patch: Partial<Shot>) => void;
  embedded?: boolean;
};

type Row = {
  shot: Shot;
  index: number;
  suggestion: SceneSuggestion;
  current: Scene | null;
  suggested: Scene | null;
  /** 需要人工确认：兜底 / 只靠主题 / 依据很弱 / 场景已删 */
  needsCheck: boolean;
};

const REASON: Record<SceneSuggestion['reason'], { label: string; tone: 'green' | 'blue' | 'orange' | 'red' | 'gray' }> = {
  hint: { label: '剧本标注', tone: 'green' },
  keyword: { label: '台词命中', tone: 'blue' },
  topic: { label: '仅按主题', tone: 'orange' },
  fallback: { label: '程序兜底', tone: 'red' },
  none: { label: '无场景', tone: 'gray' },
};

const confidenceTone = (confidence: number): 'green' | 'orange' | 'red' =>
  confidence >= 0.6 ? 'green' : confidence > 0 ? 'orange' : 'red';

const SceneCell: React.FC<{
  label: string;
  scene: Scene | null;
  sceneId: string;
  children?: React.ReactNode;
}> = ({ label, scene, sceneId, children }) => (
  <div className="flex min-w-[150px] flex-1 items-start gap-2 rounded-md border border-stone-200 bg-white p-2">
    {scene
      ? <img src={sceneThumbUrl(scene)} alt="" className="h-12 w-7 shrink-0 rounded-sm object-cover" />
      : <span className="h-12 w-7 shrink-0 rounded-sm bg-stone-100" />}
    <div className="min-w-0 flex-1">
      <p className="text-[10px] text-stone-400">{label}</p>
      <p className="truncate text-xs font-semibold" title={scene?.name || sceneId}>
        {scene?.name || (sceneId ? '场景已删除' : '未选场景')}
      </p>
      <div className="mt-1 flex flex-wrap gap-1">{children}</div>
    </div>
  </div>
);

/**
 * 场景匹配审阅：把「程序自动配了什么」摊开给人看，再让人逐镜头纠正。
 *
 * 自动匹配是按关键词猜的，不可能百分百准；以前只有一个不留痕迹的 sceneId，
 * 用户看不出哪些是命中、哪些是轮换兜底。这里显示建议场景缩略图、命中词、
 * 依据与把握程度，并提供手动选择 / 恢复自动 / 批量重新匹配。
 * 建议由 core/sceneMatch 计算，与服务端自动分镜是同一个纯函数。
 */
export const SceneMatchReview: React.FC<Props> = ({ bundle, updateShot, embedded = false }) => {
  const [expanded, setExpanded] = useState(true);
  const [onlyPending, setOnlyPending] = useState(false);
  const [openShotId, setOpenShotId] = useState<string | null>(null);

  const scenes = bundle.scenes;
  const rows: Row[] = useMemo(() => bundle.shots.map((shot, index) => {
    const suggestion = shotSceneSuggestion(shot, scenes, bundle.script.topic, index);
    const current = scenes.find((s) => s.id === shot.sceneId) ?? null;
    const suggested = scenes.find((s) => s.id === suggestion.sceneId) ?? null;
    return {
      shot, index, suggestion, current, suggested,
      needsCheck: suggestion.confidence < 0.5 || !current || suggestion.reason === 'fallback',
    };
  }), [bundle.shots, scenes, bundle.script.topic]);

  const pendingCount = rows.filter((r) => r.needsCheck).length;
  const manualCount = rows.filter((r) => r.shot.sceneSource === 'manual').length;
  const visible = onlyPending ? rows.filter((r) => r.needsCheck) : rows;

  const choose = (shot: Shot, sceneId: string): void => {
    updateShot(shot.id, { sceneId, sceneSource: 'manual' });
    setOpenShotId(null);
  };

  const restore = (row: Row): void => {
    if (!row.suggestion.sceneId) return;
    updateShot(row.shot.id, { sceneId: row.suggestion.sceneId, sceneSource: 'auto' });
    setOpenShotId(null);
  };

  /** 只动自动镜头；手动指定过的场景是用户决定，不能被一键冲掉。 */
  const reMatch = (includeManual: boolean): void => {
    if (includeManual && !window.confirm('这会清除所有「手动指定」的场景，全部恢复为自动匹配结果。确定吗？')) return;
    for (const row of rows) {
      if (row.shot.locked || !row.suggestion.sceneId) continue;
      if (!includeManual && row.shot.sceneSource === 'manual') continue;
      if (row.shot.sceneId === row.suggestion.sceneId && row.shot.sceneSource === 'auto') continue;
      updateShot(row.shot.id, { sceneId: row.suggestion.sceneId, sceneSource: 'auto' });
    }
  };

  if (bundle.shots.length === 0) return null;

  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '▾' : '▸'}
        </button>
        <span className="text-sm font-semibold text-ink">场景匹配审阅</span>
        <Badge tone="blue">{rows.length} 个镜头</Badge>
        <Badge tone={pendingCount ? 'orange' : 'green'}>{pendingCount} 个待确认</Badge>
        {manualCount > 0 && <Badge tone="green">{manualCount} 个已手动指定</Badge>}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button className={`chip border ${onlyPending ? 'border-warm bg-orange-50 text-warm' : 'border-stone-300 text-stone-500'}`}
            onClick={() => setOnlyPending((v) => !v)}>
            {onlyPending ? '显示全部' : '只看待确认'}
          </button>
          <button className="btn btn-ghost py-1 text-xs" onClick={() => reMatch(false)}>重新自动匹配</button>
          {manualCount > 0 && (
            <button className="btn btn-ghost py-1 text-xs text-stone-500" onClick={() => reMatch(true)}>
              清除手动指定
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <>
          <p className="mt-2 text-[11px] leading-5 text-stone-500">
            自动匹配只是按关键词猜。左边是程序建议的场景与依据，右边是这个镜头实际用的场景；
            觉得不对就点「手动选择场景」，改完会标成「手动指定」，重新自动分镜也不会被覆盖。
            「程序兜底」表示这句台词一个关键词都没命中，是轮换选出来的，优先人工确认。
            「重新自动匹配」只更新自动镜头，不动你手动指定的场景；想全部推倒重来用「清除手动指定」。
          </p>
          {!embedded && <div className="h-1" />}
          {visible.length === 0 ? (
            <Banner tone="info">没有待确认的镜头：每个场景都有明确的匹配依据。</Banner>
          ) : (
            <div className="mt-3 space-y-2">
              {visible.map((row) => {
                const { shot, suggestion, current, suggested } = row;
                const manual = shot.sceneSource === 'manual';
                const differs = shot.sceneId !== suggestion.sceneId;
                const reason = REASON[suggestion.reason];
                const open = openShotId === shot.id;
                return (
                  <div key={shot.id} className={`rounded-lg border p-2 ${row.needsCheck ? 'border-orange-200 bg-orange-50/40' : 'border-stone-200'}`}>
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="w-full shrink-0 sm:w-36">
                        <p className="text-[11px] font-semibold">NO.{String(shot.order).padStart(2, '0')} · {shot.durationSec.toFixed(1)}s</p>
                        <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-stone-500">
                          {shot.dialogueZh || shot.dialogueTh || shot.narrationZh || shot.narrationTh || '（无台词）'}
                        </p>
                        {shot.locked && <span className="text-[10px] text-stone-400">🔒 已锁定</span>}
                      </div>

                      <SceneCell label="自动建议" scene={suggested} sceneId={suggestion.sceneId}>
                        <Badge tone={reason.tone}>{reason.label}</Badge>
                        <Badge tone={confidenceTone(suggestion.confidence)}>
                          {suggestion.confidence >= 0.6 ? '依据充分' : suggestion.confidence > 0 ? '依据较弱' : '无依据'}
                        </Badge>
                        {suggestion.matchedWords.length > 0 && (
                          <span className="w-full text-[10px] leading-4 text-stone-500">
                            命中：{suggestion.matchedWords.slice(0, 4).join('、')}
                            {suggestion.matchedWords.length > 4 ? '…' : ''}
                          </span>
                        )}
                        {suggestion.reason === 'hint' && shot.sceneHint && (
                          <span className="w-full text-[10px] text-stone-500">剧本标注：{shot.sceneHint}</span>
                        )}
                        {suggestion.reason === 'topic' && (
                          <span className="w-full text-[10px] text-stone-500">主题：{bundle.script.topic || '—'}</span>
                        )}
                        {suggestion.reason === 'fallback' && (
                          <span className="w-full text-[10px] text-red-600">没命中关键词，程序轮换选的</span>
                        )}
                      </SceneCell>

                      <SceneCell label="当前使用" scene={current} sceneId={shot.sceneId}>
                        <Badge tone={manual ? 'green' : 'gray'}>{manual ? '手动指定' : '自动匹配'}</Badge>
                        {differs && <Badge tone="orange">与建议不同</Badge>}
                        {!current && <Badge tone="red">请重选</Badge>}
                      </SceneCell>

                      <div className="flex w-full shrink-0 flex-col gap-1 sm:w-28">
                        <button className="btn btn-primary py-1 text-xs" disabled={shot.locked}
                          onClick={() => setOpenShotId(open ? null : shot.id)}>
                          {open ? '收起' : '手动选择场景'}
                        </button>
                        {(manual || differs) && (
                          <button className="btn btn-ghost py-1 text-xs" disabled={shot.locked || !suggestion.sceneId}
                            onClick={() => restore(row)}>恢复自动</button>
                        )}
                      </div>
                    </div>

                    {open && (
                      <ScenePicker
                        className="mt-2"
                        scenes={scenes}
                        value={shot.sceneId}
                        suggestion={suggestion}
                        disabled={shot.locked}
                        open
                        onToggle={() => setOpenShotId(null)}
                        onSelect={(sceneId) => choose(shot, sceneId)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Card>
  );
};
