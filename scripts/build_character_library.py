"""构建「人物六视图资源库」：assets/characters/library/<slug>/ 下每人 6 张图。

槽位：front 正面 / side 侧面 / back 背面 / fullBody 全身 / halfBody 半身 / face 脸部。

- front / fullBody：已定稿立绘去掉右下角水印（背景色回填）；
- halfBody / face：按 calibration.json 实测的头顶点与嘴部坐标裁切，等比贴进方形画布；
- side / back：由 ImageGen 以干净正面图为参考做图生图，再由 finalize 去水印、统一尺寸后入库。

用法：
    python scripts/build_character_library.py prepare     # 派生 4 张 + 生成图生图参考图 + 写索引
    python scripts/build_character_library.py finalize    # 导入 .probe/library-generated/<slug>-<view>/ 里的生成图
    python scripts/build_character_library.py status      # 检查六槽位是否齐全

资源库清单写在 assets/characters/library/index.json，后端 GET /api/character-library 读它。
往 library/ 里放新人、在 index.json 里追加一项，页面上就能直接选到，不需要改代码。
"""
from __future__ import annotations

import json
import os
import shutil
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'characters')
LIB = os.path.join(SRC, 'library')
REF = os.path.join(ROOT, '.probe', 'library-ref')
GEN = os.path.join(ROOT, '.probe', 'library-generated')
CALIB_FILE = os.path.join(SRC, 'calibration.json')
CONFIG_FILE = os.path.join(ROOT, 'config', 'characters.json')
INDEX_FILE = os.path.join(LIB, 'index.json')

SLOTS = ('front', 'side', 'back', 'fullBody', 'halfBody', 'face')
SLOT_LABELS = {
    'front': '正面', 'side': '侧面', 'back': '背面',
    'fullBody': '全身', 'halfBody': '半身', 'face': '脸部',
}
# 资源库人物 -> 项目默认人物 id / 原图文件
PEOPLE = {
    'nina': {'charId': 'char-a', 'name': '妮娜', 'source': 'nina.png'},
    'aton': {'charId': 'char-b', 'name': '阿顿', 'source': 'aton.png'},
    'dundun': {'charId': 'char-c', 'name': '吨吨', 'source': 'dundun.png'},
}

# 右下角水印区域（相对宽高），人物脚部最右约 0.73，不会碰到
WM_X, WM_Y = 0.840, 0.905
FULL_SIZE = (1024, 1536)
SQUARE_SIZE = (1024, 1024)


