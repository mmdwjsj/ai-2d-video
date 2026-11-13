import { buildSceneThumb } from '@thai-video/video-renderer/sceneArt';
import type { Scene } from '@thai-video/core/types';

/**
 * 场景缩略图的 data URI。
 *
 * 和成片用的是同一套插画代码（video-renderer/sceneArt），所以界面上看到的配色
 * 就是导出后画面里的配色。加了缓存：改关键词时只重算那一张，其余不重排。
 */
const cache = new Map<string, string>();

const keyOf = (scene?: Scene | null): string => (scene
  ? [scene.id, scene.name, scene.type, scene.location, (scene.keywords ?? []).join(',')].join('|')
  : '__none__');

export const sceneThumbUrl = (scene?: Scene | null): string => {
  const key = keyOf(scene);
  const hit = cache.get(key);
  if (hit) return hit;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildSceneThumb(scene))}`;
  // 关键词每敲一个字都会换 key，给个上限避免无限增长。
  if (cache.size > 200) cache.clear();
  cache.set(key, url);
  return url;
};
