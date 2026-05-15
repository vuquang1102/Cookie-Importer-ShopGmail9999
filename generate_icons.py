"""
Sinh logo cho extension ở 4 kích thước Chrome yêu cầu: 16, 32, 48, 128.
Design: 1 chiếc cookie tròn vàng nâu với chocolate chips + accent màu xanh blue
(match theme extension #3b82f6). Vẽ ở 4x size rồi resize LANCZOS để anti-alias.
Chạy: python generate_icons.py
"""
from PIL import Image, ImageDraw, ImageFilter
import os

SIZES = [16, 32, 48, 128]
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def lerp_color(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def create_cookie_icon(size):
    # Render ở 4x size để anti-alias đẹp khi resize xuống
    scale = 8 if size <= 48 else 4
    s = size * scale
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # ===== Outer shadow ring (blue accent — match extension theme #3b82f6) =====
    shadow_margin = int(s * 0.02)
    draw.ellipse(
        [shadow_margin, shadow_margin, s - shadow_margin, s - shadow_margin],
        fill=(59, 130, 246, 80)  # blue glow
    )

    # ===== Cookie body với gradient nhẹ =====
    margin = int(s * 0.08)
    body_top_color    = (245, 158, 11)   # lighter at top
    body_bottom_color = (180, 83, 9)     # darker at bottom

    # Draw radial-ish gradient bằng cách stack nhiều ellipse màu khác nhau
    steps = 40
    for i in range(steps):
        t = i / steps
        color = lerp_color(body_top_color, body_bottom_color, t)
        y_offset = int((s - 2 * margin) * t)
        h = int((s - 2 * margin) / steps) + 2
        draw.ellipse(
            [margin, margin + y_offset, s - margin, margin + y_offset + h],
            fill=color
        )

    # Vẽ lại full ellipse màu trung gian để smooth gradient
    overlay = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    overlay_draw.ellipse(
        [margin, margin, s - margin, s - margin],
        fill=None
    )

    # ===== Outer rim (border đậm) =====
    rim_width = max(2, int(s * 0.015))
    draw.ellipse(
        [margin, margin, s - margin, s - margin],
        outline=(120, 53, 15),
        width=rim_width
    )

    # ===== Chocolate chips =====
    # (center_x_ratio, center_y_ratio, radius_ratio)
    chips = [
        (0.32, 0.30, 0.075),
        (0.62, 0.28, 0.095),
        (0.78, 0.52, 0.070),
        (0.52, 0.58, 0.065),
        (0.28, 0.62, 0.085),
        (0.55, 0.78, 0.070),
        (0.42, 0.40, 0.055),
    ]
    chip_dark    = (66, 32, 6)
    chip_lighter = (101, 50, 14)
    for cx, cy, r in chips:
        x, y, rad = cx * s, cy * s, r * s
        # Bóng dưới chip (depth)
        draw.ellipse(
            [x - rad * 1.05, y - rad * 0.95, x + rad * 1.05, y + rad * 1.15],
            fill=(0, 0, 0, 80)
        )
        # Chip chính
        draw.ellipse([x - rad, y - rad, x + rad, y + rad], fill=chip_dark)
        # Highlight nhỏ trên chip
        hl_r = rad * 0.35
        draw.ellipse(
            [x - rad * 0.4 - hl_r, y - rad * 0.4 - hl_r,
             x - rad * 0.4 + hl_r, y - rad * 0.4 + hl_r],
            fill=chip_lighter
        )

    # ===== Highlight tổng thể (glossy effect) =====
    hl = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    hl_draw = ImageDraw.Draw(hl)
    hl_x1 = int(s * 0.20)
    hl_y1 = int(s * 0.14)
    hl_x2 = int(s * 0.55)
    hl_y2 = int(s * 0.32)
    hl_draw.ellipse([hl_x1, hl_y1, hl_x2, hl_y2], fill=(255, 255, 255, 60))
    hl = hl.filter(ImageFilter.GaussianBlur(radius=s * 0.02))
    img = Image.alpha_composite(img, hl)

    # ===== Resize xuống size mục tiêu =====
    img = img.resize((size, size), Image.LANCZOS)
    return img


def main():
    for size in SIZES:
        img = create_cookie_icon(size)
        path = os.path.join(SCRIPT_DIR, f'icon{size}.png')
        img.save(path, optimize=True)
        print(f'[OK] {path} ({os.path.getsize(path)} bytes)')


if __name__ == '__main__':
    main()
