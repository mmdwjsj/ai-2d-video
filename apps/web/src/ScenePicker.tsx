import React, { useState } from 'react';
import type { Scene } from '@thai-video/core/types';
import type { SceneSuggestion } from '@thai-video/core/sceneMatch';
import { sceneThumbUrl } from './sceneThumb';

type Props = {
  scenes: Scene[];
  /** 当前镜头实际使用的场景 id */
  value: string;
  /** 自动匹配建议：建议场景与相关候选排在选择器前面并打标记 */
  suggestion?: SceneSuggestion | null;
  onSelect: (sceneId: string) => void;
  /** 受控展开：审阅面板一次只展开一个镜头；不传则组件自己管 */
  open?: boolean;
  onToggle?: () => void;
  buttonLabel?: string;
  /** 锁定的镜头不允许改场景，服务端也会拒绝 */
  disabled?: boolean;
  className?: string;
};

/**
 * 场景选择按钮 + 缩略图选择面板。
 *
 * 分镜页的「场景匹配审阅」和单镜头详情共用这一个组件，不会出现两处
 * 选场景的方式不一致。缩略图来自成片同一套插画代码，选完立刻能在预览里看到。
 */
export const ScenePicker: React.FC<Props> = ({
  scenes, value, suggestion = null, onSelect,
  open, onToggle, buttonLabel = '手动选择场景', disabled = false, className = '',
}) => {
  const [innerOpen, setInnerOpen] = useState(false);
  const expanded = open ?? innerOpen;
  const toggle = onToggle ?? (() => setInnerOpen((v) => !v));
  const current = scenes.find((s) => s.id === value) ?? null;

  // 建议场景永远排第一，其余按匹配得分排，没得分的保持场景库原顺序。
  const rank = new Map<string, number>();
  if (suggestion?.sceneId) rank.set(suggestion.sceneId, -1000);
  (suggestion?.candidates ?? []).forEach((c, i) => {
    if (!rank.has(c.sceneId)) rank.set(c.sceneId, -100 + i);
  });
  const ordered = [...scenes].sort((a, b) => (rank.get(a.id) ?? scenes.indexOf(a))
    - (rank.get(b.id) ?? scenes.indexOf(b)));

  return (
    <div className={className}>
      <button type="button" onClick={toggle} disabled={disabled}
        className="input flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60">
        <span className="flex min-w-0 items-center gap-2">
          {current
            ? <img src={sceneThumbUrl(current)} alt="" className="h-9 w-5 shrink-0 rounded-sm object-cover" />
            : <span className="h-9 w-5 shrink-0 rounded-sm bg-stone-200" />}
          <span className="min-w-0">
            <span className="block truncate text-sm">{current?.name || (value ? '场景已删除' : '未选场景')}</span>
            {suggestion?.sceneId && suggestion.sceneId !== value && (
              <span className="block truncate text-[10px] text-stone-400">
                自动建议：{scenes.find((s) => s.id === suggestion.sceneId)?.name || '—'}
              </span>
            )}
          </span>
        </span>
        <span className="shrink-0 text-[11px] text-warm">{expanded ? '收起' : `${buttonLabel} ▾`}</span>
      </button>

      {expanded && (
        <div className="mt-2 rounded-lg border border-stone-200 bg-stone-50 p-2">
          {scenes.length === 0 ? (
            <p className="p-2 text-xs text-stone-500">场景库是空的：先到第 2 段「场景」添加，再回来手动指定。</p>
          ) : (
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-8">
              {ordered.map((item) => {
                const recommended = item.id === suggestion?.sceneId;
                const active = item.id === value;
                return (
                  <button key={item.id} type="button" title={item.name} disabled={disabled}
                    onClick={() => { onSelect(item.id); }}
                    className={`relative overflow-hidden rounded-md border-2 text-left transition ${
                      active ? 'border-warm' : 'border-transparent hover:border-stone-300'}`}>
                    <img src={sceneThumbUrl(item)} alt={item.name}
                      className="aspect-[9/16] w-full object-cover" />
                    {recommended && (
                      <span className="absolute left-0 top-0 rounded-br bg-warm px-1 text-[9px] leading-4 text-white">自动建议</span>
                    )}
                    <span className="block truncate bg-white px-1 py-0.5 text-[10px] leading-4 text-stone-600">
                      {item.name || item.id}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="mt-2 px-1 text-[10px] leading-4 text-stone-400">
            点一张就写入该镜头，并标记为「手动指定」——之后再点「提交并自动分镜」也不会被覆盖。
          </p>
        </div>
      )}
    </div>
  );
};
