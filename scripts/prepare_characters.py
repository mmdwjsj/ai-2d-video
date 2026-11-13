"""把三张角色立绘处理成可用于动画合成的透明底资产。

1. 颜色键抠掉纯浅灰背景（只做全局颜色键 + 边缘羽化，人物被闭合黑描线包围，
   内部的白鞋 / 眼白 / 米色包不会误删）。
2. 右下角「AI生成 / WORKBUDDY」水印落在人物右侧空白区，直接置透明。
3. 取样脸部肤色，标定嘴部坐标，写入 calibration.json 供动画脚本使用。
4. 产出一张标注预览图，便于人工目检抠图与嘴部标定。

用法：python scripts/prepare_characters.py
"""
from __future__ import annotations

import json
import os
import random
import statistics
from collections import deque
from PIL import Image, ImageDraw, ImageFilter, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'characters')
OUT = os.path.join(SRC, 'cutout')
os.makedirs(OUT, exist_ok=True)

# 坐标均为相对原图宽/高的比例。
# mouthRect 是用 scripts/probe_mouth.py 从原图暗色像素连通域实测得到的嘴部 bbox
# （不是目测估的）。之前按 (0.5, 0.5) 居中硬编码，导致侧头/偏嘴的角色（吨吨）
# 和下巴较长的角色（阿顿）口型整体偏移 20px 以上，看上去像「嘴被扯歪」。
CALIB = {
    'nina': {
        'file': 'nina.png', 'name': '妮娜',
        'mouthRect': (0.4629, 0.2480, 0.5205, 0.2559),
        'top': 0.076, 'bottom': 0.952, 'bbox': (0.330, 0.730),
    },
    'aton': {
        'file': 'aton.png', 'name': '阿顿',
        'mouthRect': (0.4697, 0.2409, 0.5400, 0.2480),
        'top': 0.088, 'bottom': 0.940, 'bbox': (0.290, 0.710),
    },
    'dundun': {
        'file': 'dundun.png', 'name': '吨吨',
        'mouthRect': (0.4678, 0.4564, 0.5811, 0.4948),
        'top': 0.160, 'bottom': 0.885, 'bbox': (0.190, 0.810),
    },
}

# 抹除框相对嘴 bbox 的外扩量（原图像素）：覆盖原嘴描线与唇周，不碰鼻子/下巴线
ERASE_PAD = {'nina': (5, 5), 'aton': (5, 5), 'dundun': (5, 5)}

# 水印矩形起点：往右下全部置透明（人物最右边界约 0.81，不会 overlap）
WATERMARK = (0.855, 0.930)
KEY_TOL = 14          # 背景色容差（单通道最大差）
FEATHER_TOL = 85      # 边缘羽化容差


def maxdiff(a, b) -> int:
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2]))


def cutout(path: str):
    img = Image.open(path).convert('RGBA')
    w, h = img.size
    data = list(img.getdata())
    bg = data[0][:3]
    transparent = bytearray(w * h)
    result = list(data)

    # 只从画面边缘做连通域扩散：白鞋、眼白、米色包等与背景色接近、
    # 但被黑色闭合描线包住的人物内部区域，绝不能被颜色键误删。
    visited = bytearray(w * h)
    queue = deque()
    for x in range(w):
        queue.append((x, 0))
        queue.append((x, h - 1))
    for y in range(h):
        queue.append((0, y))
        queue.append((w - 1, y))
    while queue:
        x, y = queue.popleft()
        i = y * w + x
        if visited[i]:
            continue
        visited[i] = 1
        c = data[i]
        if maxdiff(c, bg) > KEY_TOL:
            continue
        transparent[i] = 1
        result[i] = (c[0], c[1], c[2], 0)
        if x > 0:
            queue.append((x - 1, y))
        if x < w - 1:
            queue.append((x + 1, y))
        if y > 0:
            queue.append((x, y - 1))
        if y < h - 1:
            queue.append((x, y + 1))

    # 水印：强制透明
    wx, wy = int(w * WATERMARK[0]), int(h * WATERMARK[1])
    for y in range(wy, h):
        base = y * w
        for x in range(wx, w):
            transparent[base + x] = 1
            result[base + x] = (bg[0], bg[1], bg[2], 0)

    # 边缘羽化：只处理与透明区相邻的不透明像素，避免误伤人物内部的白色区域
    for y in range(1, h - 1):
        base = y * w
        for x in range(1, w - 1):
            i = base + x
            if transparent[i]:
                continue
            if not (transparent[i - 1] or transparent[i + 1]
                    or transparent[i - w] or transparent[i + w]):
                continue
            c = data[i]
            d = maxdiff(c, bg)
            if d < FEATHER_TOL:
                alpha = max(0, min(255, int(255 * d / FEATHER_TOL)))
                result[i] = (c[0], c[1], c[2], alpha)

    img.putdata(result)
    return img, bg, data


