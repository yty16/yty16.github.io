"""Generate PWA icons using only Python built-in modules (no PIL required)."""
import struct, zlib, math, os

def make_chunk(ctype, data):
    c = ctype + data
    return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

def create_png(w, h, rgba_bytes):
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = make_chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # no filter
        start = y * w * 4
        raw.extend(rgba_bytes[start:start + w * 4])
    idat = make_chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    iend = make_chunk(b'IEND', b'')
    return sig + ihdr + idat + iend

# Y letter bitmap (5 wide, 7 tall)
Y_LETTER = [
    [1,0,0,0,1],
    [1,0,0,0,1],
    [0,1,0,1,0],
    [0,1,0,1,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
]

def generate_icon(size):
    pixels = bytearray()
    center = size / 2.0
    radius = size * 0.46

    y_w = len(Y_LETTER[0])
    y_h = len(Y_LETTER)
    y_scale = size * 0.52 / y_w
    y_offset_x = (size - y_w * y_scale) / 2.0
    y_offset_y = (size - y_h * y_scale) / 2.0

    for py in range(size):
        for px in range(size):
            dx = px - center
            dy = py - center
            dist = math.sqrt(dx * dx + dy * dy)

            if dist <= radius:
                # Gradient background: #1a1a2e (top) -> #0d1117 (bottom)
                t = py / size
                r = int(26 + (13 - 26) * t)
                g = int(26 + (17 - 26) * t)
                b = int(46 + (23 - 46) * t)

                # Check if pixel is part of "Y"
                yx = int((px - y_offset_x) / y_scale)
                yy = int((py - y_offset_y) / y_scale)
                if 0 <= yx < y_w and 0 <= yy < y_h and Y_LETTER[yy][yx]:
                    r, g, b = 88, 166, 255  # #58a6ff accent blue

                pixels.extend([r, g, b, 255])
            elif dist <= radius + 1.5:
                # Anti-alias edge
                alpha = int(255 * max(0, (radius + 1.5 - dist) / 1.5))
                pixels.extend([13, 17, 23, alpha])
            else:
                pixels.extend([0, 0, 0, 0])

    return pixels

out_dir = os.path.dirname(os.path.abspath(__file__))
for size in [192, 512]:
    pixels = generate_icon(size)
    png = create_png(size, size, pixels)
    path = os.path.join(out_dir, f'icon-{size}.png')
    with open(path, 'wb') as f:
        f.write(png)
    print(f'Generated icon-{size}.png ({len(png)} bytes)')
