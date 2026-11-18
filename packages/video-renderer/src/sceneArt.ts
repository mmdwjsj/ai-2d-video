/**
 * 本地画面渲染：把「场景 + 人物 + 台词」画成一张 1080×1920 的 2D 插画帧。
 *
 * 这里刻意不引入 Remotion / Canvas / 图像模型：
 * - 输出是纯 HTML+SVG，交给系统 Edge/Chrome 无头截图，Windows 上零额外依赖；
 * - 中文、泰文由浏览器排版，元音/声调组合不会错位（比 drawtext 更可靠）；
 * - 以后接真实图像模型时，只要把 shot.generatedImagePath 作为底图替换掉即可。
 */
import type { Character, ExportMode, Scene, Shot } from '@thai-video/core/types';
// 只从纯计算模块取类型：前端预览复用 sceneArt 时，不会顺着 mouth.ts 拉进 node:fs。
import type { MouthShape } from './mouthCore.js';

export const FRAME_WIDTH = 1080;
export const FRAME_HEIGHT = 1920;

/**
 * 人物参考图 + 实测嘴部位置（坐标单位都是图片原始像素）。
 * 画面里用同一 viewBox 的 SVG 覆盖层画嘴，和 <img object-fit:contain> 共用一套
 * preserveAspectRatio 映射，所以换图、换比例都不会出现「嘴贴歪」。
 */
export type CharacterArt = {
  src: string;
  width: number;
  height: number;
  mouthX: number;
  mouthY: number;
  mouthW: number;
  /**
   * 原图里嘴本身的高度（像素，来自 calibration.json 的 mouthSize[1]）。
   * 有的角色（吨吨）原嘴就是 59px 高的张嘴笑，有的（妮娜/阿顿）只是一条 12px 细线；
   * 不按这个高度盖底图，吨吨闭嘴档会永远张着嘴、小口型还会露出原嘴黑边。
   */
  mouthH?: number;
  /** 原图肤色，用来把静态嘴盖掉；补丁与人物图同组 multiply，不会留亮斑。 */
  skin?: string;
};

const esc = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

type Motif =
  | 'food-stall' | 'lanterns' | 'market' | 'shelf' | 'train' | 'window'
  | 'cafe' | 'desk' | 'school' | 'mall' | 'park' | 'street' | 'room';

type Palette = {
  skyTop: string; skyMid: string; skyBottom: string;
  ground: string; silhouette: string; silhouette2: string;
  glow: string; accent: string; text: string;
  motif: Motif; night: boolean; label: string;
};

const PALETTES: Record<string, Palette> = {
  'scene-street-food': {
    skyTop: '#2b2350', skyMid: '#b4523f', skyBottom: '#f0a35a',
    ground: '#4a2e2a', silhouette: '#3a2438', silhouette2: '#5b3540',
    glow: '#ffd08a', accent: '#ffb347', text: '#fff6e8',
    motif: 'food-stall', night: true, label: '曼谷街边餐馆',
  },
  'scene-night-market': {
    skyTop: '#180f36', skyMid: '#4b1f63', skyBottom: '#a03a63',
    ground: '#2b1730', silhouette: '#1b1030', silhouette2: '#39204a',
    glow: '#ffd76b', accent: '#ff7a9c', text: '#fff0f6',
    motif: 'lanterns', night: true, label: '泰国夜市',
  },
  'scene-fresh-market': {
    skyTop: '#8cc8cf', skyMid: '#d9e6c6', skyBottom: '#f6dfa8',
    ground: '#9c8b62', silhouette: '#638f7c', silhouette2: '#86a98a',
    glow: '#fff3c4', accent: '#e5784b', text: '#253b32',
    motif: 'market', night: false, label: '当地菜市场',
  },
  'scene-convenience-store': {
    skyTop: '#18304a', skyMid: '#2c5876', skyBottom: '#5f93a8',
    ground: '#243c50', silhouette: '#1b3044', silhouette2: '#2c5168',
    glow: '#e9fbff', accent: '#6fe3d2', text: '#eafbff',
    motif: 'shelf', night: true, label: '便利店',
  },
  'scene-bts-mrt': {
    skyTop: '#5b8fc9', skyMid: '#a9c9e2', skyBottom: '#e7d8c2',
    ground: '#61768a', silhouette: '#3f5b76', silhouette2: '#6d8ba3',
    glow: '#ffffff', accent: '#59c1e8', text: '#f4fbff',
    motif: 'train', night: false, label: 'BTS / MRT',
  },
  'scene-apartment': {
    skyTop: '#f0cfa8', skyMid: '#f6e2c8', skyBottom: '#d9b99c',
    ground: '#a98365', silhouette: '#b58d6e', silhouette2: '#c9a685',
    glow: '#fff4d6', accent: '#e08b63', text: '#453022',
    motif: 'room', night: false, label: '曼谷公寓',
  },
  'scene-cafe': {
    skyTop: '#4a3a2e', skyMid: '#8a6a4c', skyBottom: '#c9a276',
    ground: '#5b4533', silhouette: '#3d2e23', silhouette2: '#6c523c',
    glow: '#ffe1a8', accent: '#d9a15b', text: '#fff3e2',
    motif: 'cafe', night: false, label: '咖啡厅',
  },
  'scene-office': {
    skyTop: '#d8e5ef', skyMid: '#eef4f8', skyBottom: '#c7d8e4',
    ground: '#9fb2c0', silhouette: '#7e97a9', silhouette2: '#adc0cd',
    glow: '#ffffff', accent: '#4b90c8', text: '#20394c',
    motif: 'desk', night: false, label: '办公室',
  },
  'scene-school': {
    skyTop: '#69b7e0', skyMid: '#b9e0ec', skyBottom: '#f4e6b8',
    ground: '#8aa878', silhouette: '#5b8a76', silhouette2: '#85ae86',
    glow: '#fff8d0', accent: '#e9795a', text: '#22414b',
    motif: 'school', night: false, label: '学校',
  },
  'scene-mall': {
    skyTop: '#efe0f3', skyMid: '#f7dcec', skyBottom: '#f6c7d8',
    ground: '#c9a9bd', silhouette: '#a684a6', silhouette2: '#c7a0bb',
    glow: '#ffffff', accent: '#e45c96', text: '#4a2842',
    motif: 'mall', night: false, label: '商场',
  },
  'scene-park': {
    skyTop: '#f6a86a', skyMid: '#f8cf92', skyBottom: '#b9cf86',
    ground: '#6f8b55', silhouette: '#426b48', silhouette2: '#648a55',
    glow: '#ffe6a3', accent: '#f0b64c', text: '#203a25',
    motif: 'park', night: false, label: '公园',
  },
  'scene-street-motorcycle': {
    skyTop: '#8fb8d8', skyMid: '#cfd9d3', skyBottom: '#e8cfa9',
    ground: '#7d7f80', silhouette: '#57636b', silhouette2: '#8a9294',
    glow: '#fff4d0', accent: '#e2603c', text: '#23343c',
    motif: 'street', night: false, label: '曼谷街头',
  },
};

