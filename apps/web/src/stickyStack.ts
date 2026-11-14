import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { pickCurrentSection } from './stickyStack.logic';

/** App 里唯一的滚动容器：段头 sticky 与「当前在哪一段」的判定都以它为基准。 */
export const SCROLL_ROOT_ID = 'workbench-scroll';

/** 还没量到吸顶条时的保守兜底；默认值由 index.css 的 .sticky-stack 提供，实测值用 inline style 覆盖。 */
const FALLBACK_TOP = 76;

/** 段头贴住的位置：正好在吸顶条下沿，不遮提交按钮。 */
export const stickyHeaderStyle = { top: `var(--stack-top-h, ${FALLBACK_TOP}px)` } as React.CSSProperties;
/** 点段导航跳转时的留白：让段头落在吸顶条下面，而不是被盖住。 */
export const sectionScrollStyle = {
  scrollMarginTop: `calc(var(--stack-top-h, ${FALLBACK_TOP}px) + 10px)`,
} as React.CSSProperties;

type StackOptions<K extends string> = {
  keys: readonly K[];
  /** 点段导航后平滑滚动的大致时长，期间锁定高亮，免得沿途把每一段都闪一遍。 */
  lockMs?: number;
};

/**
 * 一页多段的「冻结段头」支撑，只负责三件事：
 * 1. 量吸顶条真实高度写进 --stack-top-h（窄屏 flex-wrap 换行后依然对齐）；
 * 2. 滚动时算出视口顶部落在哪一段，供段导航高亮与段头「正在看」标记；
 * 3. 点击导航时短暂锁定目标段。
 *
 * 段头本身用原生 CSS sticky，父级 section 就是它的边界：
 * 滚出这一段时会被下一段段头自然顶走，不需要 JS 手动隐藏，也不会出现两段头叠着。
 */
export const useStickyStack = <K extends string>({ keys, lockMs = 700 }: StackOptions<K>) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [current, setCurrent] = useState<K>(keys[0]);
  const lock = useRef<{ key: K; until: number } | null>(null);
  const timer = useRef<number | null>(null);

  const barHeight = useCallback(
    (): number => barRef.current?.getBoundingClientRect().height ?? FALLBACK_TOP,
    [],
  );

  const measure = useCallback((): void => {
    rootRef.current?.style.setProperty('--stack-top-h', `${Math.ceil(barHeight())}px`);
  }, [barHeight]);

  const compute = useCallback((): K => {
    const root = document.getElementById(SCROLL_ROOT_ID);
    if (!root) return keys[0];
    // 直接用吸顶条实际底边当判定线：容器 padding、窄屏换行、字体缩放都不会让判定偏掉。
    const barBottom = barRef.current?.getBoundingClientRect().bottom;
    const line = (barBottom ?? root.getBoundingClientRect().top + barHeight()) + 10;
    const tops = keys.map((key) => document.getElementById(`sec-${key}`)?.getBoundingClientRect().top);
    return pickCurrentSection(keys, tops, line);
  }, [keys, barHeight]);

  const sync = useCallback((): void => {
    const held = lock.current;
    if (held && Date.now() < held.until) {
      setCurrent(held.key);
      return;
    }
    setCurrent(compute());
  }, [compute]);

  const lockTo = useCallback((key: K): void => {
    lock.current = { key, until: Date.now() + lockMs };
    setCurrent(key);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      lock.current = null;
      sync();
    }, lockMs + 60);
  }, [lockMs, sync]);

  useLayoutEffect(() => {
    measure();
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    const root = document.getElementById(SCROLL_ROOT_ID);
    if (!root) return;
    let frame = 0;
    const onScroll = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => { frame = 0; sync(); });
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    sync();
    return () => {
      root.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [sync]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  return { rootRef, barRef, current, lockTo, refresh: sync };
};
