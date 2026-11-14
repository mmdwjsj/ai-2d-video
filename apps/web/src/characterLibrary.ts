import { emptyCharacter, nowIso } from '@thai-video/core/types';
import type { Character, ReferenceImages } from '@thai-video/core/types';

/** 人物参考图的六个固定槽位，与 core 的 ReferenceImages 一一对应。 */
export const REFERENCE_SLOTS = [
  { key: 'front', label: '正面' },
  { key: 'side', label: '侧面' },
  { key: 'back', label: '背面' },
  { key: 'fullBody', label: '全身' },
  { key: 'halfBody', label: '半身' },
  { key: 'face', label: '脸部' },
] as const;

export type ReferenceSlot = (typeof REFERENCE_SLOTS)[number]['key'];

/** 资源库里的一条人物：六张图 + 新建人物时可直接复用的设定模板。 */
export type LibraryCharacter = {
  id: string;
  slug: string;
  name: string;
  nameTh: string;
  cover: string;
  images: Record<ReferenceSlot, string>;
  template: Partial<Character>;
};

export type CharacterLibraryPayload = {
  slots: { key: string; label: string }[];
  characters: LibraryCharacter[];
};

/**
 * 参考图 URL 归一化：
 * 资源库与 config 里存的是 `assets/...`，旧项目里存过 `/assets/...`，
 * 直接 `src={'/' + path}` 会拼出 `//assets/...`（被浏览器当成别的域名）而裂图。
 */
export const assetUrl = (value: string): string => {
  if (!value) return '';
  if (/^(https?:)?\/\//.test(value) || value.startsWith('data:')) {
    return value.startsWith('//') ? `/${value.replace(/^\/+/, '')}` : value;
  }
  return `/${value.replace(/^\/+/, '')}`;
};

export const makeCharacterId = (): string =>
  `char-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** 六张图是否都齐（用于资源库卡片显示 6/6）。 */
export const countImages = (images: Partial<Record<ReferenceSlot, string>>): number =>
  REFERENCE_SLOTS.filter((slot) => Boolean(images[slot.key])).length;

export const emptyReferenceImages = (): ReferenceImages => ({
  front: '', side: '', back: '', fullBody: '', halfBody: '', face: '',
  expressions: [], actions: [],
});

/** 从资源库选人 → 新人物：一次性带出六视图，并复用姓名/外貌/音色等设定。 */
export const characterFromLibrary = (entry: LibraryCharacter): Character => {
  const id = makeCharacterId();
  return {
    ...emptyCharacter(id),
    ...entry.template,
    id,
    name: entry.template.name || entry.name,
    nameTh: entry.template.nameTh ?? entry.nameTh,
    referenceImages: { ...emptyReferenceImages(), ...entry.images },
    relations: [],
    updatedAt: nowIso(),
  };
};

/** 把资源库的六张图套到已有人物上：只换图，手改过的姓名/音色保持不变。 */
export const applyLibraryImages = (character: Character, images: LibraryCharacter['images']): Character => ({
  ...character,
  referenceImages: {
    ...character.referenceImages,
    ...images,
  },
  updatedAt: nowIso(),
});
