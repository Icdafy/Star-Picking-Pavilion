#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""从 renderer/logo.png 生成应用 PNG 与 Windows 多尺寸 ICO，保留原图颜色和透明度。"""
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / "renderer" / "logo.png"
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]

with Image.open(SOURCE) as source:
    if source.width != source.height:
        raise ValueError("Logo 原图必须为正方形，避免应用图标被拉伸。")
    icon = source.convert("RGBA")
    icon.resize((512, 512), Image.Resampling.LANCZOS).save(HERE / "icon.png")
    icon.save(HERE / "icon.ico", sizes=ICO_SIZES)

print("已从 renderer/logo.png 生成 build/icon.png 与 build/icon.ico")
