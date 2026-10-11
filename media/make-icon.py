#!/usr/bin/env python3
"""扩展图标。4 倍画再缩，靠降采样拿抗锯齿。改设计就跑 `python3 media/make-icon.py`。

为什么是「对话气泡 + 数字方波」：气泡说的是「解释弹出来」，方波说的是「数字信号 / SV」。
两个意象，不能再多——在扩展列表里它只有 42px 大，第一版塞了两个脉冲进去，
缩到 32px 直接糊成「mm」认不出来。
"""
from pathlib import Path
from PIL import Image, ImageDraw

S = 512                       # 画布边长，最终缩到 128
BG_TOP, BG_BOT = (27, 35, 54), (16, 21, 34)
CYAN = (53, 208, 224)
INK = (14, 24, 41)
OUT = Path(__file__).resolve().parent

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# 底：圆角方块 + 竖向微渐变
grad = Image.new("RGBA", (1, S))
for y in range(S):
    t = y / (S - 1)
    grad.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOT)) + (255,))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=112, fill=255)
img.paste(grad.resize((S, S)), (0, 0), mask)

d = ImageDraw.Draw(img)
# 气泡本体 + 左下角尾巴
d.rounded_rectangle([72, 104, 440, 322], radius=58, fill=CYAN)
d.polygon([(150, 314), (150, 424), (250, 314)], fill=CYAN)

# 一个脉冲就够。joint="curve" 只管拐点，两端要自己补圆头
pts = [(146, 258), (208, 258), (208, 168), (304, 168), (304, 258), (366, 258)]
W = 34
d.line(pts, fill=INK, width=W, joint="curve")
for p in (pts[0], pts[-1]):
    d.ellipse([p[0] - W // 2, p[1] - W // 2, p[0] + W // 2, p[1] + W // 2], fill=INK)

img.resize((128, 128), Image.LANCZOS).save(OUT / "icon.png")
img.save(OUT / "icon-512.png")
print("写入", OUT / "icon.png")