def read_json(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write('\n')


def background_of(im: Image.Image):
    """左上角取样背景色（原图是纯浅灰不透明底）。"""
    rgb = im.convert('RGB').getpixel((18, 18))
    return rgb


def scrub_watermark(im: Image.Image) -> Image.Image:
    """把右下角水印矩形填成背景色，不透明输出。"""
    out = im.convert('RGB').copy()
    w, h = out.size
    bg = background_of(out)
    from PIL import ImageDraw
    ImageDraw.Draw(out).rectangle(
        (int(w * WM_X), int(h * WM_Y), w, h), fill=bg,
    )
    return out


def fit_into(im: Image.Image, size, bg) -> Image.Image:
    """等比缩放居中贴进画布，不拉伸、不裁掉内容。"""
    src = im.convert('RGB')
    sw, sh = src.size
    cw, ch = size
    scale = min(cw / sw, ch / sh)
    nw, nh = max(1, int(sw * scale)), max(1, int(sh * scale))
    resized = src.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new('RGB', size, bg)
    canvas.paste(resized, ((cw - nw) // 2, (ch - nh) // 2))
    return canvas


def square_crop(im: Image.Image, calib, y0_ratio, y1_ratio, bg) -> Image.Image:
    w, h = im.size
    y0, y1 = int(h * y0_ratio), int(h * y1_ratio)
    side = y1 - y0
    cx = w // 2
    x0, x1 = max(0, cx - side // 2), min(w, cx + side // 2)
    crop = im.crop((x0, y0, x1, min(h, y1)))
    return fit_into(crop, SQUARE_SIZE, bg)


def rel(slug, slot):
    return f'assets/characters/library/{slug}/{slot}.png'


def prepare():
    calib = read_json(CALIB_FILE)['characters']
    for slug, info in PEOPLE.items():
        src = Image.open(os.path.join(SRC, info['source'])).convert('RGB')
        bg = background_of(src)
        clean = scrub_watermark(src)
        out_dir = os.path.join(LIB, slug)
        os.makedirs(out_dir, exist_ok=True)

        # 正面 / 全身：同一张定稿立绘（各存一份，六槽位各自独立可替换）
        clean.save(os.path.join(out_dir, 'front.png'))
        clean.save(os.path.join(out_dir, 'fullBody.png'))
        os.makedirs(REF, exist_ok=True)
        clean.save(os.path.join(REF, f'{slug}.png'))  # 图生图参考图（无水印）

        c = calib[slug]
        top, bottom = c['top'], c['bottom']
        mouth_y = (c['mouthRect'][1] + c['mouthRect'][3]) / 2
        # 半身：头顶略留白到手/腰部以下，完整包含手臂与随身物
        square_crop(clean, c, max(0, top - 0.025), top + 0.62 * (bottom - top), bg) \
            .save(os.path.join(out_dir, 'halfBody.png'))
        # 脸部：头顶到下巴下方，头顶留一点空白
        square_crop(clean, c, max(0, top - 0.02), mouth_y + 0.12, bg) \
            .save(os.path.join(out_dir, 'face.png'))
        print(f'[prepare] {info["name"]}: front/fullBody/halfBody/face 已生成，参考图 {REF}/{slug}.png')
    write_index()
    sync_default_characters()


def finalize():
    """导入 ImageGen 生成的 side/back；生成图放在 GEN/<slug>-<view>/ 下，每目录一张。"""
    count = 0
    for slug, info in PEOPLE.items():
        for view in ('side', 'back'):
            folder = os.path.join(GEN, f'{slug}-{view}')
            if not os.path.isdir(folder):
                print(f'[skip] 缺生成图目录：{folder}')
                continue
            files = [f for f in sorted(os.listdir(folder)) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))]
            if not files:
                print(f'[skip] 目录里没有图片：{folder}')
                continue
            im = Image.open(os.path.join(folder, files[0]))
            # 先统一到 1024x1536 竖版，再去水印（水印比例按新画布算）
            resized = fit_into(im, FULL_SIZE, background_of(im))
            scrub_watermark(resized).save(os.path.join(LIB, slug, f'{view}.png'))
            count += 1
            print(f'[finalize] {info["name"]} {view}: {files[0]} -> library/{slug}/{view}.png')
    write_index()
    sync_default_characters()
    print(f'[finalize] 共入库 {count} 张')


def library_entries():
    """从 config/characters.json 抽取人物模板，避免资源库与默认设定两处重复维护。"""
    defaults = read_json(CONFIG_FILE)
    by_id = {c['id']: c for c in defaults}
    entries = []
    for slug, info in PEOPLE.items():
        base = by_id[info['charId']]
        template = {k: v for k, v in base.items()
                    if k not in ('id', 'referenceImages', 'relations', 'updatedAt')}
        images = {}
        for slot in SLOTS:
            path = rel(slug, slot)
            images[slot] = path if os.path.exists(os.path.join(ROOT, path)) else ''
        entries.append({
            'id': f'lib-{slug}',
            'slug': slug,
            'name': base['name'],
            'nameTh': base['nameTh'],
            'cover': images['fullBody'] or images['front'],
            'images': images,
            'template': template,
        })
    return entries


def write_index():
    write_json(INDEX_FILE, {
        'schemaVersion': 1,
        'note': '人物六视图资源库。images 里是相对项目根的 POSIX 路径；新增人物时把六张图放进 library/<slug>/ 并在这里追加一项即可。',
        'slots': [{'key': s, 'label': SLOT_LABELS[s]} for s in SLOTS],
        'characters': library_entries(),
    })
    print(f'[index] 已写 {INDEX_FILE}')


def sync_default_characters():
    """新建项目自带的三人，六个槽位全部指向资源库（不再只填 2 个）。"""
    defaults = read_json(CONFIG_FILE)
    by_slug = {e['slug']: e for e in library_entries()}
    changed = 0
    for char in defaults:
        slug = next((s for s, info in PEOPLE.items() if info['charId'] == char['id']), None)
        if not slug:
            continue
        images = by_slug[slug]['images']
        refs = char.get('referenceImages', {})
        for slot in SLOTS:
            if images[slot]:
                refs[slot] = images[slot]
        refs.setdefault('expressions', [])
        refs.setdefault('actions', [])
        char['referenceImages'] = refs
        changed += 1
    write_json(CONFIG_FILE, defaults)
    print(f'[config] config/characters.json 六槽位已补齐（{changed} 人）')


def status():
    missing = []
    for entry in library_entries():
        for slot in SLOTS:
            if not entry['images'][slot]:
                missing.append(f'{entry["name"]}/{slot}')
    print('六视图齐全' if not missing else '缺少：' + '、'.join(missing))


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'prepare'
    if cmd == 'prepare':
        prepare()
    elif cmd == 'finalize':
        finalize()
    elif cmd == 'status':
        status()
    else:
        raise SystemExit(f'未知命令：{cmd}（可用 prepare / finalize / status）')
