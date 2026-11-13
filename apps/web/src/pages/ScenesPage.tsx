import React, { useState } from 'react';
import { useWorkbench } from '../store';
import { emptyScene } from '@thai-video/core/types';
import type { Scene } from '@thai-video/core/types';
import { Badge, Field, InlineBar, Modal, SectionTitle } from '../ui';
import { sceneThumbUrl } from '../sceneThumb';

/**
 * 场景段：只读缩略图墙。
 *
 * 以前这里是 12 张卡片 × 9 个输入框（约 108 个控件），但时间/天气/光线/镜头角度
 * 填了不生效、背景图路径也没接进渲染，纯属让用户做无用功。现在：
 * - 卡片只展示「长什么样」+「什么时候会被用到」；
 * - 真的需要改的只有 4 项（名称/类型/地点/关键词），收进编辑弹窗；
 * - 加不加场景仍然可以，但不再是必须走的步骤。
 */
export const ScenesPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const bundle = useWorkbench((s) => s.bundle)!;
  const updateScenes = useWorkbench((s) => s.updateScenes);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = bundle.scenes.find((s) => s.id === editingId) ?? null;

  const update = (id: string, patch: Partial<Scene>): void =>
    updateScenes(bundle.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const add = (): void => {
    const scene = emptyScene(`scene-${Date.now()}`);
    updateScenes([...bundle.scenes, scene]);
    setEditingId(scene.id);
  };

  const remove = (id: string): void => {
    if (window.confirm('删除这个场景？已引用它的镜头会保留 sceneId，但预览会变成默认画面。')) {
      updateScenes(bundle.scenes.filter((s) => s.id !== id));
    }
  };

  const shotCount = (id: string): number => bundle.shots.filter((s) => s.sceneId === id).length;

  return (
    <div>
      {embedded ? (
        <InlineBar
          hint="一天里的光线已经写在场景里（夜市自带夜景、办公室自带白天），不用单独配。台词按关键词自动落到场景；分镜里想换某个镜头的场景，到第 4 段点缩略图换。"
          right={<button className="btn btn-ghost py-1 text-xs" onClick={add}>添加场景</button>}
        />
      ) : (
        <SectionTitle
          title="场景库"
          hint="缩略图就是成片里的画面配色。台词按关键词自动匹配场景，个别镜头可在分镜里单独换。"
          right={<><Badge tone="blue">{bundle.scenes.length} 个场景</Badge><button className="btn btn-primary" onClick={add}>添加场景</button></>}
        />
      )}

      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {bundle.scenes.map((scene) => {
          const used = shotCount(scene.id);
          return (
            <div key={scene.id} className="card flex gap-3 p-2.5">
              <button
                type="button"
                onClick={() => setEditingId(scene.id)}
                className="relative w-16 shrink-0 self-stretch overflow-hidden rounded-md border border-stone-200 bg-stone-100"
                title="点开编辑名称与关键词"
              >
                {/* 卡片是扁的，默认居中裁切只会露出天空；往下压一点，露出的才是摊位/货架这些识别点 */}
                <img src={sceneThumbUrl(scene)} alt={`${scene.name || scene.id} 缩略图`}
                  className="absolute inset-0 h-full w-full object-cover object-[50%_72%]" />
              </button>
              <div className="flex min-w-0 flex-1 flex-col justify-between">
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-1">
                    <p className="truncate text-sm font-semibold" title={scene.name || scene.id}>
                      {scene.name || '（未命名场景）'}
                    </p>
                    <button className="shrink-0 text-[11px] text-stone-400 hover:text-warm hover:underline"
                      onClick={() => setEditingId(scene.id)}>编辑</button>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-stone-500">
                    {[scene.type, scene.location].filter(Boolean).join(' · ') || '未填写类型与地点'}
                  </p>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className={`chip border ${used ? 'border-warm/40 bg-orange-50 text-warm' : 'border-stone-200 text-stone-400'}`}>
                    {used ? `${used} 个镜头在用` : '暂未被使用'}
                  </span>
                  {(scene.keywords ?? []).slice(0, 2).map((key) => (
                    <span key={key} className="chip bg-stone-100 text-stone-500">{key}</span>
                  ))}
                  {(scene.keywords ?? []).length > 2 && (
                    <span className="text-[10px] text-stone-400">+{scene.keywords.length - 2}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <Modal
          title={`编辑场景 · ${editing.name || '未命名'}`}
          onClose={() => setEditingId(null)}
          footer={
            <>
              <button className="btn btn-ghost text-red-600" onClick={() => { remove(editing.id); setEditingId(null); }}>
                删除这个场景
              </button>
              <button className="btn btn-primary" onClick={() => setEditingId(null)}>完成</button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="flex gap-3">
              <img src={sceneThumbUrl(editing)} alt="场景缩略图"
                className="h-28 w-16 shrink-0 rounded-md border border-stone-200 object-cover" />
              <div className="flex-1 space-y-2">
                <Field label="场景名称" value={editing.name} onChange={(v) => update(editing.id, { name: v })} />
                <Field label="类型（例：居住 / 商业 / 交通）" value={editing.type}
                  onChange={(v) => update(editing.id, { type: v })} />
              </div>
            </div>
            <Field label="地点描述（会注入生成提示）" value={editing.location}
              onChange={(v) => update(editing.id, { location: v })} />
            <Field label="匹配关键词（逗号分隔，决定台词自动分到哪）"
              value={(editing.keywords ?? []).join('，')}
              placeholder="夜市，小吃，路边摊"
              onChange={(v) => update(editing.id, {
                keywords: v.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
              })} />
            <p className="text-[11px] leading-relaxed text-stone-500">
              改完自动保存。时间、天气、光线、镜头角度不再单独配置：
              夜市场景天然是夜景、办公室天然是白天，靠场景本身表达，少填一堆不会生效的框。
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
};
