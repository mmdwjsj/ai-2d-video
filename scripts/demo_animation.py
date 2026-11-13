"""三角色动画成片：口型由配音能量包络驱动 + 走路动作 + 厨房/客厅/卫生间切换。

独立渲染器，读一份「逐句文案」JSON 出片（1080x1920 / 30fps / H.264+AAC）。
不传 --story 时用内置样片文案，等价于以前直接跑 python scripts/demo_animation.py。

依赖：python -m pip install Pillow edge-tts；系统 ffmpeg / ffprobe；C:/Windows/Fonts 中文字体。
用法：
  python scripts/demo_animation.py                       # 内置样片
  python scripts/demo_animation.py --story story.json    # 自定义文案
  python scripts/demo_animation.py --story s.json --out output/demo/x.mp4 --title 标题 --subtitle 副标题

story.json 格式（数组，一句一个镜头）：
  [{"scene": "kitchen", "char": "nina", "text": "台词", "voice": "zh-CN-XiaoxiaoNeural",
    "name": "妮娜", "action": "talk"}]
  scene 支持 kitchen/living/bath，也接受「厨房/客厅/卫生间/卧室/客厅…」等中文或英文别名；
  未知场景统一退到客厅并在日志里提示。action 可选 talk / walk（walk 会横向走位）。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import subprocess
import time
import wave
from array import array

from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHAR_DIR = os.path.join(ROOT, 'assets', 'characters')
CUTOUT = os.path.join(CHAR_DIR, 'cutout')
TMP = os.path.join(ROOT, '.probe', 'demo')
FRAMES = os.path.join(TMP, 'frames')
OUT_DIR = os.path.join(ROOT, 'output', 'demo')
STILLS = os.path.join(OUT_DIR, 'stills')
OUT_MP4 = os.path.join(OUT_DIR, '样片-三角色动画与场景切换.mp4')

W, H, FPS = 1080, 1920, 30
SR = 48_000
INK = (38, 32, 30)
FONT_BOLD = 'C:/Windows/Fonts/msyhbd.ttc'
FONT_REG = 'C:/Windows/Fonts/msyh.ttc'
PYTHON = 'python'

SCENE_LABEL = {
    'kitchen': '厨房', 'living': '客厅', 'bath': '卫生间',
    'bedroom': '卧室', 'mall': '商场', 'street': '大街', 'car': '车内',
}

# 场景名 → 内置场景 key。文案里写中文、写英文、或者干脆不写（靠 infer_scene 猜）都行。
SCENE_ALIASES = {
    'kitchen': 'kitchen', '厨房': 'kitchen', '灶台': 'kitchen', '餐厅': 'kitchen', '饭厅': 'kitchen', '灶': 'kitchen',
    'living': 'living', '客厅': 'living', '起居室': 'living', '沙发': 'living', '门口': 'living', '家': 'living',
    'bath': 'bath', '卫生间': 'bath', '浴室': 'bath', '洗手间': 'bath', '厕所': 'bath', '洗漱': 'bath',
    'bedroom': 'bedroom', '卧室': 'bedroom', '房间': 'bedroom', '床': 'bedroom', '睡房': 'bedroom', '主卧': 'bedroom',
    'mall': 'mall', '商场': 'mall', '购物': 'mall', '超市': 'mall', '商店': 'mall', '逛街': 'mall', '便利店': 'mall',
    'street': 'street', '大街': 'street', '街道': 'street', '马路': 'street', '路上': 'street', '街上': 'street', '小区': 'street',
    'car': 'car', '车内': 'car', '车里': 'car', '开车': 'car', '车上': 'car', '副驾': 'car', '驾驶': 'car',
}

# 没写 scene 时按台词关键词猜场景：命中一个词得 1 分，取最高分；平分按 dict 顺序。
SCENE_KEYWORDS = {
    'bedroom': ['卧室', '床上', '睡觉', '被子', '枕头', '睡衣', '晚安', '起床', '换衣服', '闹钟'],
    'bath': ['洗手间', '卫生间', '浴室', '洗脸', '刷牙', '洗澡', '洗手', '镜子', '马桶'],
    'kitchen': ['厨房', '做饭', '炒菜', '汤', '锅', '灶', '餐桌', '吃饭', '洗碗', '冰箱', '饭菜'],
    'mall': ['商场', '购物', '超市', '买', '货架', '收银', '结账', '逛街', '促销', '试衣', '奶茶', '电影'],
    'street': ['大街', '路边', '街上', '马路', '红绿灯', '公交', '地铁', '散步', '下雨', '外面', '楼下', '公园'],
    'car': ['开车', '车里', '车上', '副驾', '方向盘', '堵车', '导航', '高速', '停车', '打车', '油'],
    'living': ['客厅', '沙发', '电视', '茶几', '回家', '门口', '拖鞋'],
}

BACKGROUND_DIR = os.path.join(ROOT, 'assets', 'backgrounds')

CHAR_VOICE = {
    'nina': 'zh-CN-XiaoxiaoNeural',
    'aton': 'zh-CN-YunxiNeural',
    'dundun': 'zh-CN-YunxiaNeural',
}
CHAR_NAME = {'nina': '妮娜', 'aton': '阿顿', 'dundun': '吨吨'}

SAMPLE_LINES = [
    {'scene': 'kitchen', 'char': 'nina', 'name': '妮娜',
     'text': '吨吨，晚饭快好了，冬阴功汤马上就好！',
     'voice': 'zh-CN-XiaoxiaoNeural', 'action': 'talk'},
    {'scene': 'living', 'char': 'aton', 'name': '阿顿',
     'text': '我先把桌子收一下，等会儿一起吃。',
     'voice': 'zh-CN-YunxiNeural', 'action': 'walk'},
    {'scene': 'bath', 'char': 'dundun', 'name': '吨吨',
     'text': '我先去洗手，妈妈说吃饭前要洗手！',
     'voice': 'zh-CN-YunxiaNeural', 'action': 'talk'},
]

INTRO_FRAMES = 36
OUTRO_FRAMES = 45
PAD_BEFORE = 0.35
PAD_AFTER = 0.55


def run(args, timeout=180):
    r = subprocess.run(args, capture_output=True, timeout=timeout)
    if r.returncode != 0:
        tail = r.stderr.decode('utf-8', 'replace')[-600:]
        raise RuntimeError(f'命令失败 {args[0]}: {tail}')
    return r


def font(size, bold=True):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


def box(d, rect_, fill, width=7, radius=0, outline=INK):
    if radius:
        d.rounded_rectangle(rect_, radius=radius, fill=fill, outline=outline, width=width)
    else:
        d.rectangle(rect_, fill=fill, outline=outline, width=width)


# --------------------------------------------------------------------------
# 场景背景：与角色同风格的粗描线 + 纯色平涂
# --------------------------------------------------------------------------

def make_backgrounds():
    bgs = {}

    # 厨房：瓷砖墙、窗、橱柜、灶台、汤锅
    img = Image.new('RGB', (W, H), (240, 228, 202))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 1180], fill=(238, 226, 198))
    for x in range(0, W, 120):
        d.line([(x, 540), (x, 920)], fill=(214, 205, 181), width=3)
    for y in range(540, 921, 95):
        d.line([(0, y), (W, y)], fill=(214, 205, 181), width=3)
    box(d, [70, 130, 400, 510], (174, 214, 228), radius=16)
    d.line([(235, 130), (235, 510)], fill=INK, width=6)
    d.line([(70, 320), (400, 320)], fill=INK, width=6)
    box(d, [470, 170, 1010, 430], (198, 156, 112), radius=12)   # 吊柜
    d.line([(740, 170), (740, 430)], fill=INK, width=6)
    d.ellipse([690, 285, 712, 307], fill=(60, 48, 40))
    d.ellipse([768, 285, 790, 307], fill=(60, 48, 40))
    box(d, [430, 780, 1030, 1180], (176, 132, 92), radius=10)    # 地柜
    d.line([(730, 780), (730, 1180)], fill=INK, width=6)
    box(d, [430, 740, 1030, 790], (224, 216, 202), width=6)      # 台面
    d.ellipse([560, 660, 860, 760], fill=(196, 202, 206), outline=INK, width=7)  # 汤锅
    d.ellipse([590, 668, 830, 716], fill=(226, 146, 78), outline=INK, width=4)
    d.arc([610, 600, 680, 668], 180, 350, fill=(255, 255, 255), width=6)
    d.arc([720, 585, 790, 660], 190, 350, fill=(255, 255, 255), width=6)
    d.rectangle([0, 1180, W, H], fill=(196, 160, 120))
    d.line([(0, 1180), (W, 1180)], fill=INK, width=9)
    bgs['kitchen'] = img

    # 客厅：沙发、茶几、挂画、落地窗、地毯、门
    img = Image.new('RGB', (W, H), (246, 232, 212))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 1180], fill=(246, 232, 212))
    box(d, [70, 140, 330, 430], (226, 196, 150), radius=10)      # 挂画
    box(d, [96, 166, 304, 404], (150, 190, 176), radius=6, width=4)
    d.ellipse([150, 220, 230, 300], fill=(240, 206, 128), outline=INK, width=4)
    box(d, [700, 120, 1010, 700], (176, 214, 228), radius=12)    # 落地窗
    d.line([(855, 120), (855, 700)], fill=INK, width=6)
    d.line([(700, 410), (1010, 410)], fill=INK, width=6)
    box(d, [120, 700, 800, 1080], (214, 126, 92), radius=28)     # 沙发
    box(d, [150, 730, 430, 930], (234, 158, 118), radius=20, width=5)
    box(d, [470, 730, 770, 930], (234, 158, 118), radius=20, width=5)
    d.line([(120, 930), (800, 930)], fill=INK, width=6)
    box(d, [400, 1000, 760, 1120], (170, 126, 88), radius=14)    # 茶几
    d.ellipse([500, 950, 620, 1010], fill=(228, 236, 222), outline=INK, width=5)
    d.rectangle([0, 1180, W, H], fill=(186, 152, 116))
    d.line([(0, 1180), (W, 1180)], fill=INK, width=9)
    d.ellipse([60, 1230, 1020, 1600], fill=(214, 178, 138), outline=INK, width=6)
    bgs['living'] = img

    # 卫生间：蓝白瓷砖、圆镜、洗手台、水龙头、毛巾、马桶
    img = Image.new('RGB', (W, H), (224, 238, 240))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 1180], fill=(216, 234, 238))
    for x in range(0, W, 108):
        d.line([(x, 0), (x, 1180)], fill=(186, 214, 220), width=3)
    for y in range(0, 1181, 108):
        d.line([(0, y), (W, y)], fill=(186, 214, 220), width=3)
    box(d, [340, 130, 740, 620], (198, 224, 230), radius=180, width=9)  # 圆镜
    d.arc([380, 170, 700, 490], 200, 290, fill=(255, 255, 255), width=12)
    box(d, [230, 720, 850, 900], (248, 248, 244), radius=26)     # 洗手台
    d.ellipse([300, 740, 780, 870], fill=(206, 226, 230), outline=INK, width=6)
    d.line([(540, 640), (540, 750)], fill=(120, 132, 136), width=14)
    d.arc([500, 620, 580, 700], 180, 0, fill=(120, 132, 136), width=12)
    box(d, [850, 420, 1010, 620], (242, 176, 138), radius=10)    # 毛巾
    d.line([(850, 520), (1010, 520)], fill=INK, width=4)
    box(d, [80, 880, 300, 1180], (246, 246, 242), radius=30)     # 马桶侧影
    d.rectangle([0, 1180, W, H], fill=(182, 206, 210))
    d.line([(0, 1180), (W, 1180)], fill=INK, width=9)
    bgs['bath'] = img
    return bgs


# --------------------------------------------------------------------------
# 场景库：新增场景按同一套「粗描线 + 平涂」规则画，人物站位通过 baseline/scale
# 控制；car 这类需要挡住下半身的场景用 fg 前景层（盖在人物之上）。
# --------------------------------------------------------------------------

BASE_SPEC = {'baseline': 1380, 'scale': 1.0, 'fg': None}


def _floor(d, color, y=1180):
    d.rectangle([0, y, W, H], fill=color)
    d.line([(0, y), (W, y)], fill=INK, width=9)


def _bg_bedroom():
    img = Image.new('RGB', (W, H), (240, 228, 228))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 900], fill=(240, 228, 228))
    d.rectangle([0, 900, W, 1180], fill=(222, 205, 207))
    d.line([(0, 900), (W, 900)], fill=INK, width=6)
    _floor(d, (188, 152, 116))

    # 右墙窗 + 窗帘
    box(d, [700, 210, 1015, 780], (176, 212, 230), radius=12)
    d.line([(858, 210), (858, 780)], fill=INK, width=6)
    d.line([(700, 495), (1015, 495)], fill=INK, width=6)
    box(d, [646, 168, 714, 806], (226, 158, 162), radius=10)
    box(d, [1002, 168, 1066, 806], (226, 158, 162), radius=10)
    box(d, [700, 150, 1015, 200], (206, 132, 138), radius=8)

    # 床（左侧，人物从床前走过）
    box(d, [40, 790, 400, 1180], (190, 158, 122), radius=16)
    box(d, [60, 690, 380, 832], (250, 248, 246), radius=18)
    box(d, [84, 636, 250, 730], (252, 250, 244), radius=14)
    box(d, [236, 690, 400, 1180], (206, 138, 152), radius=14)
    d.line([(236, 838), (400, 838)], fill=INK, width=5)

    # 床头柜 + 台灯
    box(d, [860, 900, 1035, 1180], (176, 136, 100), radius=12)
    d.rectangle([936, 826, 960, 900], fill=(122, 126, 134), outline=INK, width=4)
    box(d, [886, 758, 1010, 830], (250, 226, 170), radius=12)

    # 挂画（左上）
    box(d, [96, 210, 280, 372], (226, 196, 150), radius=10)
    box(d, [116, 232, 260, 350], (168, 198, 186), radius=6, width=4)

    # 地毯
    d.ellipse([110, 1250, 980, 1620], fill=(206, 178, 190), outline=INK, width=6)
    return img


def _bg_mall():
    img = Image.new('RGB', (W, H), (238, 240, 244))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 260], fill=(226, 230, 238))
    for cx in (170, 430, 690, 950):
        d.ellipse([cx - 70, 96, cx + 70, 136], fill=(255, 252, 226), outline=INK, width=5)
    d.line([(0, 260), (W, 260)], fill=INK, width=8)
    d.rectangle([0, 260, W, 1180], fill=(238, 232, 224))

    # 左右店铺：橱窗 + 招牌（橱窗里挂两排衣服，避免看起来像电梯厅）
    box(d, [0, 300, 300, 1180], (232, 226, 218), radius=0)
    d.rectangle([20, 360, 280, 760], fill=(198, 222, 236), outline=INK, width=7)
    d.rectangle([20, 300, 280, 356], fill=(228, 108, 96), outline=INK, width=7)
    d.rectangle([780, 360, 1060, 760], fill=(198, 222, 236), outline=INK, width=7)
    d.rectangle([780, 300, 1060, 356], fill=(120, 176, 208), outline=INK, width=7)
    for x0, x1 in ((20, 280), (780, 1060)):
        d.line([(x0 + 16, 470), (x1 - 16, 470)], fill=INK, width=6)
        for cx in range(x0 + 40, x1 - 20, 62):
            d.rectangle([cx, 476, cx + 44, 580], fill=(240, 196, 132), outline=INK, width=4)
        d.rectangle([x0 + 16, 640, x1 - 16, 748], fill=(176, 202, 216), outline=INK, width=4)
        d.line([(x0 + 16, 694), (x1 - 16, 694)], fill=INK, width=4)

    # 中间电梯 + 楼层指示牌
    box(d, [400, 470, 680, 1120], (204, 210, 218), radius=8)
    d.line([(540, 470), (540, 1120)], fill=INK, width=6)
    box(d, [368, 330, 712, 442], (250, 226, 168), radius=10)
    for bx in (410, 520, 630):
        d.rectangle([bx, 366, bx + 60, 406], fill=(220, 120, 96), outline=INK, width=4)

    # 绿植
    for cx in (338, 742):
        box(d, [cx - 46, 1040, cx + 46, 1180], (188, 122, 92), radius=8)
        d.ellipse([cx - 98, 890, cx + 98, 1082], fill=(150, 196, 132), outline=INK, width=6)

    _floor(d, (214, 208, 198))
    for i in range(-4, 5):
        d.line([(540 + i * 120, 1180), (540 + i * 460, H)], fill=(198, 192, 182), width=3)
    for y in range(1240, H, 120):
        d.line([(0, y), (W, y)], fill=(198, 192, 182), width=3)
    return img


def _bg_street():
    img = Image.new('RGB', (W, H), (170, 208, 232))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 900], fill=(170, 208, 232))
    d.rectangle([320, 430, 760, 900], fill=(208, 196, 186))
    box(d, [0, 250, 320, 900], (196, 180, 168), radius=0)
    box(d, [760, 210, 1080, 900], (188, 172, 160), radius=0)
    for y in range(300, 860, 90):
        for x in range(30, 290, 80):
            d.rectangle([x, y, x + 46, y + 50], fill=(236, 226, 206), outline=INK, width=3)
    for y in range(260, 860, 90):
        for x in range(790, 1050, 80):
            d.rectangle([x, y, x + 46, y + 50], fill=(236, 226, 206), outline=INK, width=3)

    d.rectangle([0, 900, W, 1180], fill=(112, 116, 128))
    for x in (170, 540, 910):
        d.rectangle([x - 62, 1116, x + 62, 1140], fill=(248, 246, 238))
    _floor(d, (210, 200, 188))
    for x in range(0, W, 140):
        d.line([(x, 1180), (x - 60, H)], fill=(192, 182, 170), width=3)

    # 路灯
    d.rectangle([96, 400, 118, 1230], fill=(96, 100, 110), outline=INK, width=4)
    d.arc([40, 320, 176, 440], 200, 340, fill=INK, width=8)
    d.ellipse([36, 376, 104, 428], fill=(255, 236, 170), outline=INK, width=6)

    # 行道树
    d.rectangle([900, 940, 936, 1210], fill=(132, 96, 68), outline=INK, width=5)
    d.ellipse([806, 750, 1034, 976], fill=(146, 194, 130), outline=INK, width=7)
    return img


def _bg_car():
    """车外视角透过挡风玻璃看司机：前景仪表台 + 方向盘压住下半身，形成坐姿遮挡。"""
    bg = Image.new('RGB', (W, H), (54, 52, 58))
    d = ImageDraw.Draw(bg)
    # 挡风玻璃内的街景：天空 → 楼 → 路面
    d.rectangle([120, 150, 960, 1210], fill=(172, 208, 232))
    d.rectangle([120, 520, 300, 880], fill=(198, 186, 174))
    d.rectangle([770, 560, 960, 880], fill=(190, 178, 166))
    for y in range(580, 860, 70):
        for x in range(140, 290, 60):
            d.rectangle([x, y, x + 34, y + 34], fill=(232, 224, 208))
    d.rectangle([120, 880, 960, 1210], fill=(116, 120, 132))
    for x in (250, 540, 830):
        d.rectangle([x - 70, 1146, x + 70, 1174], fill=(248, 246, 238))

    # 座椅：靠背 + 头枕（窄一点、浅一点，别把画面压成一块黑板）
    d.rounded_rectangle([372, 560, 708, 940], radius=64, fill=(88, 84, 92), outline=INK, width=8)
    d.rounded_rectangle([414, 430, 666, 604], radius=64, fill=(98, 94, 102), outline=INK, width=8)
    d.rounded_rectangle([438, 454, 642, 586], radius=48, fill=(108, 104, 112))

    # 车顶、A 柱、门框（把窗外景色框起来）
    d.rectangle([0, 0, W, 150], fill=(48, 46, 52))
    d.rectangle([0, 0, 120, H], fill=(52, 50, 56))
    d.rectangle([960, 0, W, H], fill=(52, 50, 56))
    d.line([(120, 150), (960, 150)], fill=INK, width=10)
    d.line([(120, 150), (120, 1210)], fill=INK, width=10)
    d.line([(960, 150), (960, 1210)], fill=INK, width=10)
    d.line([(120, 1210), (960, 1210)], fill=INK, width=10)

    # 遮阳板 + 车内后视镜：都放在挡风玻璃顶部，避免和左上角标题牌打架
    d.rectangle([120, 150, 960, 208], fill=(56, 52, 60), outline=INK, width=6)
    d.rounded_rectangle([430, 214, 650, 282], radius=22, fill=(70, 66, 74), outline=INK, width=7)
    d.rounded_rectangle([442, 226, 638, 270], radius=16, fill=(126, 156, 182))

    # 仪表台（背景层，人物站在它后面）
    d.rectangle([0, 1210, W, H], fill=(64, 60, 68))
    d.line([(0, 1210), (W, 1210)], fill=INK, width=10)
    d.rounded_rectangle([140, 1250, 420, 1326], radius=14, fill=(46, 44, 50), outline=INK, width=5)
    d.rounded_rectangle([660, 1250, 940, 1326], radius=14, fill=(46, 44, 50), outline=INK, width=5)

    # 前景：安全带 + 仪表台立面 + 方向盘（安全带是最省事的「坐姿」暗示）
    fg = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    f = ImageDraw.Draw(fg)
    f.line([(448, 986), (656, 1490)], fill=INK + (255,), width=38)
    f.line([(448, 986), (656, 1490)], fill=(52, 58, 74, 255), width=24)
    f.rounded_rectangle([604, 1352, 668, 1420], radius=12,
                        fill=(198, 202, 212, 255), outline=INK + (255,), width=5)
    f.rounded_rectangle([-40, 1470, W + 40, H + 40], radius=90,
                        fill=(52, 48, 56, 255), outline=INK + (255,), width=10)
    f.ellipse([356, 1424, 744, 1812], outline=INK + (255,), width=34)
    f.ellipse([396, 1464, 704, 1772], outline=(44, 40, 48, 255), width=16)
    f.rectangle([524, 1632, 576, 1812], fill=(44, 40, 48, 255))
    f.rectangle([356, 1604, 744, 1648], fill=(44, 40, 48, 255))
    f.ellipse([770, 1514, 906, 1650], outline=INK + (255,), width=12)
    f.ellipse([798, 1542, 878, 1622], fill=(150, 210, 226, 255), outline=INK + (255,), width=6)
    return bg, fg


def _cover(path):
    """把任意尺寸的外部背景铺满 1080×1920（等比放大后居中裁切）。"""
    img = Image.open(path).convert('RGB')
    s = max(W / img.width, H / img.height)
    img = img.resize((max(W, int(img.width * s + 0.5)), max(H, int(img.height * s + 0.5))), Image.LANCZOS)
    left = (img.width - W) // 2
    top = (img.height - H) // 2
    return img.crop((left, top, left + W, top + H))


def _custom_scenes():
    """assets/backgrounds/ 里丢一张图就等于新增一个场景，文件名就是场景名。"""
    specs = {}
    if not os.path.isdir(BACKGROUND_DIR):
        return specs
    for name in sorted(os.listdir(BACKGROUND_DIR)):
        stem, ext = os.path.splitext(name)
        if ext.lower() not in ('.png', '.jpg', '.jpeg', '.webp'):
            continue
        key = stem.strip()
        if not key:
            continue
        try:
            img = _cover(os.path.join(BACKGROUND_DIR, name))
        except Exception as exc:                                  # noqa: BLE001
            print(f'  [警告] 背景 {name} 读取失败：{exc}', file=sys.stderr)
            continue
        specs[key] = dict(BASE_SPEC, bg=img)
        SCENE_ALIASES[key] = key        # 自定义背景优先于内置别名
        SCENE_LABEL.setdefault(key, key)
    return specs


def build_scenes():
    specs = {k: dict(BASE_SPEC, bg=v) for k, v in make_backgrounds().items()}
    specs['bedroom'] = dict(BASE_SPEC, bg=_bg_bedroom())
    specs['mall'] = dict(BASE_SPEC, bg=_bg_mall())
    specs['street'] = dict(BASE_SPEC, bg=_bg_street())
    bg, fg = _bg_car()
    # 车内：人物放大一点、站位下移，仪表台从胸口以下挡住（只露上半身）
    specs['car'] = dict(BASE_SPEC, bg=bg, fg=fg, baseline=1830, scale=0.95)
    specs.update(_custom_scenes())
    return specs


def infer_scene(text):
    """没写 scene 时按台词关键词猜场景，命中词多者胜，全不中返回空串。"""
    best, best_score = '', 0
    for key, words in SCENE_KEYWORDS.items():
        score = sum(1 for w in words if w in text)
        if score > best_score:
            best, best_score = key, score
    return best


def shift_blend(a, b, p):
    """横向推移转场：旧场景向左移出，新场景从右侧跟进。"""
    dx = int(W * max(0.0, min(1.0, p)))
    if dx <= 0:
        return a.copy()
    if dx >= W:
        return b.copy()
    out = a.copy()
    out.paste(a.crop((dx, 0, W, H)), (0, 0))
    out.paste(b.crop((W - dx, 0, W, H)), (W - dx, 0))
    return out


# --------------------------------------------------------------------------
# 图层：人物、口型、字幕
# --------------------------------------------------------------------------

def load_character(calib, key, target_h):
    # 用「无嘴底图」：原嘴已在预处理阶段按实测 bbox 抹掉，
    # 四档口型全部由 mouth_tiles 按同一实测坐标绘制，不会出现两个嘴或偏移。
    img = Image.open(os.path.join(CUTOUT, f'{key}-clean.png')).convert('RGBA')
    h = target_h
    w = int(img.width * h / img.height)
    return img.resize((w, h), Image.LANCZOS), calib[key]


def mouth_tiles(cal, pw, ph):
    """按实测嘴部尺寸生成四档口型贴图，中心严格对齐实测嘴中心。

    尺寸基准取「原图实测嘴宽」按人物缩放后的像素值，而不是固定的相对框：
    阿顿嘴宽 72px、吨吨 116px，用同一套相对框会把小嘴画得过大、盖住下巴。
    """
    scale = pw / cal['width']
    mw = max(18.0, cal['mouthSize'][0] * scale)
    lw = max(3, int(round(mw * 0.055)))

    # 口型几何：(宽, 上缘偏移, 高)，单位都是嘴宽 mw，偏移以嘴中心为基准。
    # 张嘴必须以上唇为锚点向下拉开——从中心对称放大会让上唇顶到鼻子。
    shapes = {
        'small': (0.66, -0.06, 0.30),
        'open': (0.78, -0.08, 0.46),
        'wide': (0.60, -0.09, 0.56),
    }
    closed_w, closed_h = 0.92, 0.30
    # 3 倍超采样绘制再缩小：直接按目标尺寸画弧线会出现明显的像素阶梯
    SS = 3
    mw_s = mw * SS
    lw_s = lw * SS
    up = 0.20 * mw_s
    down = max(s[2] + s[1] for s in shapes.values()) * mw_s
    tw = int(max([closed_w] + [s[0] for s in shapes.values()]) * mw_s * 1.30)
    # tile 以嘴中心为中心，贴图时按中心对齐即可，不需要额外锚点
    th = int(2 * max(up, down) * 1.15) + lw_s * 4
    tw, th = max(tw, 24 * SS), max(th, 20 * SS)
    cx, cy = tw // 2, th // 2

    tiles = {}
    for kind in ('closed', 'small', 'open', 'wide'):
        tile = Image.new('RGBA', (tw, th), (0, 0, 0, 0))
        d = ImageDraw.Draw(tile)
        if kind == 'closed':
            bw = closed_w * mw_s
            bh = closed_h * mw_s
            d.arc([cx - bw / 2, cy - bh * 0.62, cx + bw / 2, cy + bh * 0.38],
                  15, 165, fill=INK + (255,), width=lw_s)
        else:
            wr, off, hr = shapes[kind]
            bw, bh = wr * mw_s, hr * mw_s
            top = cy + off * mw_s
            box = [cx - bw / 2, top, cx + bw / 2, top + bh]
            d.ellipse(box, fill=(94, 44, 52, 255), outline=INK + (255,), width=lw_s)
            if kind in ('open', 'wide'):
                # 舌头：张嘴时露出下唇内侧，和原立绘画法一致
                d.ellipse([cx - bw * 0.30, top + bh * 0.56,
                           cx + bw * 0.30, top + bh * 0.94],
                          fill=(206, 112, 120, 255))
        tiles[kind] = tile.resize((max(1, tw // SS), max(1, th // SS)), Image.LANCZOS)
    return tiles


PUNCT = '，。！？、；：'


_MEASURE = ImageDraw.Draw(Image.new('RGB', (8, 8)))


def wrap_by_width(text, fnt, max_width):
    """按像素宽度断行：中英混排、泰文都不会越出画面。"""
    rows, cur = [], ''
    for ch in text:
        if ch == '\n':
            rows.append(cur)
            cur = ''
            continue
        if _MEASURE.textlength(cur + ch, font=fnt) <= max_width:
            cur += ch
            continue
        cut = max((i + 1 for i, c in enumerate(cur) if c in PUNCT), default=-1)
        if cut > len(cur) * 0.6:
            rows.append(cur[:cut])
            cur = cur[cut:] + ch
        else:
            rows.append(cur)
            cur = ch
    if cur:
        rows.append(cur)
    return rows or ['']


def fit_caption(text, max_width=None):
    """文案长短不可控：从 56 号往下缩，保证不超过 3 行、不出画。"""
    limit = max_width or (W - 150)
    rows, size = [text], 56
    for size in (56, 52, 48, 44, 40, 36):
        rows = wrap_by_width(text, font(size), limit)
        # 末行只剩一两个字（如「钟。」）说明断点难看，降一号再试
        tail_ok = len(rows) == 1 or len(rows[-1]) > 2
        if len(rows) <= 3 and tail_ok:
            return rows, size
    return rows[:3], 36


def caption_layer(line, index, total):
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # 顶部信息
    d.rounded_rectangle([60, 56, 420, 126], radius=34,
                        fill=(20, 22, 32, 150), outline=(255, 255, 255, 70), width=2)
    d.text((88, 68), f'{SCENE_LABEL[line["scene"]]} · 第 {index + 1}/{total} 幕',
           font=font(38), fill=(255, 255, 255, 240))
    d.text((W - 70, 66), '泰日常 · 样片', font=font(32, False),
           fill=(48, 44, 52, 235), anchor='ra')
    # 底部渐暗字幕区（人物脚在 y≈1380，字幕从 y≈1530 起，不再压住鞋）
    for i in range(560):
        a = int(220 * (i / 560) ** 1.7)
        d.line([(0, H - 560 + i), (W, H - 560 + i)], fill=(9, 11, 20, a))
    # 说话者名字牌
    d.rounded_rectangle([76, H - 500, 76 + 44 + len(line['name']) * 46, H - 412],
                        radius=18, fill=(255, 190, 96, 245))
    d.text((98, H - 486), line['name'], font=font(44), fill=(28, 22, 18, 255))
    # 主字幕：整块垂直居中在 y≈1660，行数变化时不会顶到名字牌或压出画面
    rows, size = fit_caption(line['text'])
    gap = size * 1.38
    center0 = 1660 - (len(rows) - 1) * gap / 2
    for i, row in enumerate(rows):
        d.text((W // 2, center0 + i * gap), row, font=font(size),
               fill=(255, 255, 255, 255), anchor='mm',
               stroke_width=3, stroke_fill=(0, 0, 0, 190))
    return layer


def outro_banner():
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle([W // 2 - 330, 80, W // 2 + 330, 176], radius=46,
                        fill=(20, 22, 32, 175))
    d.text((W // 2, 128), '饭要一起吃 · 未完待续', font=font(44),
           fill=(255, 255, 255, 245), anchor='mm')
    return layer


def title_layer(main, sub, badge=''):
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(H):
        a = int(150 * (1 - abs(i - H / 2) / (H / 2)) ** 2)
        d.line([(0, i), (W, i)], fill=(12, 14, 24, a))
    d.text((W // 2, 790), main, font=font(96), fill=(255, 255, 255, 255),
           anchor='mm', stroke_width=4, stroke_fill=(0, 0, 0, 200))
    d.text((W // 2, 950), sub, font=font(46, False), fill=(255, 232, 196, 255), anchor='mm')
    if badge:
        d.rounded_rectangle([W // 2 - 200, 1040, W // 2 + 200, 1128], radius=44,
                            fill=(255, 190, 96, 235))
        d.text((W // 2, 1084), badge, font=font(40), fill=(28, 22, 18, 255), anchor='mm')
    return layer


# --------------------------------------------------------------------------
# 配音与音频包络
# --------------------------------------------------------------------------

def synth(index, line):
    # 按「文本 + 音色」哈希做缓存：换文案后不会误用上一轮同序号的配音
    key = hashlib.md5(f'{line["voice"]}|{line["text"]}'.encode('utf-8')).hexdigest()[:12]
    mp3 = os.path.join(TMP, f'voice-{key}.mp3')
    wav = os.path.join(TMP, f'voice-{key}.wav')
    if not os.path.exists(mp3) or os.path.getsize(mp3) < 1024:
        # 半截文件直接覆盖写（edge-tts 以 wb 打开），不做删除
        run([PYTHON, '-m', 'edge_tts', '--text', line['text'],
             '--voice', line['voice'], '--write-media', mp3], 90)
    if not os.path.exists(wav) or os.path.getsize(wav) < 1024:
        run(['ffmpeg', '-y', '-i', mp3, '-ar', str(SR), '-ac', '1',
             '-c:a', 'pcm_s16le', wav], 90)
    with wave.open(wav, 'rb') as f:
        samples = array('h')
        samples.frombytes(f.readframes(f.getnframes()))
    return samples, len(samples) / SR


def energy_prefix(samples):
    p = array('q', [0])
    total = 0
    for v in samples:
        total += v * v
        p.append(total)
    return p


def rms_at(prefix, t):
    i0 = int(t * SR)
    i1 = min(len(prefix) - 1, i0 + SR // FPS)
    if i1 <= i0 or i0 < 0:
        return 0.0
    return math.sqrt(max(0, prefix[i1] - prefix[i0]) / (i1 - i0))


def level_to_kind(v):
    if v < 0.10:
        return 'closed'
    if v < 0.28:
        return 'small'
    if v < 0.62:
        return 'open'
    return 'wide'


def build_soundtrack(segments, total_frames):
    n = int(total_frames / FPS * SR) + SR
    stereo = array('h', [0]) * (n * 2)
    for seg in segments:
        start = int((seg['start'] / FPS + PAD_BEFORE) * SR)
        for j, v in enumerate(seg['samples']):
            pos = (start + j) * 2
            if pos + 1 < len(stereo):
                stereo[pos] = v
                stereo[pos + 1] = v
    path = os.path.join(TMP, 'soundtrack.wav')
    with wave.open(path, 'wb') as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(stereo.tobytes())
    return path


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------

def load_story(path, available=()):
    """读逐句文案 JSON，归一化场景/角色/音色，坏数据只警告不中断。

    场景解析顺序：显式 scene（别名表）→ 台词关键词推断 → 客厅兜底。
    available 是本次实际可用的场景 key（内置 + assets/backgrounds 自定义）。
    """
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    if isinstance(data, dict):
        data = data.get('lines') or data.get('script') or []
    if not isinstance(data, list) or not data:
        raise SystemExit(f'文案文件没有可用台词：{path}')
    lines = []
    for i, raw in enumerate(data, 1):
        if not isinstance(raw, dict):
            continue
        text = str(raw.get('text') or raw.get('line') or '').strip()
        if not text:
            continue
        char = str(raw.get('char') or raw.get('character') or 'nina').strip().lower()
        if char not in CHAR_VOICE:
            print(f'  [警告] 第{i}句角色「{char}」不在三人组里，退回妮娜', file=sys.stderr)
            char = 'nina'
        raw_scene = str(raw.get('scene') or '').strip()
        scene = ''
        if raw_scene:
            scene = SCENE_ALIASES.get(raw_scene) or SCENE_ALIASES.get(raw_scene.lower()) or ''
            if scene and available and scene not in available:
                scene = ''
            if not scene:
                print(f'  [提示] 第{i}句场景「{raw_scene}」没有对应背景，改按文案推断', file=sys.stderr)
        if not scene:
            guessed = infer_scene(text)
            if guessed and (not available or guessed in available):
                scene = guessed
                print(f'  [场景] 第{i}句按文案推断为「{SCENE_LABEL.get(scene, scene)}」')
            else:
                scene = 'living'
                print(f'  [提示] 第{i}句没识别出场景，用客厅', file=sys.stderr)
        action = 'walk' if str(raw.get('action') or '').lower() == 'walk' else 'talk'
        lines.append({
            'scene': scene, 'char': char,
            'name': str(raw.get('name') or CHAR_NAME[char]),
            'text': text,
            'voice': str(raw.get('voice') or CHAR_VOICE[char]),
            'action': action,
        })
    if not lines:
        raise SystemExit('文案里没有非空台词')
    return lines


def main(argv=None):
    parser = argparse.ArgumentParser(description='三角色动画成片渲染器')
    parser.add_argument('--story', help='逐句文案 JSON 路径；不传则用内置样片')
    parser.add_argument('--out', help='输出 MP4 路径；默认 output/demo/样片-三角色动画与场景切换.mp4')
    parser.add_argument('--stills', help='关键静帧目录；默认 output/demo/stills')
    parser.add_argument('--title', default='一家三口的傍晚', help='片头主标题')
    parser.add_argument('--subtitle', default='', help='片头副标题，默认按用到的场景自动拼')
    args = parser.parse_args(argv)

    print('[0/6] 载入场景库…')
    scenes = build_scenes()
    print('  可用场景：' + '、'.join(SCENE_LABEL.get(k, k) for k in scenes))
    lines = load_story(args.story, set(scenes)) if args.story else [dict(x) for x in SAMPLE_LINES]
    out_mp4 = os.path.abspath(args.out) if args.out else OUT_MP4
    stills_dir = os.path.abspath(args.stills) if args.stills else (
        STILLS if not args.out else os.path.join(os.path.dirname(out_mp4), 'stills'))
    if args.subtitle:
        subtitle = args.subtitle
    else:
        seen = []
        for line in lines:
            if line['scene'] not in seen:
                seen.append(line['scene'])
        subtitle = ' → '.join(SCENE_LABEL[s] for s in seen)

    for p in (FRAMES, os.path.dirname(out_mp4), stills_dir, TMP):
        os.makedirs(p, exist_ok=True)
    # 每轮用独立帧目录：不删旧帧（批量删除会触发安全策略），也避免旧帧被重复编码
    run_frames = os.path.join(FRAMES, time.strftime('%Y%m%d-%H%M%S'))
    os.makedirs(run_frames, exist_ok=True)
    with open(os.path.join(CHAR_DIR, 'calibration.json'), encoding='utf-8') as f:
        calib = json.load(f)['characters']

    print(f'[1/6] 合成配音（edge-tts）… {len(lines)} 句')
    segments = []
    cursor = INTRO_FRAMES
    for i, line in enumerate(lines):
        samples, dur = synth(i, line)
        prefix = energy_prefix(samples)
        vals = [rms_at(prefix, k / FPS) for k in range(max(1, int(dur * FPS)))]
        ref = sorted(vals)[min(len(vals) - 1, int(len(vals) * 0.88))] or 1.0
        levels = [min(1.0, v / ref) for v in vals]
        # 3 帧滑动平均，避免口型抖动
        levels = [sum(levels[max(0, k - 1):k + 2]) / len(levels[max(0, k - 1):k + 2])
                  for k in range(len(levels))]
        frames = round((dur + PAD_BEFORE + PAD_AFTER) * FPS)
        segments.append({
            **line, 'index': i, 'samples': samples, 'dur': dur,
            'levels': levels, 'start': cursor, 'frames': frames,
        })
        cursor += frames
        print(f'  {line["name"]}: 语音 {dur:.2f}s → 镜头 {frames / FPS:.2f}s')
    total_frames = cursor + OUTRO_FRAMES
    print(f'  总时长 {total_frames / FPS:.2f}s / {total_frames} 帧')

    print('[2/6] 准备人物与口型图层…')
    people = {
        'nina': load_character(calib, 'nina', 1300),
        'aton': load_character(calib, 'aton', 1300),
        'dundun': load_character(calib, 'dundun', 1150),
    }
    char_cache = {}

    def get_char(key, scale):
        """同一角色可能要按场景缩放（车内 0.78），按 (角色, 比例) 缓存缩放图与口型。"""
        ck = (key, round(scale, 3))
        if ck not in char_cache:
            p, cal = people[key]
            if scale != 1.0:
                h = max(1, int(p.height * scale))
                p = p.resize((max(1, int(p.width * h / p.height)), h), Image.LANCZOS)
            char_cache[ck] = (p, cal, mouth_tiles(cal, p.size[0], p.size[1]))
        return char_cache[ck]

    caps = {s['index']: caption_layer(s, s['index'], len(lines)) for s in segments}
    intro_layer = title_layer(args.title, subtitle, '动画样片' if not args.story else '动画短片')
    outro_layer = outro_banner()

    print('[3/6] 逐帧合成（口型跟随配音能量）…')
    still_at = {s['start'] + s['frames'] // 2: f'0{s["index"] + 1}-{SCENE_LABEL.get(s["scene"], s["scene"])}.png'
                for s in segments}
    if len(segments) > 1 and lines[1]['action'] == 'walk':
        still_at[segments[1]['start'] + 12] = '02-转场走路.png'
    still_at[8] = '00-片头.png'
    still_at[total_frames - 20] = f'{len(segments) + 1:02d}-片尾.png'

    for f in range(total_frames):
        active = next((s for s in segments if s['start'] <= f < s['start'] + s['frames']), None)
        if active is None:
            is_intro = f < INTRO_FRAMES
            frame = scenes['kitchen' if is_intro else 'living']['bg'].copy()
            if is_intro:
                frame.paste(intro_layer, (0, 0), intro_layer)
            else:
                for key, cx in (('aton', 300), ('nina', 540), ('dundun', 790)):
                    p, cal = people[key]
                    pw, ph = p.size
                    x = int(cx - pw / 2)
                    y = int(1580 - cal['bottom'] * ph)
                    frame.paste(p, (x, y), p)
                frame.paste(outro_layer, (0, 0), outro_layer)
        else:
            local = (f - active['start']) / FPS
            spec = scenes[active['scene']]
            cur = spec['bg']
            if active['index'] == 1 and local < 1.15:
                frame = shift_blend(scenes['kitchen']['bg'], cur, min(1.0, local / 1.15))
            elif active['index'] > 0 and local < 0.45 and active['action'] != 'walk':
                prev = scenes[lines[active['index'] - 1]['scene']]['bg']
                frame = Image.blend(prev, cur, min(1.0, local / 0.45))
            else:
                frame = cur.copy()

            key = active['char']
            p, cal, tile_set = get_char(key, spec['scale'])
            pw, ph = p.size
            if active['action'] == 'walk':
                prog = min(1.0, max(0.0, local / 1.6))
                dx = int(-250 + 500 * prog)
                bob = int(10 * abs(math.sin(local * 9)))
            else:
                dx = 0
                bob = int(5 * math.sin(local * 3.2))
            x = int(W / 2 - pw / 2 + dx)
            y = int(spec['baseline'] - cal['bottom'] * ph + bob)
            frame.paste(p, (x, y), p)

            audio_t = local - PAD_BEFORE
            if 0 <= audio_t < active['dur']:
                k = min(len(active['levels']) - 1, int(audio_t * FPS))
                kind = level_to_kind(active['levels'][k])
            else:
                kind = 'closed'
            tile = tile_set[kind]
            mx = x + cal['mouth'][0] * pw
            my = y + cal['mouth'][1] * ph
            frame.paste(tile, (int(mx - tile.width / 2), int(my - tile.height / 2)), tile)

            # 前景层（如车内仪表台）盖住人物下半身，做出坐姿遮挡
            if spec['fg'] is not None:
                frame.paste(spec['fg'], (0, 0), spec['fg'])

            cap = caps[active['index']]
            frame.paste(cap, (0, 0), cap)

        path = os.path.join(run_frames, f'f{f:05d}.png')
        frame.save(path, compress_level=3)
        if f in still_at:
            frame.save(os.path.join(stills_dir, still_at[f]), compress_level=5)
        if f % 90 == 0:
            print(f'  {f}/{total_frames}')

    print('[4/6] 拼接音轨…')
    soundtrack = build_soundtrack(segments, total_frames)

    print('[5/6] 编码 MP4…')
    run(['ffmpeg', '-y', '-framerate', str(FPS), '-start_number', '0',
         '-i', os.path.join(run_frames, 'f%05d.png'),
         '-i', soundtrack,
         '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
         '-pix_fmt', 'yuv420p', '-r', str(FPS), '-frames:v', str(total_frames),
         '-c:a', 'aac', '-b:a', '192k', '-ar', str(SR), '-ac', '2',
         '-t', f'{total_frames / FPS:.3f}', '-movflags', '+faststart', out_mp4], 300)

    print('[6/6] ffprobe 校验…')
    r = run(['ffprobe', '-v', 'error', '-show_entries',
             'format=duration,size:stream=codec_name,width,height,r_frame_rate,codec_type',
             '-of', 'json', out_mp4], 60)
    print(r.stdout.decode('utf-8', 'replace'))
    print('MP4:', out_mp4, os.path.getsize(out_mp4), 'bytes')
    print('静帧:', stills_dir)


if __name__ == '__main__':
    main()