const DEFAULT_PALETTE: Palette = PALETTES['scene-street-food'];

export const paletteFor = (scene?: Scene | null): Palette => {
  if (!scene) return DEFAULT_PALETTE;
  if (PALETTES[scene.id]) return PALETTES[scene.id];
  const haystack = `${scene.name} ${scene.type} ${scene.location} ${(scene.keywords ?? []).join(' ')}`;
  const rules: [RegExp, Palette][] = [
    [/夜市|night.?market/i, PALETTES['scene-night-market']],
    [/菜市场|fresh.?market|香料/i, PALETTES['scene-fresh-market']],
    [/便利|convenience/i, PALETTES['scene-convenience-store']],
    [/BTS|MRT|地铁|通勤/i, PALETTES['scene-bts-mrt']],
    [/公寓|apartment|家/i, PALETTES['scene-apartment']],
    [/咖啡|cafe/i, PALETTES['scene-cafe']],
    [/办公室|office|开会/i, PALETTES['scene-office']],
    [/学校|school/i, PALETTES['scene-school']],
    [/商场|mall/i, PALETTES['scene-mall']],
    [/公园|park/i, PALETTES['scene-park']],
    [/摩托|motorcycle|街道|堵车/i, PALETTES['scene-street-motorcycle']],
    [/餐馆|food|吃|饭/i, PALETTES['scene-street-food']],
  ];
  for (const [re, palette] of rules) if (re.test(haystack)) return palette;
  return DEFAULT_PALETTE;
};

/* -------------------------------------------------------------------------- */
/* 场景插画：远景剪影 + 光源 + 该场景的标志性元素                              */
/* -------------------------------------------------------------------------- */

const buildings = (p: Palette, baseY: number): string => {
  const widths = [110, 78, 140, 92, 126, 84, 118, 96, 132];
  let x = -30;
  return widths.map((w, i) => {
    const h = 190 + ((i * 73) % 260);
    const out = `<rect x="${x}" y="${baseY - h}" width="${w}" height="${h + 30}" rx="4" fill="${i % 2 ? p.silhouette2 : p.silhouette}" opacity="0.85"/>`;
    // 窗格
    const windows = [];
    for (let wy = baseY - h + 28; wy < baseY - 24; wy += 42) {
      for (let wx = x + 14; wx < x + w - 14; wx += 32) {
        if ((wx + wy + i) % 3 === 0 && p.night) {
          windows.push(`<rect x="${wx}" y="${wy}" width="12" height="18" rx="2" fill="${p.glow}" opacity="0.55"/>`);
        }
      }
    }
    x += w + 12;
    return out + windows.join('');
  }).join('');
};

const trees = (p: Palette, baseY: number): string => {
  const spots = [40, 210, 430, 690, 900, 1020];
  return spots.map((x, i) => {
    const h = 230 + (i % 3) * 60;
    return `<g opacity="0.9"><rect x="${x + 18}" y="${baseY - h / 2}" width="16" height="${h / 2 + 20}" fill="${p.silhouette}"/>
      <circle cx="${x + 26}" cy="${baseY - h / 2 - 30}" r="${70 + (i % 2) * 22}" fill="${p.silhouette2}"/>
      <circle cx="${x - 14}" cy="${baseY - h / 2 + 6}" r="52" fill="${p.silhouette}"/>
      <circle cx="${x + 74}" cy="${baseY - h / 2 + 10}" r="48" fill="${p.silhouette2}"/></g>`;
  }).join('');
};

