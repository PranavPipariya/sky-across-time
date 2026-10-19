"""Section 4.2: convert NASA SVS 4851 milkyway_2020_8k.exr into display tiles.

usage: python tools/prepare_sky.py path/to/milkyway_2020_8k.exr [--k K] [--out public/sky]

Writes 4096x4096 RA-half tiles (tile_0.jpg covers u 0..0.5, tile_1.jpg u 0.5..1),
preview_2k.jpg and manifest.json. Also prints the photo-alignment check (section 11.9).
"""
import argparse, json, os
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def read_exr(path):
    import OpenEXR
    with OpenEXR.File(path) as f:
        ch = f.channels()
        if 'RGB' in ch:
            rgb = ch['RGB'].pixels
        else:
            rgb = np.dstack([ch[c].pixels for c in ('R', 'G', 'B')])
    return np.asarray(rgb, dtype=np.float32)


def radec_to_px(ra, dec, w, h):
    u = (0.5 - ra / 360.0) % 1.0
    v = (90.0 - dec) / 180.0
    return int(u * w) % w, min(h - 1, int(v * h))


def box_mean(lum, x, y, r):
    h, w = lum.shape
    ys = slice(max(0, y - r), min(h, y + r + 1))
    xs = [(x + dx) % w for dx in range(-r, r + 1)]
    return float(lum[ys][:, xs].mean())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('exr')
    ap.add_argument('--k', type=float, default=None, help='tone-map strength; auto if omitted')
    ap.add_argument('--out', default='public/sky')
    a = ap.parse_args()

    img = read_exr(a.exr)
    h, w, _ = img.shape
    print(f'read {w}x{h}, max {img.max():.4g}, mean {img.mean():.4g}')
    img = np.maximum(img, 0)
    lum = img @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

    # Brightest part of the galactic centre (RA 266.4, Dec -28.9), 0.5 deg box mean.
    gx, gy = radec_to_px(266.4, -28.9, w, h)
    r = max(2, int(w / 360 * 4))
    patch = lum[gy - r:gy + r, gx - r:gx + r]
    from numpy.lib.stride_tricks import sliding_window_view
    k_box = max(1, int(w / 720))
    gc = float(sliding_window_view(patch, (k_box, k_box)).mean(axis=(2, 3)).max())
    k = a.k if a.k else -np.log(1 - 0.85) / gc
    print(f'galactic centre luminance {gc:.4g} -> k = {k:.4g}')

    out = 1 - np.exp(-k * img)
    out = np.where(out <= 0.0031308, 12.92 * out, 1.055 * np.power(out, 1 / 2.4) - 0.055)
    out8 = (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)

    os.makedirs(a.out, exist_ok=True)
    tiles = []
    n = max(1, w // 4096)
    tw = w // n
    for i in range(n):
        name = f'tile_{i}.jpg'
        Image.fromarray(out8[:, i * tw:(i + 1) * tw]).resize((min(tw, 4096), min(h, 4096)), Image.LANCZOS) \
            .save(os.path.join(a.out, name), quality=88, progressive=True, optimize=True)
        u0, u1 = i / n, (i + 1) / n
        tiles.append({'file': name, 'u0': u0, 'u1': u1,
                      'raFrom': (0.5 - u0) * 360 % 360, 'raTo': (0.5 - u1) * 360 % 360, 'decFrom': 90, 'decTo': -90})
        print('wrote', name)
    Image.fromarray(out8).resize((2048, 1024), Image.LANCZOS) \
        .save(os.path.join(a.out, 'preview_2k.jpg'), quality=85, progressive=True, optimize=True)
    with open(os.path.join(a.out, 'manifest.json'), 'w') as f:
        json.dump({'source': os.path.basename(a.exr), 'k': k, 'width': w, 'height': h, 'tiles': tiles,
                   'preview': 'preview_2k.jpg',
                   'mapping': 'u = fract(0.5 - RA/360), v = (90 - Dec)/180'}, f, indent=2)

    # Section 11.9: these should be brighter than their surroundings.
    print('\nalignment check (centre vs ring, tone-mapped luminance):')
    disp = out8.astype(np.float32) @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    for name, ra, dec, rad in [('LMC', 80.9, -69.8, 2.0), ('M31', 10.7, 41.3, 0.6),
                               ('Carina Nebula', 161, -60, 0.7), ('Galactic centre', 266.4, -28.9, 2.0)]:
        x, y = radec_to_px(ra, dec, w, h)
        rp = max(1, int(rad * w / 360))
        inner = box_mean(disp, x, y, rp)
        ring = (box_mean(disp, x, y, rp * 4) * (8 * rp + 1) ** 2 - inner * (2 * rp + 1) ** 2) / ((8 * rp + 1) ** 2 - (2 * rp + 1) ** 2)
        print(f'  {name:16s} centre {inner:6.1f}  surround {ring:6.1f}  {"PEAK" if inner > ring else "NOT A PEAK"}')


if __name__ == '__main__':
    main()
