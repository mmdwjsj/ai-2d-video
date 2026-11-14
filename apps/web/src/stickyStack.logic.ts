/**
 * 冻结段头的「当前段」判定，抽成纯函数方便回归。
 *
 * 段头是原生 sticky：每一段只在自己的 section 里粘住，滚出后被下一段顶走。
 * 因此只要看「判定线（吸顶条下沿 + 容差）越过了哪些段的顶边」，
 * 最后一个被越过的段就是用户正在看的那一段，不需要监听每个段头的位置。
 */
export const pickCurrentSection = <K extends string>(
  keys: readonly K[],
  tops: readonly (number | undefined)[],
  line: number,
): K => {
  let active = keys[0];
  for (let i = 0; i < keys.length; i += 1) {
    const top = tops[i];
    // 段还没挂载（或已卸载）就停在这里，别把高亮跳到更后面的段去。
    if (top === undefined || top > line) break;
    active = keys[i];
  }
  return active;
};
