"""生成人物六视图资源库总览图：assets/characters/library/overview.png。

一行一个人物、一列一个槽位，纯粹用于人工目检资产是否齐全，不参与渲染。
用法：python scripts/build_library_overview.py
"""
from __future__ import annotations

import json
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, 'assets', 'characters', 'library')
INDEX = os.path.join(LIB, 'index.json')
OUT = os.path.join(LIB, 'overview.png')

CELL_W, CELL_H = 168, 250
ROW_LABEL_W = 92
HEAD_H = 74
PAD = 16
BG = (247, 245, 241)
INK = (41, 37, 35)
SUB = (120, 112, 105)


def font(size):
    for candidate in (
        r'C:\Windows\Fonts\msyh.ttc',
        r'C:\Windows\Fonts\simhei.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ):
        if os.path.exists(candidate):
            try:
                return ImageFont.truetype(candidate, size)
            except OSError:
                continue
    return ImageFont.load_default()


def main():
    with open(INDEX, encoding='utf-8') as fh:
        data = json.load(fh)
    slots = data['slots']
    people = data['characters']
    cols, rows = len(slots), len(people)
    width = PAD * 2 + ROW_LABEL_W + cols * CELL_W
    height = PAD * 2 + HEAD_H + rows * CELL_H
    canvas = Image.new('RGB', (width, height), BG)
    draw = ImageDraw.Draw(canvas)
    title_font, label_font, small_font = font(22), font(15), font(12)

    draw.text((PAD, PAD), '人物六视图资源库 · 总览', fill=INK, font=title_font)
    draw.text((PAD, PAD + 32), f'{rows} 个人物 × {cols} 个槽位 = {rows * cols} 张  ·  assets/characters/library/',
              fill=SUB, font=small_font)

    for col, slot in enumerate(slots):
        x = PAD + ROW_LABEL_W + col * CELL_W
        draw.text((x + 6, PAD + HEAD_H - 22), slot['label'], fill=INK, font=label_font)

    for row, person in enumerate(people):
        y = PAD + HEAD_H + row * CELL_H
        draw.rounded_rectangle(
            (PAD, y + 4, PAD + ROW_LABEL_W - 8, y + CELL_H - 8),
            radius=8, fill=(255, 255, 255), outline=(226, 220, 212),
        )
        draw.text((PAD + 12, y + 24), person['name'], fill=INK, font=label_font)
        draw.text((PAD + 12, y + 48), f"{sum(1 for v in person['images'].values() if v)}/{cols} 张",
                  fill=SUB, font=small_font)
        for col, slot in enumerate(slots):
            x = PAD + ROW_LABEL_W + col * CELL_W
            path = person['images'].get(slot['key'], '')
            cell = Image.new('RGB', (CELL_W - 10, CELL_H - 10), (255, 255, 255))
            full = os.path.join(ROOT, path) if path else ''
            if full and os.path.exists(full):
                img = Image.open(full).convert('RGB')
                scale = min((CELL_W - 14) / img.width, (CELL_H - 14) / img.height)
                img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
                cell.paste(img, ((cell.width - img.width) // 2, (cell.height - img.height) // 2))
            else:
                ImageDraw.Draw(cell).text((12, 20), '缺失', fill=(200, 60, 60), font=small_font)
            canvas.paste(cell, (x, y))
            ImageDraw.Draw(canvas).rectangle(
                (x, y, x + cell.width - 1, y + cell.height - 1), outline=(226, 220, 212),
            )

    canvas.save(OUT)
    print(f'已生成总览图：{OUT}（{width}×{height}）')


if __name__ == '__main__':
    main()