def luminance(c) -> float:
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def mouth_pixels(cfg, w, h):
    """把相对比例嘴 bbox 换算成像素 (x0, y0, x1, y1)。"""
    rx0, ry0, rx1, ry1 = cfg['mouthRect']
    return (int(rx0 * w), int(ry0 * h), int(round(rx1 * w)), int(round(ry1 * h)))


def mouth_center(cfg):
    rx0, ry0, rx1, ry1 = cfg['mouthRect']
    return ((rx0 + rx1) / 2, (ry0 + ry1) / 2)


def erase_mouth(img, cfg, key):
    """把原嘴（描线、嘴腔、舌头及其抗锯齿边）替换成脸部皮肤，生成无嘴底图。

    用扩散式修复（在嘴区做迭代模糊、已知区域每轮还原），而不是纯色填充：
    颜色从四周真实皮肤自然过渡进来，没有矩形边界、没有条纹、也没有比周围
    亮一块的方块。填充范围紧贴实测嘴 bbox 外扩几像素，尽量少改原图。
    """
    w, h = img.size
    mx0, my0, mx1, my1 = mouth_pixels(cfg, w, h)
    padx, pady = ERASE_PAD[key]
    bx0, by0 = max(0, mx0 - padx), max(0, my0 - pady)
    bx1, by1 = min(w - 1, mx1 + padx), min(h - 1, my1 + pady)
    skin = tuple(cfg['skin'])

    def skin_like(c):
        # 皮肤必须是 R>G>B 且绿蓝有明显间隔；舌头/嘴唇是偏红偏蓝的粉色
        # （B≥G），只靠亮度距离会把它误判成皮肤而漏在 hole 外。
        return (c[3] > 0
                and c[0] > c[1] > c[2]
                and (c[1] - c[2]) >= 14
                and abs(c[0] - skin[0]) <= 34
                and abs(c[1] - skin[1]) <= 34
                and abs(c[2] - skin[2]) <= 34)

    # 只在这一小块上迭代，避免整图模糊
    pad = 26
    cx0, cy0 = max(0, bx0 - pad), max(0, by0 - pad)
    cx1, cy1 = min(w - 1, bx1 + pad), min(h - 1, by1 + pad)
    crop = img.crop((cx0, cy0, cx1 + 1, cy1 + 1)).convert('RGBA')
    cw, ch = crop.size
    cpx = crop.load()

    # 框内整块视为待修复区。只挑「非肤色像素」会漏掉唇线的浅色抗锯齿边，
    # 在脸上留下一圈虚线状的嘴形轮廓；框已紧贴嘴 bbox 且不含鼻子/下巴线，
    # 整块填掉不会有副作用。
    hole = Image.new('L', (cw, ch), 0)
    hd = hole.load()
    for y in range(ch):
        for x in range(cw):
            gx, gy = cx0 + x, cy0 + y
            if bx0 <= gx <= bx1 and by0 <= gy <= by1:
                hd[x, y] = 255
    if hole.getbbox() is None:
        return img, 0

    # 初始色：紧贴 hole 的一圈皮肤中位数
    ring = []
    for y in range(ch):
        for x in range(cw):
            if hd[x, y] or not skin_like(cpx[x, y]):
                continue
            near = any(0 <= x + dx < cw and 0 <= y + dy < ch and hd[x + dx, y + dy]
                       for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if near:
                ring.append(cpx[x, y][:3])
    if ring:
        init = tuple(int(statistics.median(v[i] for v in ring)) for i in range(3))
    else:
        init = skin

    known = crop.copy()
    work = crop.copy()
    wp = work.load()
    for y in range(ch):
        for x in range(cw):
            if hd[x, y]:
                wp[x, y] = init + (255,)

    # 迭代扩散：每轮模糊后只取回 hole 区域，已知区域保持原样。
    # 关键：只模糊 RGB，alpha 一律沿用原图——否则 hole 边缘会变成半透明，
    # 把底下的原嘴又透出来（表现为淡淡的粉色/黑色残影）。
    base_alpha = crop.getchannel('A')
    for _ in range(90):
        blurred = work.convert('RGB').filter(ImageFilter.GaussianBlur(4)).convert('RGBA')
        blurred.putalpha(base_alpha)
        work = Image.composite(blurred, known, hole)
    work.putalpha(base_alpha)

    out = img.copy()
    out.paste(work, (cx0, cy0))
    erased = sum(1 for y in range(ch) for x in range(cw) if hd[x, y])
    return out, erased


def sample_skin(data, w, h, mouth) -> tuple[int, int, int]:
    """在嘴部上方取脸部像素的中位数作为肤色，过滤黑描线与高光。"""
    cx, cy = mouth
    samples = []
    for dy in range(int(h * 0.035), int(h * 0.085)):
        y = int(cy * h) - dy
        if y < 0:
            continue
        for dx in range(-int(w * 0.022), int(w * 0.022)):
            x = int(cx * w) + dx
            if x < 0 or x >= w:
                continue
            r, g, b, _a = data[y * w + x]
            if 110 < r < 235 and 60 < g < 190 and 35 < b < 160 and r > g > b:
                samples.append((r, g, b))
    if not samples:
        return (196, 132, 87)
    return (
        int(statistics.median(s[0] for s in samples)),
        int(statistics.median(s[1] for s in samples)),
        int(statistics.median(s[2] for s in samples)),
    )


def main():
    manifest = {'schemaVersion': 1, 'size': None, 'characters': {}}
    previews = []
    clean_previews = []
    for key, cfg in CALIB.items():
        src = os.path.join(SRC, cfg['file'])
        img, bg, data = cutout(src)
        w, h = img.size
        dst = os.path.join(OUT, f'{key}-cutout.png')
        img.save(dst)
        mcx, mcy = mouth_center(cfg)
        skin = sample_skin(data, w, h, (mcx, mcy))
        clean, fixed = erase_mouth(img, {**cfg, 'skin': skin}, key)
        clean.save(os.path.join(OUT, f'{key}-clean.png'))
        rx0, ry0, rx1, ry1 = cfg['mouthRect']
        manifest['size'] = [w, h]
        manifest['characters'][key] = {
            'name': cfg['name'],
            'image': f'assets/characters/cutout/{key}-cutout.png',
            'cleanImage': f'assets/characters/cutout/{key}-clean.png',
            'width': w, 'height': h,
            'backgroundRGB': list(bg),
            'skinRGB': list(skin),
            'mouth': [mcx, mcy],
            'mouthRect': list(cfg['mouthRect']),
            'mouthSize': [(rx1 - rx0) * w, (ry1 - ry0) * h],
            'top': cfg['top'], 'bottom': cfg['bottom'],
            'bbox': list(cfg['bbox']),
        }
        print(f'{key}: {w}x{h} skin={skin} mouth=({mcx:.3f},{mcy:.3f}) '
              f'rect={cfg["mouthRect"]} erasedPx={fixed}')

        for source, bucket, label in ((img, previews, 'cutout'),
                                      (clean, clean_previews, 'clean')):
            small = source.copy()
            small.thumbnail((340, 510))
            sw, sh = small.size
            d = ImageDraw.Draw(small)
            d.rectangle([rx0 * sw, ry0 * sh, rx1 * sw, ry1 * sh],
                        outline=(255, 60, 60), width=2)
            d.ellipse([mcx * sw - 3, mcy * sh - 3, mcx * sw + 3, mcy * sh + 3],
                      outline=(0, 220, 255), width=2)
            tile = Image.new('RGB', (360, 540), (44, 48, 58))
            tile.paste(small, (10, 15), small)
            ImageDraw.Draw(tile).text((10, 518), f'{key} {label}', fill=(230, 230, 230))
            bucket.append(tile)

    cal = os.path.join(SRC, 'calibration.json')
    with open(cal, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    for bucket, name in ((previews, 'preview.png'), (clean_previews, 'preview-clean.png')):
        sheet = Image.new('RGB', (360 * len(bucket), 540), (30, 32, 40))
        for i, tile in enumerate(bucket):
            sheet.paste(tile, (i * 360, 0))
        sheet.save(os.path.join(OUT, name))
    print('calibration:', cal)
    print('previews:', os.path.join(OUT, 'preview.png'),
          os.path.join(OUT, 'preview-clean.png'))


if __name__ == '__main__':
    main()
