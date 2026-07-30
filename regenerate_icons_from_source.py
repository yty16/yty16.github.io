import os
import argparse
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SRC = os.path.join(ROOT, "icon-source.png")

SIZES = [48, 72, 96, 128, 144, 152, 167, 192, 512]

MIPMAP_MAP = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}


def crop_white_border(src, threshold=240):
    """裁剪源图四周的纯白外边框，返回内容区域。"""
    # 基于亮度快速计算内容边界（非纯白区域）
    gray = src.convert("L")
    mask = gray.point(lambda p: 0 if p > threshold else 255, mode="1")
    bbox = mask.getbbox()
    if not bbox:
        return src
    return src.crop(bbox)


def resize(src, size, maskable=False):
    """缩放图标，裁剪白边后按设定比例居中填充到目标尺寸。"""
    img = crop_white_border(src)
    # 普通图标内容占画布 100%（贴边），在浏览器 favicon 里最大化显示；
    # 浏览器标签页通常还会对 favicon 加圆角，100% 能抵消视觉白边。
    # maskable 图标仍需留出安全边距，保持 82%。
    fill_ratio = 0.82 if maskable else 1.0
    if maskable:
        safe_size = int(size * 0.8)
        content_size = int(safe_size * fill_ratio)
        safe = Image.new("RGBA", (safe_size, safe_size), (255, 255, 255, 255))
        img.thumbnail((content_size, content_size), Image.LANCZOS)
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        x = (safe_size - img.width) // 2
        y = (safe_size - img.height) // 2
        safe.paste(img, (x, y), img)
        canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
        offset = (size - safe_size) // 2
        canvas.paste(safe, (offset, offset))
    else:
        content_size = int(size * fill_ratio)
        img.thumbnail((content_size, content_size), Image.LANCZOS)
        canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
        x = (size - img.width) // 2
        y = (size - img.height) // 2
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        canvas.paste(img, (x, y), img)
    return canvas


def save_png(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "PNG", optimize=True)
    print(f"  PNG -> {path}")


def save_ico(img, path):
    """保存多尺寸 ico。Pillow 12 要求首张图必须最大（256x256），再由 sizes 参数缩放。"""
    sizes = [16, 32, 48, 64, 128, 256]
    # 生成从大到小的图像
    imgs = []
    for s in sizes:
        r = resize(img, s, maskable=False)
        # ico 用 RGB 模式兼容性更好
        bg = Image.new("RGB", (s, s), (255, 255, 255))
        bg.paste(r, (0, 0), r)
        imgs.append(bg)
    # 反转：最大尺寸在前
    imgs.reverse()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    imgs[0].save(path, format="ICO", sizes=[(s, s) for s in sizes])
    print(f"  ICO -> {path}")


def main():
    parser = argparse.ArgumentParser(description="从源图生成元拓域 Toolbox 全尺寸图标")
    parser.add_argument("--src", default=DEFAULT_SRC, help="源图标 PNG 路径")
    args = parser.parse_args()

    src = Image.open(args.src)
    if src.mode != "RGBA":
        src = src.convert("RGBA")
    print(f"源图标: {args.src} ({src.size[0]}x{src.size[1]})")

    # 1) 根目录网站图标
    print("\n[网站图标]")
    for size in SIZES:
        save_png(resize(src, size), os.path.join(ROOT, f"icon-{size}.png"))
    save_png(resize(src, 512, maskable=True), os.path.join(ROOT, "icon-maskable.png"))
    save_png(resize(src, 180), os.path.join(ROOT, "apple-touch-icon.png"))
    save_ico(src, os.path.join(ROOT, "favicon.ico"))

    # 2) Android mipmap 资源（手机 + 手表）
    print("\n[Android mipmap]")
    for project in ["apk-build", "watch-apk-build"]:
        for dpi, size in MIPMAP_MAP.items():
            mipmap_dir = os.path.join(ROOT, project, "app", "src", "main", "res", f"mipmap-{dpi}")
            save_png(resize(src, size), os.path.join(mipmap_dir, "ic_launcher.png"))
            save_png(resize(src, size, maskable=True), os.path.join(mipmap_dir, "ic_maskable.png"))

    # 3) Windows 应用图标
    print("\n[Windows 图标]")
    save_ico(src, os.path.join(ROOT, "win-app", "icon.ico"))

    print("\n全部图标生成完成。请运行 build_apk_assets.py 同步到三端 www。")


if __name__ == "__main__":
    main()