const motifSvg = (p: Palette): string => {
  const y = 1500;
  const glow = `<circle cx="540" cy="620" r="330" fill="url(#lightGlow)" opacity="0.65"/>`;
  switch (p.motif) {
    case 'lanterns': {
      const lanterns = [80, 230, 390, 550, 710, 870, 1010].map((x, i) => {
        const cy = 250 + (i % 2) * 70;
        const colors = ['#ff8a5c', '#ffd166', '#ff6b8a', '#8be0c1', '#ffb347', '#f78fb3', '#ffd166'];
        return `<g><line x1="${x}" y1="0" x2="${x}" y2="${cy - 34}" stroke="${p.silhouette}" stroke-width="3"/>
          <rect x="${x - 26}" y="${cy - 34}" width="52" height="68" rx="14" fill="${colors[i]}" opacity="0.92"/>
          <circle cx="${x}" cy="${cy}" r="58" fill="${colors[i]}" opacity="0.16"/></g>`;
      }).join('');
      const stalls = [60, 400, 760].map((x, i) =>
        `<g><rect x="${x}" y="${y - 210}" width="270" height="210" rx="10" fill="${p.silhouette}" opacity="0.92"/>
         <rect x="${x - 12}" y="${y - 232}" width="294" height="30" rx="8" fill="${i % 2 ? '#e0634d' : '#e8a23f'}"/>
         <rect x="${x + 20}" y="${y - 150}" width="230" height="18" fill="${p.glow}" opacity="0.35"/></g>`).join('');
      return `${glow}${lanterns}${stalls}`;
    }
    case 'food-stall': {
      const steam = [0, 1, 2].map((i) =>
        `<path d="M${430 + i * 90} ${y - 180} q -22 -46 6 -90 q 26 -40 0 -78" stroke="${p.glow}" stroke-width="9" fill="none" opacity="0.28" stroke-linecap="round"/>`).join('');
      return `${glow}
        <rect x="60" y="${y - 250}" width="960" height="250" rx="16" fill="${p.silhouette}" opacity="0.9"/>
        <rect x="30" y="${y - 278}" width="1020" height="40" rx="12" fill="${p.accent}" opacity="0.85"/>
        <rect x="330" y="${y - 190}" width="420" height="120" rx="18" fill="${p.silhouette2}"/>
        <ellipse cx="540" cy="${y - 190}" rx="210" ry="30" fill="${p.glow}" opacity="0.5"/>
        ${steam}
        <circle cx="150" cy="${y - 90}" r="46" fill="#e05c4a"/><circle cx="930" cy="${y - 90}" r="46" fill="#e8a23f"/>
        <circle cx="520" cy="330" r="92" fill="${p.glow}" opacity="0.22"/>`;
    }
    case 'market': {
      const awnings = [20, 380, 740].map((x, i) =>
        `<g><path d="M${x} ${y - 300} L${x + 320} ${y - 300} L${x + 290} ${y - 240} L${x + 30} ${y - 240} Z" fill="${i % 2 ? '#e07a4f' : '#6f9c74'}" opacity="0.9"/>
         <rect x="${x + 20}" y="${y - 240}" width="280" height="240" rx="8" fill="${p.silhouette2}" opacity="0.85"/>
         <circle cx="${x + 80}" cy="${y - 120}" r="30" fill="#e8b04b"/><circle cx="${x + 160}" cy="${y - 120}" r="30" fill="#e2634a"/>
         <circle cx="${x + 240}" cy="${y - 120}" r="30" fill="#8fae5c"/></g>`).join('');
      return `${glow}${awnings}`;
    }
    case 'shelf': {
      const shelves = [0, 1, 2].map((row) => {
        const items = Array.from({ length: 9 }, (_, i) => {
          const x = 70 + i * 112;
          const top = y - 420 + row * 140;
          return `<rect x="${x}" y="${top + 24}" width="66" height="86" rx="6" fill="${(i + row) % 3 === 0 ? '#e2674f' : (i + row) % 3 === 1 ? '#5cb8a6' : '#e8b85c'}" opacity="0.85"/>`;
        }).join('');
        return `<rect x="40" y="${y - 410 + row * 140}" width="1000" height="16" fill="${p.silhouette2}"/>${items}`;
      }).join('');
      return `<rect x="20" y="${y - 470}" width="1040" height="470" rx="12" fill="${p.silhouette}" opacity="0.75"/>${shelves}
        <circle cx="540" cy="300" r="260" fill="url(#lightGlow)" opacity="0.55"/>`;
    }
    case 'train': {
      return `${glow}<rect x="-20" y="${y - 440}" width="1120" height="440" rx="30" fill="${p.silhouette2}" opacity="0.9"/>
        <rect x="90" y="${y - 390}" width="250" height="210" rx="18" fill="${p.skyTop}" opacity="0.85"/>
        <rect x="400" y="${y - 390}" width="250" height="210" rx="18" fill="${p.skyTop}" opacity="0.85"/>
        <rect x="710" y="${y - 390}" width="250" height="210" rx="18" fill="${p.skyTop}" opacity="0.85"/>
        <rect x="90" y="${y - 150}" width="870" height="18" rx="8" fill="${p.accent}" opacity="0.7"/>
        <circle cx="200" cy="420" r="60" fill="${p.glow}" opacity="0.25"/>`;
    }
    case 'room':
    case 'window': {
      return `${glow}<rect x="120" y="320" width="840" height="720" rx="26" fill="${p.silhouette2}" opacity="0.55"/>
        <rect x="160" y="360" width="760" height="640" rx="18" fill="${p.skyMid}" opacity="0.6"/>
        <line x1="540" y1="360" x2="540" y2="1000" stroke="${p.silhouette}" stroke-width="20"/>
        <line x1="160" y1="680" x2="920" y2="680" stroke="${p.silhouette}" stroke-width="20"/>
        <rect x="80" y="${y - 170}" width="920" height="170" rx="16" fill="${p.silhouette}" opacity="0.85"/>
        <circle cx="250" cy="${y - 210}" r="56" fill="#6f9c74" opacity="0.9"/>`;
    }
    case 'cafe': {
      return `${glow}<rect x="60" y="${y - 260}" width="960" height="260" rx="18" fill="${p.silhouette}" opacity="0.9"/>
        <rect x="30" y="${y - 290}" width="1020" height="42" rx="12" fill="${p.silhouette2}"/>
        <rect x="380" y="380" width="320" height="260" rx="14" fill="${p.skyTop}" opacity="0.5"/>
        <path d="M470 ${y - 330} q 40 -70 100 0" stroke="${p.glow}" stroke-width="10" fill="none" opacity="0.3"/>
        <rect x="800" y="${y - 380}" width="90" height="120" rx="10" fill="${p.accent}" opacity="0.8"/>`;
    }
    case 'desk': {
      return `${glow}<rect x="60" y="${y - 280}" width="960" height="280" rx="14" fill="${p.silhouette2}" opacity="0.85"/>
        <rect x="360" y="520" width="360" height="230" rx="14" fill="${p.silhouette}" opacity="0.8"/>
        <rect x="386" y="546" width="308" height="178" rx="8" fill="${p.skyMid}" opacity="0.75"/>
        <rect x="140" y="${y - 380}" width="180" height="100" rx="10" fill="${p.silhouette}" opacity="0.7"/>`;
    }
    case 'school': {
      return `${glow}<rect x="120" y="470" width="840" height="620" rx="12" fill="${p.silhouette2}" opacity="0.85"/>
        <path d="M90 470 L540 260 L990 470 Z" fill="#d97258" opacity="0.9"/>
        ${[240, 420, 600, 780].map((x) => `<rect x="${x}" y="560" width="90" height="140" rx="6" fill="${p.skyMid}" opacity="0.8"/>`).join('')}
        <rect x="510" y="830" width="110" height="260" rx="6" fill="${p.silhouette}"/>
        <line x1="980" y1="200" x2="980" y2="900" stroke="${p.silhouette}" stroke-width="10"/>
        <path d="M980 210 L1100 250 L980 290 Z" fill="${p.accent}"/>`;
    }
    case 'mall': {
      return `${glow}<rect x="60" y="380" width="960" height="700" rx="20" fill="${p.silhouette2}" opacity="0.7"/>
        ${[0, 1, 2].map((i) => `<rect x="${100 + i * 310}" y="${460 + (i % 2) * 60}" width="260" height="260" rx="12" fill="${p.skyTop}" opacity="0.55"/>
          <rect x="${100 + i * 310}" y="${720 + (i % 2) * 60}" width="260" height="24" rx="8" fill="${p.accent}" opacity="0.75"/>`).join('')}
        <ellipse cx="540" cy="1180" rx="480" ry="90" fill="${p.glow}" opacity="0.25"/>`;
    }
    case 'park': {
      return `${glow}${trees(p, y)}<ellipse cx="540" cy="1420" rx="520" ry="120" fill="${p.skyBottom}" opacity="0.5"/>
        <path d="M0 1500 Q540 1420 1080 1500 L1080 1920 L0 1920 Z" fill="${p.ground}" opacity="0.75"/>`;
    }
    case 'street': {
      return `${glow}${buildings(p, y)}
        <path d="M0 1480 L1080 1480 L1080 1920 L0 1920 Z" fill="${p.ground}" opacity="0.8"/>
        <rect x="180" y="1400" width="220" height="90" rx="24" fill="${p.accent}" opacity="0.85"/>
        <rect x="680" y="1400" width="260" height="90" rx="24" fill="${p.silhouette}" opacity="0.9"/>
        <circle cx="260" cy="1494" r="40" fill="#26303a"/><circle cx="760" cy="1494" r="40" fill="#26303a"/>`;
    }
    default:
      return glow;
  }
};

