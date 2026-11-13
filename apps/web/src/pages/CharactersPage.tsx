import React from 'react';
import { useWorkbench } from '../store';
import type { Character, VoiceConfig } from '@thai-video/core/types';
import { LANGUAGE_LABELS } from '../language';
import { Badge, Banner, Card, Field, InlineBar, SectionTitle, TextArea } from '../ui';

const SLOTS: { key: keyof Character['referenceImages']; label: string }[] = [
  { key: 'front', label: '正面' }, { key: 'side', label: '侧面' }, { key: 'back', label: '背面' },
  { key: 'fullBody', label: '全身' }, { key: 'halfBody', label: '半身' }, { key: 'face', label: '脸部' },
];

const VoiceFields: React.FC<{
  title: string; voice: VoiceConfig; onChange: (voice: VoiceConfig) => void;
}> = ({ title, voice, onChange }) => (
  <div className="rounded-lg border border-stone-200 p-3">
    <p className="mb-2 text-xs font-semibold text-stone-600">{title}</p>
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label="引擎" value={voice.engine} onChange={(v) => onChange({ ...voice, engine: v })} placeholder="配置 TTS 后填写" />
      <Field label="声音" value={voice.voice} onChange={(v) => onChange({ ...voice, voice: v })} placeholder="voice id" />
      <Field label="语速" type="number" step={0.05} value={voice.speed} onChange={(v) => onChange({ ...voice, speed: Number(v) })} />
      <Field label="音量" type="number" step={0.05} value={voice.volume} onChange={(v) => onChange({ ...voice, volume: Number(v) })} />
    </div>
    <div className="mt-2">
      <Field label="情绪 / 语气" value={voice.emotion} onChange={(v) => onChange({ ...voice, emotion: v })} />
    </div>
  </div>
);

export const CharactersPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const bundle = useWorkbench((s) => s.bundle)!;
  const updateCharacters = useWorkbench((s) => s.updateCharacters);
  const uploadReference = useWorkbench((s) => s.uploadReference);

  const update = (id: string, patch: Partial<Character>): void => {
    updateCharacters(bundle.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  return (
    <div>
      {embedded ? (
        <InlineBar hint="剧本里写的人物名要和这里一致；「核心外貌」写清不可变特征，生成画面时会自动注入。" />
      ) : (
        <SectionTitle
          title="人物管理"
          hint="三个固定主要人物；核心外貌锁定，职业与人物关系都可改。剧本里用的人物名要和这里一致。"
          right={<Badge tone="green">{bundle.characters.length} 个人物</Badge>}
        />
      )}
      <Banner tone="info">
        当前语言类型「{LANGUAGE_LABELS[bundle.meta.exportMode]}」：配音时只会用到对应语种的声音配置，另一种可以提前填好，将来切成双语就能直接用。
      </Banner>
      <div className="grid gap-4 xl:grid-cols-2">
        {bundle.characters.map((character) => (
          <Card key={character.id}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-base font-semibold">{character.name} <span className="text-sm font-normal text-stone-500">{character.nameTh}</span></p>
                <p className="text-[11px] text-stone-400">{character.id} · {character.occupation || '未设置职业'}</p>
              </div>
              <label className="flex items-center gap-1 text-xs text-stone-600">
                <input
                  type="checkbox" checked={character.identityLock.enabled}
                  onChange={(e) => update(character.id, {
                    identityLock: { ...character.identityLock, enabled: e.target.checked },
                  })}
                />
                形象锁定
              </label>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="姓名（中文）" value={character.name} onChange={(v) => update(character.id, { name: v })} />
              <Field label="姓名（泰文）" value={character.nameTh} onChange={(v) => update(character.id, { nameTh: v })} />
              <Field label="年龄设定" value={character.ageSetting} onChange={(v) => update(character.id, { ageSetting: v })} />
              <Field label="职业" value={character.occupation} onChange={(v) => update(character.id, { occupation: v })} />
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Field label="性格" value={character.personality} onChange={(v) => update(character.id, { personality: v })} />
              <Field label="常用服装（逗号分隔）" value={character.wardrobe.join('，')} onChange={(v) => update(character.id, { wardrobe: v.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })} />
            </div>
            <div className="mt-2">
              <TextArea label="背景设定" rows={2} value={character.background} onChange={(v) => update(character.id, { background: v })} />
            </div>
            <div className="mt-2">
              <TextArea
                label="核心外貌（不可变，生成任务自动注入）" rows={2}
                value={character.identityLock.coreAppearance}
                onChange={(v) => update(character.id, { identityLock: { ...character.identityLock, coreAppearance: v } })}
              />
            </div>

            <p className="mb-2 mt-4 text-xs font-semibold text-stone-600">参考图（自动按槽位追加版本）</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {SLOTS.map((slot) => {
                const path = character.referenceImages[slot.key] as string;
                return (
                  <label key={slot.key} className="cursor-pointer rounded-lg border border-dashed border-stone-300 p-1 text-center hover:border-warm">
                    <div className="flex h-16 items-center justify-center overflow-hidden rounded bg-stone-50">
                      {path
                        ? <img src={`/${path}`} alt={slot.label} className="h-full w-full object-cover" />
                        : <span className="text-[11px] text-stone-400">＋上传</span>}
                    </div>
                    <span className="mt-1 block text-[11px] text-stone-600">{slot.label}</span>
                    <input
                      type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadReference(character.id, slot.key, file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-stone-400">
              表情参考图 {character.referenceImages.expressions.length} 张 · 动作参考图 {character.referenceImages.actions.length} 张
            </p>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <VoiceFields title="中文声音" voice={character.voices.zh}
                onChange={(v) => update(character.id, { voices: { ...character.voices, zh: v } })} />
              <VoiceFields title="泰语声音" voice={character.voices.th}
                onChange={(v) => update(character.id, { voices: { ...character.voices, th: v } })} />
            </div>

            <p className="mt-3 text-[11px] text-stone-500">
              人物关系：{character.relations.map((r) => `${r.characterId}（${r.label}）`).join('、') || '未设置'}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
};
