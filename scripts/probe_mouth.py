"""临时诊断：在原立绘上检测真实嘴部位置，与 calibration.json 的标定值比对。
只读，不改任何资产。
"""
import json
import os
from collections import deque

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'characters')
OUT = os.path.join(ROOT, '.probe', 'mouth')


def luminance(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def skin_mask(data, w, h, skin):
    """与给定肤色相近且不太暗的像素，视为脸/身体皮肤。"""
    mask = bytearray(w * h)
    for i, c in enumerate(data):
        if c[3] == 0:
            continue
        d = max(abs(c[0] - skin[0]), abs(c[1] - skin[1]), abs(c[2] - skin[2]))
        if d <= 34 and luminance(c) > 90:
            mask[i] = 1
    return mask


def components(mask, w, h, min_area=40):
    seen = bytearray(w * h)
    comps = []
    for start in range(w * h):
        if not mask[start] or seen[start]:
            continue
        q = deque([start])
        seen[start] = 1
        px = []
        while q:
            cur = q.popleft()
            px.append(cur)
            y, x = divmod(cur, w)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h:
                        ni = ny * w + nx
                        if mask[ni] and not seen[ni]:
                            seen[ni] = 1
                            q.append(ni)
        if len(px) >= min_area:
            xs = [p % w for p in px]
            ys = [p // w for p in px]
            comps.append({
                'area': len(px),
                'x0': min(xs), 'x1': max(xs),
                'y0': min(ys), 'y1': max(ys),
                'cx': (min(xs) + max(xs)) / 2,
                'cy': (min(ys) + max(ys)) / 2,
            })
    return comps


def main():
    os.makedirs(OUT, exist_ok=True)
    cal = json.load(open(os.path.join(SRC, 'calibration.json'), encoding='utf-8'))

    for key, cfg in cal['characters'].items():
        img = Image.open(os.path.join(SRC, f'{key}.png')).convert('RGBA')
        w, h = img.size
        data = list(img.getdata())
        skin = tuple(cfg['skinRGB'])

        sm = skin_mask(data, w, h, skin)
        comps = sorted(components(sm, w, h, min_area=4000),
                       key=lambda c: c['area'], reverse=True)
        if not comps:
            print(f'{key}: 未找到肤色连通块')
            continue
        face = comps[0]
        fw = face['x1'] - face['x0']
        fh = face['y1'] - face['y0']

        # 只在该连通块的偏下区域找暗色像素（黑描线/嘴腔）
        dark = bytearray(w * h)
        for i, c in enumerate(data):
            if c[3] == 0:
                continue
            x, y = i % w, i // w
            if not (face['x0'] + 6 <= x <= face['x1'] - 6
                    and face['y0'] + 6 <= y <= face['y1'] - 6):
                continue
            if luminance(c) < 120:
                dark[i] = 1

        cands = []
        for c in components(dark, w, h, min_area=25):
            rw = c['x1'] - c['x0']
            rh = c['y1'] - c['y0']
            if c['x0'] < face['x0'] + 10 or c['x1'] > face['x1'] - 10:
                continue
            if rw < fw * 0.05 or rw > fw * 0.45:
                continue
            if rh > fh * 0.30:
                continue
            if abs(c['cx'] - face['cx']) > fw * 0.25:
                continue
            c['relY'] = (c['cy'] - face['y0']) / fh
            cands.append(c)

        # 嘴在脸的下半部；鼻子也在，但更靠上、更窄
        cands.sort(key=lambda c: c['relY'], reverse=True)
        print(f'\n=== {key} 脸 bbox x[{face["x0"]},{face["x1"]}] y[{face["y0"]},{face["y1"]}] '
              f'({fw}x{fh}) 当前标定 mouth={cfg["mouth"]} '
              f'→ 像素 ({cfg["mouth"][0] * w:.0f}, {cfg["mouth"][1] * h:.0f})')
        for c in cands[:5]:
            print(f'  候选 area={c["area"]:5d} box=({c["x0"]},{c["y0"]})-({c["x1"]},{c["y1"]}) '
                  f'w={c["x1"] - c["x0"]:3d} h={c["y1"] - c["y0"]:3d} '
                  f'center=({c["cx"]:.0f},{c["cy"]:.0f}) 相对图=({c["cx"] / w:.3f},{c["cy"] / h:.3f}) '
                  f'脸内relY={c["relY"]:.2f}')

        # 可视化：原图 + 脸框 + 标定十字 + 候选框
        vis = img.convert('RGB').copy()
        d = ImageDraw.Draw(vis)
        d.rectangle([face['x0'], face['y0'], face['x1'], face['y1']],
                    outline=(0, 160, 255), width=3)
        mx, my = cfg['mouth'][0] * w, cfg['mouth'][1] * h
        mbw, mbh = cfg['mouthBox'][0] * w, cfg['mouthBox'][1] * h
        d.rectangle([mx - mbw / 2, my - mbh / 2, mx + mbw / 2, my + mbh / 2],
                    outline=(255, 40, 40), width=4)
        for i, c in enumerate(cands[:5]):
            col = (0, 220, 120) if i == 0 else (255, 200, 0)
            d.rectangle([c['x0'], c['y0'], c['x1'], c['y1']], outline=col, width=3)
        head = vis.crop((max(0, face['x0'] - 60), max(0, face['y0'] - 60),
                         min(w, face['x1'] + 60), min(h, face['y1'] + 60)))
        head = head.resize((head.width * 2, head.height * 2), Image.LANCZOS)
        head.save(os.path.join(OUT, f'{key}-head.png'))
        print(f'  预览: .probe/mouth/{key}-head.png  (红=当前标定 绿=最靠下候选)')


if __name__ == '__main__':
    main()