const backgroundSvg = (
  p: Palette,
  attrs = 'class="art"',
  opts: { grain?: boolean; blur?: boolean } = {},
): string => {
  const { grain = true, blur = true } = opts;
  const soft = blur ? ' filter="url(#soft)"' : '';
  return `
<svg ${attrs} viewBox="0 0 ${FRAME_WIDTH} ${FRAME_HEIGHT}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.skyTop}"/><stop offset="52%" stop-color="${p.skyMid}"/>
      <stop offset="100%" stop-color="${p.skyBottom}"/>
    </linearGradient>
    <radialGradient id="lightGlow"><stop offset="0%" stop-color="${p.glow}" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="${p.glow}" stop-opacity="0"/></radialGradient>
    <linearGradient id="groundFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.ground}" stop-opacity="0"/>
      <stop offset="100%" stop-color="${p.ground}" stop-opacity="0.9"/>
    </linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="26"/></filter>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/></filter>
  </defs>
  <rect width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" fill="url(#sky)"/>
  ${p.night ? `<circle cx="820" cy="280" r="86" fill="${p.glow}" opacity="0.75"${soft}/>
    <circle cx="820" cy="280" r="52" fill="${p.glow}" opacity="0.85"/>
    ${[[110, 180], [240, 320], [960, 150], [700, 420], [380, 120]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#fff" opacity="0.8"/>`).join('')}`
    : `<circle cx="850" cy="300" r="150" fill="${p.glow}" opacity="0.5"${soft}/>
       <circle cx="850" cy="300" r="72" fill="${p.glow}" opacity="0.8"/>
       <ellipse cx="300" cy="380" rx="180" ry="52" fill="#fff" opacity="0.22"/>
       <ellipse cx="420" cy="340" rx="120" ry="40" fill="#fff" opacity="0.18"/>`}
  ${buildings(p, 1180)}
  ${motifSvg(p)}
  <rect x="0" y="1180" width="${FRAME_WIDTH}" height="740" fill="url(#groundFade)"/>
  ${grain ? `<rect width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" filter="url(#grain)" opacity="0.055" style="mix-blend-mode:overlay"/>` : ''}
</svg>`;
};

/**
 * 场景缩略图：只画场景背景，不含人物与字幕。
 *
 * 用途是「所见即所得」——工作台里的场景卡片、分镜换场景、镜头预览都用它当底图，
 * 用户看到的配色和成片渲出来的是同一套，不会再出现「选了没反应」。
 * 返回独立 SVG（带 width/height），可直接塞进 <img src="data:image/svg+xml,...">。
 */
export const buildSceneThumb = (scene?: Scene | null): string =>
  // 一次要画十几张缩略图，所以走「轻量版」：去掉噪点层（feTurbulence 全屏光栅化很贵）
  // 和高斯模糊光晕；intrinsic 尺寸压到 1/4，避免按 1080×1920 逐张解码。
  // 也不重复声明 xmlns（backgroundSvg 里已经带了，重复会让 SVG 变成非法 XML）。
  backgroundSvg(
    paletteFor(scene),
    `width="${FRAME_WIDTH / 4}" height="${FRAME_HEIGHT / 4}"`,
    { grain: false, blur: false },
  );

/* -------------------------------------------------------------------------- */
/* 人物立绘：外貌按角色 ID 固定，未知/新增角色按 ID 哈希回退到已有配色，表情随镜头变化 */
/* -------------------------------------------------------------------------- */

type Look = {
  skin: string; hair: string; hairLight: string; shirt: string; shirtDark: string;
  longHair: boolean; beard: boolean; accessory: string;
};

const LOOKS: Record<string, Look> = {
  'char-a': {
    skin: '#f4c9a2', hair: '#2b1d22', hairLight: '#432c31', shirt: '#f08a5d', shirtDark: '#cf6647',
    longHair: true, beard: false, accessory: '#ffd166',
  },
  'char-b': {
    skin: '#e8b98c', hair: '#241f26', hairLight: '#3a3038', shirt: '#5b9bd5', shirtDark: '#3d74ab',
    longHair: false, beard: false, accessory: '#9bd7e8',
  },
  'char-c': {
    skin: '#dba97d', hair: '#4a4038', hairLight: '#655a4e', shirt: '#4f8a6d', shirtDark: '#38664f',
    longHair: false, beard: true, accessory: '#e8c37a',
  },
};

const lookFor = (id: string): Look => LOOKS[id] ?? LOOKS[Object.keys(LOOKS)[Math.abs(hash(id)) % 3]];

const hash = (text: string): number => {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
};

type ExpressionKind = 'smile' | 'laugh' | 'surprised' | 'calm' | 'frown' | 'worried' | 'smirk' | 'serious';

/**
 * 情绪词 → 眉眼/嘴型。词表与 @thai-video/core/scriptLines 的 EMOTION_OPTIONS 对齐：
 * 下拉框里能选的词要真的画得出差别，否则用户选了等于没选。
 * 顺序要紧：「冷笑」「微笑」都含「笑」，必须先拦掉，不然会被宽泛的「笑」判成大笑。
 */
const expressionOf = (text: string): ExpressionKind => {
  const t = text || '';
  if (/冷笑|不屑|讥讽|得意|smirk/i.test(t)) return 'smirk';
  if (/生气|愤怒|不满|皱眉|frown|angry/i.test(t)) return 'frown';
  if (/慌张|紧张|害怕|worried|panic/i.test(t)) return 'worried';
  if (/惊讶|吃惊|瞳孔地震|愣住|疑惑|好奇|疑问|surpris/i.test(t)) return 'surprised';
  if (/大笑|开心|兴奋|笑|happy|laugh/i.test(t)) return 'laugh';
  if (/微笑|温柔|感动|自信|smile/i.test(t)) return 'smile';
  if (/认真|严肃|疲惫|失落|无奈|尴尬|平静/i.test(t)) return 'serious';
  return 'calm';
};

const mouth = (kind: ExpressionKind): string => {
  switch (kind) {
    case 'laugh': return '<path d="M96 176 Q120 208 144 176 Q120 196 96 176 Z" fill="#8d4050"/>';
    case 'smile': return '<path d="M100 178 Q120 194 140 178" stroke="#8d4050" stroke-width="5" fill="none" stroke-linecap="round"/>';
    case 'surprised': return '<ellipse cx="120" cy="182" rx="13" ry="16" fill="#8d4050"/>';
    case 'frown': return '<path d="M100 190 Q120 172 140 190" stroke="#8d4050" stroke-width="5" fill="none" stroke-linecap="round"/>';
    case 'worried': return '<path d="M100 186 q10 -9 20 0 q10 9 20 0" stroke="#8d4050" stroke-width="4" fill="none" stroke-linecap="round"/>';
    case 'smirk': return '<path d="M100 186 Q122 176 140 182" stroke="#8d4050" stroke-width="5" fill="none" stroke-linecap="round"/>';
    case 'serious': return '<path d="M102 184 H138" stroke="#8d4050" stroke-width="4" fill="none" stroke-linecap="round"/>';
    default: return '<path d="M104 182 Q120 187 136 182" stroke="#8d4050" stroke-width="4" fill="none" stroke-linecap="round"/>';
  }
};

/** 眉毛比嘴型更能读出情绪：挑眉、八字眉、皱眉、一高一低、平眉。 */
const eyebrows = (kind: ExpressionKind): string => {
  const s = 'stroke="#3a2a2a" stroke-width="4" fill="none"';
  switch (kind) {
    case 'surprised':
      return `<path d="M84 132 q14 -12 28 -2" ${s}/><path d="M128 130 q14 -10 28 2" ${s}/>`;
    case 'worried':
      return `<path d="M84 130 q14 10 28 2" ${s}/><path d="M128 132 q14 -10 28 -2" ${s}/>`;
    case 'frown':
      return `<path d="M84 130 l28 8" ${s}/><path d="M156 130 l-28 8" ${s}/>`;
    case 'smirk':
      return `<path d="M84 130 q14 -9 28 0" ${s}/><path d="M128 136 q14 -5 28 0" ${s}/>`;
    default:
      return `<path d="M84 136 q14 -5 28 0" ${s}/><path d="M128 136 q14 -5 28 0" ${s}/>`;
  }
};

const MOUTH_INK = '#3a2a2a';
const MOUTH_CAVITY = '#5e2c34';
const MOUTH_TONGUE = '#ce7078';

/**
 * 四档口型，几何沿用 scripts/demo_animation.py 的 mouth_tiles：
 * 以实测嘴宽为基准、上唇为锚点向下张开，避免「上下一起放大顶到鼻子」。
 * 单位与 CharacterArt 一致（图片原始像素），所以贴图和立绘天然对齐。
 */
const mouthShapeSvg = (art: CharacterArt, shape: MouthShape): string => {
  const { mouthX: cx, mouthY: cy, mouthW: mw } = art;
  const lw = Math.max(2.4, mw * 0.055);
  const r = (n: number): number => Math.round(n * 100) / 100;
  if (shape === 'closed') {
    const w = mw * 0.92;
    const h = mw * 0.30;
    return `<path d="M${r(cx - w / 2)} ${r(cy - h * 0.10)} Q${r(cx)} ${r(cy + h * 0.75)} ${r(cx + w / 2)} ${r(cy - h * 0.10)}" fill="none" stroke="${MOUTH_INK}" stroke-width="${r(lw)}" stroke-linecap="round"/>`;
  }
  const specs: Record<Exclude<MouthShape, 'closed'>, [number, number, number]> = {
    small: [0.66, -0.06, 0.30],
    open: [0.78, -0.08, 0.46],
    wide: [0.60, -0.09, 0.56],
  };
  const [wr, off, hr] = specs[shape];
  const bw = mw * wr;
  const bh = mw * hr;
  const top = cy + off * mw;
  const midY = top + bh / 2;
  const tongue = shape === 'small' ? '' :
    `<ellipse cx="${r(cx)}" cy="${r(top + bh * 0.76)}" rx="${r(bw * 0.30)}" ry="${r(bh * 0.20)}" fill="${MOUTH_TONGUE}"/>`;
  return `<ellipse cx="${r(cx)}" cy="${r(midY)}" rx="${r(bw / 2)}" ry="${r(bh / 2)}" fill="${MOUTH_CAVITY}" stroke="${MOUTH_INK}" stroke-width="${r(lw)}"/>${tongue}`;
};

/**
 * 参考图上的口型覆盖层：先用肤色盖掉原图那条静态嘴，再画四档新嘴。
 *
 * 不能只靠「张嘴档盖住原嘴」：三个角色的原嘴差别很大——妮娜/阿顿是一条
 * 12px 的微笑细线，吨吨却是一个 116×59 已经张开的黑色口腔。以前按「原嘴都是
 * 一条细线」写，吨吨闭嘴档永远咧着嘴、小口型还会上下露出原嘴黑边。
 *
 * preserveAspectRatio="xMidYMax meet" 与 .person-photo 的
 * object-fit:contain + object-position:center bottom 是同一套映射规则，
 * 因此 SVG 里的原图坐标就是屏幕上看到的同一位置，不需要 JS 量尺寸。
 * 补丁与人物图放在同一个 .photo-blend 组里一起 multiply，两者被同一场景色
 * 压暗，脸上不会多出一块亮斑。
 */
const photoMouthPatch = (art: CharacterArt, uid: string): string => {
  const { mouthX: cx, mouthY: cy, mouthW: mw } = art;
  const mh = art.mouthH ?? mw * 0.2;
  const w = mw * 1.26;
  const h = Math.max(mh * 1.36, mw * 0.22);
  const blur = Math.min(3, Math.max(1.2, mw * 0.022));
  const r = (n: number): number => Math.round(n * 100) / 100;
  const skin = esc(art.skin ?? '#d9a97d');
  // 外层轻微羽化边缘，内层完全不透明，保证连吨吨的黑色口腔也被盖干净。
  return `<defs><filter id="mouthPatch-${uid}" x="-25%" y="-60%" width="150%" height="220%">
      <feGaussianBlur stdDeviation="${r(blur)}"/></filter></defs>
    <rect x="${r(cx - w / 2)}" y="${r(cy - h / 2)}" width="${r(w)}" height="${r(h)}"
      rx="${r(h / 2)}" fill="${skin}" filter="url(#mouthPatch-${uid})"/>
    <rect x="${r(cx - w / 2 + blur)}" y="${r(cy - h / 2 + blur)}"
      width="${r(w - blur * 2)}" height="${r(h - blur * 2)}"
      rx="${r((h - blur * 2) / 2)}" fill="${skin}"/>`;
};

const photoMouthSvg = (art: CharacterArt, shape: MouthShape): string => {
  const { mouthX: cx, mouthY: cy, mouthW: mw } = art;
  const lw = Math.max(2.4, mw * 0.055);
  const r = (n: number): number => Math.round(n * 100) / 100;
  if (shape === 'closed') {
    const w = mw * 0.86;
    const h = Math.max(6, mw * 0.18);
    return `<path d="M${r(cx - w / 2)} ${r(cy - h * 0.10)} Q${r(cx)} ${r(cy + h * 0.70)} ${r(cx + w / 2)} ${r(cy - h * 0.10)}" fill="none" stroke="${MOUTH_INK}" stroke-width="${r(lw)}" stroke-linecap="round"/>`;
  }
  const sizes: Record<Exclude<MouthShape, 'closed'>, [number, number]> = {
    small: [1.10, 0.24],
    open: [1.22, 0.44],
    wide: [1.34, 0.72],
  };
  const [wr, hr] = sizes[shape];
  const bw = mw * wr;
  const bh = mw * hr;
  const x = cx - bw / 2;
  // 上缘略高于原嘴中心，嘴以原上唇为锚点向下张开，不会顶到鼻子
  const y = cy - bh * 0.42;
  const tongue = shape === 'small' ? ''
    : `<ellipse cx="${r(cx)}" cy="${r(y + bh * 0.72)}" rx="${r(bw * 0.28)}" ry="${r(bh * 0.18)}" fill="${MOUTH_TONGUE}"/>`;
  return `<rect x="${r(x)}" y="${r(y)}" width="${r(bw)}" height="${r(bh)}" rx="${r(bh / 2)}" fill="${MOUTH_CAVITY}" stroke="${MOUTH_INK}" stroke-width="${r(lw)}"/>${tongue}`;
};

const mouthOverlay = (art: CharacterArt, shape: MouthShape, uid: string): string =>
  `<svg class="mouth-overlay" viewBox="0 0 ${art.width} ${art.height}" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg">
    ${photoMouthPatch(art, uid)}${photoMouthSvg(art, shape)}
  </svg>`;

/** 没有参考图时程序化小人的嘴也跟着动（表情眉眼保持不变）。 */
const FALLBACK_ART: CharacterArt = {
  src: '', width: 240, height: 420, mouthX: 120, mouthY: 182, mouthW: 36,
};

/** 老调用只给 data URI、没给标定数据时，按标准 2:3 立绘取一个安全默认位置。 */
const defaultArt = (src: string): CharacterArt => ({
  src, width: 1024, height: 1536,
  mouthX: 512, mouthY: 384, mouthW: 72,
});

/**
 * 有人物参考图（上传的或资源库选的）就贴真图，没图才回退到程序化 SVG 小人。
 * 说话的人额外叠一层口型：由服务端按配音能量逐帧选择 closed/small/open/wide，
 * 不说话的人保持原图的静态嘴，不会被盖掉。
 */
const characterSvg = (
  character: Character, expression: string, speaking: boolean,
  art?: CharacterArt, mouthShape?: MouthShape,
): string => {
  if (art) {
    return `<div class="person-photo-wrap">
      <div class="photo-blend">
        <img class="person-photo" src="${esc(art.src)}" alt="${esc(character.name)}"/>
        ${speaking && mouthShape ? mouthOverlay(art, mouthShape, esc(character.id)) : ''}
      </div>
    </div>`;
  }
  const look = lookFor(character.id);
  const kind = expressionOf(expression);
  const eyebrow = eyebrows(kind);
  return `
<svg viewBox="0 0 240 420" xmlns="http://www.w3.org/2000/svg" class="person-svg">
  <defs><linearGradient id="shirt-${esc(character.id)}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${look.shirt}"/><stop offset="100%" stop-color="${look.shirtDark}"/></linearGradient></defs>
  <ellipse cx="120" cy="408" rx="96" ry="14" fill="#000" opacity="0.22"/>
  ${look.longHair ? `<path d="M52 132 q-10 130 6 214 l30 -6 q-16 -86 -8 -190 Z" fill="${look.hair}"/>
    <path d="M188 132 q10 130 -6 214 l-30 -6 q16 -86 8 -190 Z" fill="${look.hair}"/>` : ''}
  <path d="M30 420 q4 -118 56 -150 l34 -18 34 18 q52 32 56 150 Z" fill="url(#shirt-${esc(character.id)})"/>
  <path d="M96 252 h48 v44 q-24 18 -48 0 Z" fill="${look.skin}"/>
  <path d="M120 276 l-16 20 16 26 16 -26 Z" fill="${look.shirtDark}" opacity="0.55"/>
  <ellipse cx="120" cy="160" rx="68" ry="80" fill="${look.skin}"/>
  <path d="M52 150 q-4 -96 68 -100 q72 4 68 100 q-18 -46 -68 -48 q-50 2 -68 48 Z" fill="${look.hair}"/>
  <path d="M58 128 q22 -34 62 -34 q40 0 62 34 q-30 -18 -62 -16 q-32 -2 -62 16 Z" fill="${look.hairLight}" opacity="0.75"/>
  <ellipse cx="62" cy="166" rx="10" ry="18" fill="${look.skin}"/>
  <ellipse cx="178" cy="166" rx="10" ry="18" fill="${look.skin}"/>
  ${eyebrow}
  <ellipse cx="96" cy="152" rx="6" ry="8" fill="#2a2225"/><ellipse cx="144" cy="152" rx="6" ry="8" fill="#2a2225"/>
  <circle cx="98" cy="149" r="2" fill="#fff"/><circle cx="146" cy="149" r="2" fill="#fff"/>
  <ellipse cx="78" cy="172" rx="12" ry="7" fill="#e88f81" opacity="0.35"/>
  <ellipse cx="162" cy="172" rx="12" ry="7" fill="#e88f81" opacity="0.35"/>
  ${speaking && mouthShape ? mouthShapeSvg(FALLBACK_ART, mouthShape) : mouth(kind)}
  ${look.beard ? '<path d="M78 188 q42 44 84 0 q-8 42 -42 44 q-34 -2 -42 -44 Z" fill="#4a4038" opacity="0.55"/>' : ''}
  <circle cx="120" cy="330" r="7" fill="${look.accessory}" opacity="0.85"/>
  ${speaking ? '<ellipse cx="120" cy="408" rx="108" ry="18" fill="#fff" opacity="0.16"/>' : ''}
</svg>`;
};

/* -------------------------------------------------------------------------- */
/* 帧组装                                                                      */
/* -------------------------------------------------------------------------- */

export type FrameInput = {
  kind: 'shot' | 'intro' | 'outro';
  projectTitle: string;
  mode: ExportMode;
  index?: number;
  total?: number;
  scene?: Scene | null;
  characters?: Character[];
  speakerId?: string;
  shot?: Shot | null;
  primarySubtitle?: string;
  secondarySubtitle?: string;
  durationSec?: number;
  /** 有真人配音时字幕区不显示「仅字幕」提示 */
  voiceOver?: boolean;
  /**
   * 人物 id → 参考图的内联 data URI（旧调用兼容）。
   * 必须是 data URI：截图时浏览器以 file:// 打开 HTML，`/assets/...` 这种外链加载不到。
   */
  characterImages?: Record<string, string>;
  /** 人物 id → 参考图 + 实测嘴部坐标；优先于 characterImages */
  characterArt?: Record<string, CharacterArt>;
  /** 本帧说话人的口型。不传时保持原来的情绪嘴型（静态预览/测试用） */
  mouthShape?: MouthShape;
};

const MODE_LABEL: Record<ExportMode, string> = {
  zh: '中文版', th: 'ไทย / 泰语版', bilingual: '中泰双语版',
};

const subtitleSizes = (main: string, secondary: string): { main: number; secondary: number } => {
  const len = main.length;
  const mainSize = len > 60 ? 42 : len > 38 ? 50 : len > 22 ? 58 : 66;
  return { main: mainSize, secondary: secondary.length > 60 ? 30 : 36 };
};

const shell = (body: string, p: Palette): string => `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${FRAME_WIDTH}px;height:${FRAME_HEIGHT}px;overflow:hidden;background:${p.skyTop}}
  body{font-family:"Microsoft YaHei","Leelawadee UI","Segoe UI",sans-serif;color:${p.text};
       -webkit-font-smoothing:antialiased;position:relative}
  .art{position:absolute;inset:0;width:100%;height:100%}
  .vignette{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 42%,transparent 34%,rgba(12,10,20,.42) 100%)}
  .top{position:absolute;top:64px;left:64px;right:64px;display:flex;justify-content:space-between;align-items:flex-start;
       text-shadow:0 2px 14px rgba(0,0,0,.45)}
  .brand{font-size:26px;letter-spacing:3px;opacity:.82;font-weight:600}
  .title{font-size:46px;font-weight:800;margin-top:10px;line-height:1.25;max-width:720px}
  .badge{margin-top:14px;display:inline-block;padding:8px 20px;border-radius:999px;font-size:24px;font-weight:600;
         background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.34);backdrop-filter:blur(6px)}
  .shotno{text-align:right;min-width:200px}
  .shotno b{font-size:72px;letter-spacing:2px;line-height:1;font-weight:800}
  .shotno span{display:block;font-size:24px;opacity:.82;margin-top:12px}
  .people{position:absolute;left:0;right:0;bottom:520px;height:660px;display:flex;align-items:flex-end;
          justify-content:center;gap:12px;padding:0 40px}
  .person{width:340px;height:600px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;
          transform-origin:bottom center;transition:none}
  /* 不用 opacity / transform / filter 修饰 .person：它们会创建层叠上下文，
     把里面人物图的 mix-blend-mode 隔离掉，浅色底就没法融进场景。 */
  .person:not(.speaking) .nameplate{opacity:.8}
  .person.speaking{zoom:1.13}
  .person.speaking .person-svg{filter:drop-shadow(0 18px 34px rgba(0,0,0,.42))}
  .person-svg{width:100%;height:100%}
  /* 人物图 + 口型层先在组内正常合成，再整组 multiply 融进场景。
     只让 img 混色的话，口型层的肤色补丁会以原始亮度盖在被压暗的脸上，留一块亮斑；
     组内合成后补丁与脸被同一个场景色压暗，色差消失。 */
  .person-photo-wrap{position:relative;width:100%;height:100%;display:flex;align-items:flex-end;justify-content:center;overflow:hidden}
  .photo-blend{position:absolute;inset:0;mix-blend-mode:multiply;
    -webkit-mask-image:linear-gradient(to bottom,transparent 0%,#000 7%,#000 96%,transparent 100%),
                       linear-gradient(to right,transparent 0%,#000 9%,#000 91%,transparent 100%);
    mask-image:linear-gradient(to bottom,transparent 0%,#000 7%,#000 96%,transparent 100%),
               linear-gradient(to right,transparent 0%,#000 9%,#000 91%,transparent 100%);
    -webkit-mask-composite:source-in;mask-composite:intersect}
  /* 资源库/上传图是纯浅色底：整组 multiply 让底色融进场景，深色描线与服装留下来，
     再叠上下 + 左右渐隐，避免出现「贴了两张白底照片」的硬矩形。 */
  .person-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center bottom;border-radius:24px;
    filter:drop-shadow(0 14px 28px rgba(0,0,0,.34))}
  /* 口型覆盖层与人物图共用 xMidYMax meet / object-fit:contain 的映射，天然对齐 */
  .mouth-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
  .nameplate{margin-bottom:14px;padding:8px 24px;border-radius:999px;font-size:26px;font-weight:700;
             background:rgba(20,18,28,.58);border:1px solid rgba(255,255,255,.24);color:#fff;white-space:nowrap}
  .person.speaking .nameplate{background:${p.accent};color:#1b1420;border-color:rgba(255,255,255,.55)}
  .caption{position:absolute;left:0;right:0;bottom:0;height:660px;
           background:linear-gradient(180deg,rgba(9,10,18,0) 0%,rgba(9,10,18,.62) 34%,rgba(9,10,18,.92) 100%)}
  .caption-inner{position:absolute;left:76px;right:76px;bottom:132px;text-align:center}
  .speaker{display:inline-block;min-width:120px;margin-bottom:22px;padding:10px 30px;border-radius:14px;
           font-size:28px;font-weight:700;letter-spacing:1px;background:${p.accent};color:#1b1420}
  .main{font-size:var(--main-size);font-weight:800;line-height:1.42;letter-spacing:.5px;
        text-shadow:0 3px 18px rgba(0,0,0,.75);word-break:break-word;overflow-wrap:anywhere}
  .secondary{margin-top:22px;font-size:var(--secondary-size);font-weight:500;line-height:1.5;opacity:.86;
             text-shadow:0 2px 12px rgba(0,0,0,.7);word-break:break-word;overflow-wrap:anywhere}
  .meta{position:absolute;left:76px;right:76px;bottom:62px;display:flex;justify-content:space-between;
        align-items:center;font-size:22px;opacity:.72;letter-spacing:1px}
  .progress{position:absolute;left:76px;right:76px;bottom:44px;height:6px;border-radius:6px;background:rgba(255,255,255,.22)}
  .progress i{display:block;height:100%;border-radius:6px;background:${p.accent}}
  .center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
          text-align:center;padding:0 110px;text-shadow:0 4px 24px rgba(0,0,0,.5)}
  .center h1{font-size:96px;font-weight:900;line-height:1.28;letter-spacing:2px}
  .center h2{margin-top:36px;font-size:44px;font-weight:600;opacity:.9;line-height:1.5}
  .center .pill{margin-top:64px;padding:18px 48px;border-radius:999px;font-size:32px;font-weight:700;
                background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.4)}
  .center .rule{margin-top:70px;width:180px;height:6px;border-radius:6px;background:${p.accent}}
  .foot{position:absolute;bottom:88px;left:0;right:0;text-align:center;font-size:26px;opacity:.68;letter-spacing:2px}
</style></head><body>${body}</body></html>`;

/** 主镜头帧：场景插画 + 出场人物 + 双语字幕。 */
export const buildShotFrame = (input: FrameInput): string => {
  const p = paletteFor(input.scene);
  const index = input.index ?? 1;
  const total = input.total ?? 1;
  const main = (input.primarySubtitle ?? '').trim();
  const secondary = (input.secondarySubtitle ?? '').trim();
  const sizes = subtitleSizes(main, secondary);
  const cast = (input.characters ?? []).slice(0, 3);
  const speaker = cast.find((c) => c.id === input.speakerId) ?? cast[0] ?? null;
  const artFor = (c: Character): CharacterArt | undefined => {
    const calibrated = input.characterArt?.[c.id];
    if (calibrated) return calibrated;
    const legacy = input.characterImages?.[c.id];
    return legacy ? defaultArt(legacy) : undefined;
  };
  const people = cast.map((c) => {
    const speaking = c.id === (input.speakerId ?? cast[0]?.id);
    // 名字牌语言跟随导出版本，中文版不再混进泰文名
    const plate = input.mode === 'th' ? (c.nameTh || c.name) : c.name;
    return `<div class="person ${speaking ? 'speaking' : ''}">
      <div class="nameplate">${esc(plate)}</div>
      ${characterSvg(c, `${input.shot?.expression ?? ''} ${input.shot?.action ?? ''}`, speaking, artFor(c), input.mouthShape)}
    </div>`;
  }).join('');
  // 情境/旁白镜头没有出场人物，字幕不署名：旁白不是说话人，不该显示成一个「人」。
  const speakerName = speaker
    ? (input.mode === 'th' ? (speaker.nameTh || speaker.name) : speaker.name)
    : '';
  const sceneLabel = input.mode === 'th'
    ? (input.scene?.name ?? 'กรุงเทพมหานคร')
    : (input.scene?.name ?? p.label);
  const body = `
    ${backgroundSvg(p)}<div class="vignette"></div>
    <div class="top">
      <div>
        <div class="brand">THAI DAILY LIFE · 泰日常</div>
        <div class="title">${esc(input.projectTitle)}</div>
        <div class="badge">${esc(sceneLabel)} · ${esc(MODE_LABEL[input.mode])}</div>
      </div>
      <div class="shotno"><b>NO.${String(index).padStart(2, '0')}</b><span>${index} / ${total} · ${(input.durationSec ?? 0).toFixed(1)}s</span></div>
    </div>
    <div class="people">${people}</div>
    <div class="caption"></div>
    <div class="caption-inner" style="--main-size:${sizes.main}px;--secondary-size:${sizes.secondary}px">
      ${main && speakerName ? `<div class="speaker">${esc(speakerName)}</div>` : ''}
      <div class="main">${esc(main)}</div>
      ${secondary ? `<div class="secondary">${esc(secondary)}</div>` : ''}
    </div>
    <div class="meta"><span>${esc(sceneLabel)}</span><span>${esc(input.shot?.cameraMove ?? '')} · ${esc(input.shot?.shotSize ?? '')}</span></div>
    <div class="progress"><i style="width:${Math.round((index / Math.max(1, total)) * 100)}%"></i></div>`;
  return shell(body, p);
};

/** 片头标题卡。 */
export const buildIntroFrame = (input: FrameInput): string => {
  const p = paletteFor(input.scene);
  const subtitle = input.mode === 'th'
    ? 'เรื่องเล่าชีวิตประจำวันในกรุงเทพมหานคร'
    : input.mode === 'zh' ? '三个曼谷人的一天 · 本地生活小故事' : 'ชีวิตประจำวันกรุงเทพ / 三个曼谷人的一天';
  const body = `${backgroundSvg(p)}<div class="vignette"></div>
    <div class="center">
      <div class="rule"></div>
      <h1>${esc(input.projectTitle)}</h1>
      <h2>${esc(subtitle)}</h2>
      <div class="pill">${esc(MODE_LABEL[input.mode])} · 1080×1920</div>
    </div>
    <div class="foot">THAI DAILY LIFE AI VIDEO · LOCAL RENDER</div>`;
  return shell(body, p);
};

/** 片尾卡。 */
export const buildOutroFrame = (input: FrameInput): string => {
  const p = paletteFor(input.scene);
  const body = `${backgroundSvg(p)}<div class="vignette"></div>
    <div class="center">
      <div class="rule"></div>
      <h1>${input.mode === 'th' ? 'ขอบคุณที่รับชม' : '谢谢观看'}</h1>
      <h2>${esc(input.projectTitle)}</h2>
      <div class="pill">${esc(MODE_LABEL[input.mode])}</div>
    </div>
    <div class="foot">${input.voiceOver ? 'VOICE OVER ENABLED · ' : ''}LOCAL RENDER · H.264 / AAC</div>`;
  return shell(body, p);
};

export const buildFrame = (input: FrameInput): string =>
  input.kind === 'intro' ? buildIntroFrame(input)
    : input.kind === 'outro' ? buildOutroFrame(input)
      : buildShotFrame(input);
