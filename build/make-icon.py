#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成摘星阁应用图标（夜航塔台·雷达）—— 输出 build/icon.ico 与 build/icon.png
   超采样渲染（4x）后缩放，得到平滑边缘；.ico 内嵌多尺寸。"""
import os, math
from PIL import Image, ImageDraw, ImageFilter

S = 1024                      # 主画布
HERE = os.path.dirname(os.path.abspath(__file__))

TEAL = (94, 234, 212)
ORANGE = (252, 163, 93)
BG_TOP = (16, 27, 61)
BG_BOT = (4, 6, 14)

def lerp(a, b, t): return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

# 圆角矩形遮罩
def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m

# 背景：竖直渐变
bg = Image.new('RGB', (S, S), BG_BOT)
px = bg.load()
for y in range(S):
    c = lerp(BG_TOP, BG_BOT, y / S)
    for x in range(S):
        px[x, y] = c
# 右上角加一点辉光
glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([S*0.55, -S*0.25, S*1.25, S*0.45], fill=(40, 70, 150, 130))
glow = glow.filter(ImageFilter.GaussianBlur(S*0.08))
bg = Image.alpha_composite(bg.convert('RGBA'), glow)

# 雷达层
radar = Image.new('RGBA', (S, S), (0, 0, 0, 0))
rd = ImageDraw.Draw(radar)
cx = cy = S / 2
lw = max(2, int(S * 0.012))
for r, a in [(0.40, 90), (0.285, 130), (0.17, 170)]:
    R = S * r
    rd.ellipse([cx - R, cy - R, cx + R, cy + R], outline=TEAL + (a,), width=lw)
# 十字准线
rd.line([cx, cy - S*0.40, cx, cy + S*0.40], fill=TEAL + (45,), width=max(1, lw//2))
rd.line([cx - S*0.40, cy, cx + S*0.40, cy], fill=TEAL + (45,), width=max(1, lw//2))

# 扫描扇形（带渐变：用多条从中心发散的线模拟亮度衰减）
sweep = Image.new('RGBA', (S, S), (0, 0, 0, 0))
sd = ImageDraw.Draw(sweep)
R = S * 0.40
start, end = -95, -35           # 顶部偏右的一束
sd.pieslice([cx - R, cy - R, cx + R, cy + R], start, end, fill=TEAL + (70,))
# 前沿亮线
ang = math.radians(end)
sd.line([cx, cy, cx + R*math.cos(ang), cy + R*math.sin(ang)], fill=TEAL + (220,), width=lw)
sweep = sweep.filter(ImageFilter.GaussianBlur(S*0.004))
radar = Image.alpha_composite(radar, sweep)

# 中心 + 光点
rd = ImageDraw.Draw(radar)
cr = S * 0.028
rd.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=TEAL + (255,))
# 橙色目标点（右上）+ 青色点（左下）
bx, by = cx + S*0.20, cy - S*0.16
br = S * 0.030
rd.ellipse([bx - br, by - br, bx + br, by + br], fill=ORANGE + (255,))
bx2, by2 = cx - S*0.21, cy + S*0.17
br2 = S * 0.022
rd.ellipse([bx2 - br2, by2 - br2, bx2 + br2, by2 + br2], fill=TEAL + (230,))

# 合成
icon = Image.alpha_composite(bg, radar)
# 圆角裁切
mask = rounded_mask(S, int(S * 0.22))
out = Image.new('RGBA', (S, S), (0, 0, 0, 0))
out.paste(icon, (0, 0), mask)

# 输出 PNG（512）与 ICO（多尺寸）
png = out.resize((512, 512), Image.LANCZOS)
png.save(os.path.join(HERE, 'icon.png'))
out.save(os.path.join(HERE, 'icon.ico'),
         sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
print('icon.ico / icon.png 已生成于', HERE)
