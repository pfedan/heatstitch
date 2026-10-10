"""Builds the finished screencast from what record.mjs wrote.

Draws the overlays (pointer, click rings, labels, key caps), eases the camera between zoom
states, adds the opening and closing cards, lays the voice under the scenes and writes the
MP4, the WebVTT subtitles and a poster image.

    python3 tools/screencast/compose.py OUT --part 1 --title "Ein neues Stickmuster" \
        --video docs/screencasts/01-neues-stickmuster/01-neues-stickmuster

OUT is the record.mjs output folder (frames/, timeline.json, ton/). Needs Pillow and ffmpeg.
"""

import argparse
import json
import math
import os
import re
import subprocess
from concurrent.futures import ProcessPoolExecutor

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
W, H = 1920, 1080
SS = 2  # overlays are drawn at twice the size and scaled down, for smooth edges
ACCENT = (181, 49, 122)
ACCENT_LIGHT = (224, 85, 158)
CARD_BG = (27, 16, 38)  # #1b1026, the background of the logo (public/pwa-512.png): no edge around it
INTRO, OUTRO = 3.0, 3.0
# Inter as OTF (Inter-Regular.otf and so on): FONT_DIR, else the usual places on Linux, macOS
# and Windows.
FONT_DIRS = [
    os.environ.get('FONT_DIR', ''),
    '/usr/share/fonts/opentype/inter',
    os.path.expanduser('~/.local/share/fonts'),
    os.path.expanduser('~/Library/Fonts'),
    '/Library/Fonts',
    os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Microsoft', 'Windows', 'Fonts'),
    os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts'),
]


def font(weight, size):
    for d in FONT_DIRS:
        path = os.path.join(d, f'Inter-{weight}.otf')
        if d and os.path.exists(path):
            return ImageFont.truetype(path, size)
    raise SystemExit(f'Inter-{weight}.otf not found; install Inter (https://rsms.me/inter) or set FONT_DIR')


def ease(t):
    t = max(0.0, min(1.0, t))
    return 4 * t * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


# ---------------------------------------------------------------- camera


def camera_path(frames, fps):
    """Per frame (cx, cy, factor): eases 0.7 s from where the camera is to each new target."""
    full = (W / 2, H / 2, 1.0)
    out = []
    cur = start = full
    target = full
    t0 = 0
    dur = int(0.7 * fps)
    for i, f in enumerate(frames):
        z = f.get('zoom')
        want = (z['cx'], z['cy'], z['factor']) if z else full
        if want != target:
            start, target, t0 = cur, want, i
        k = ease((i - t0) / dur) if dur else 1
        cur = tuple(a + (b - a) * k for a, b in zip(start, target))
        out.append(cur)
    return out


def crop_rect(cx, cy, f):
    w, h = W / f, H / f
    x = min(max(cx - w / 2, 0), W - w)
    y = min(max(cy - h / 2, 0), H - h)
    return x, y, w, h


# ---------------------------------------------------------------- overlays


def draw_cursor(d, x, y):
    s = 1.35 * SS
    pts = [(0, 0), (0, 22), (5.5, 17), (9, 25.5), (12.5, 24), (9, 16), (16, 16)]
    poly = [(x + px * s, y + py * s) for px, py in pts]
    shadow = [(px + 2 * SS, py + 3 * SS) for px, py in poly]
    d.polygon(shadow, fill=(0, 0, 0, 70))
    d.polygon(poly, fill=(255, 255, 255, 255), outline=(25, 20, 30, 255), width=int(1.6 * SS))


def draw_ring(d, x, y, age, life):
    t = age / life
    r = (10 + 34 * ease(t)) * SS
    a = int(230 * (1 - t))
    d.ellipse([x - r, y - r, x + r, y + r], outline=ACCENT_LIGHT + (a,), width=int(4 * SS))


def chip(d, text, x, y, anchor, alpha, fnt, fill, ink, pad=(22, 12)):
    """A rounded label; (x, y) is the point given by `anchor` (one of n, s, e, w, c)."""
    l, t, r, b = d.textbbox((0, 0), text, font=fnt)
    w, h = r - l + 2 * pad[0] * SS, b - t + 2 * pad[1] * SS
    ox = {'n': -w / 2, 's': -w / 2, 'e': -w, 'w': 0, 'c': -w / 2}[anchor]
    oy = {'n': 0, 's': -h, 'e': -h / 2, 'w': -h / 2, 'c': -h / 2}[anchor]
    box = [x + ox, y + oy, x + ox + w, y + oy + h]
    d.rounded_rectangle([box[0] + 2 * SS, box[1] + 4 * SS, box[2] + 2 * SS, box[3] + 4 * SS], radius=h / 2, fill=(0, 0, 0, int(60 * alpha / 255)))
    d.rounded_rectangle(box, radius=min(h / 2, 14 * SS), fill=fill + (alpha,))
    d.text((box[0] + pad[0] * SS - l, box[1] + pad[1] * SS - t), text, font=fnt, fill=ink + (alpha,))
    return box


def overlay_frame(img, f, cam, ripples, label_age, key_age, fonts):
    """Draws everything on a 2x frame; positions come in page px and go through the camera."""
    x0, y0, cw, ch = crop_rect(*cam)
    k = SS * W / cw

    def P(x, y):
        return (x - x0) * k, (y - y0) * k

    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    lab = f.get('label')
    if lab:
        a = int(255 * ease(label_age / 6))
        bx, by, bw, bh = lab['box']['x'], lab['box']['y'], lab['box']['width'], lab['box']['height']
        gap = 16 / k * SS
        side = lab['side']
        if side == 'below':
            x, y, anc = P(bx + bw / 2, by + bh + gap)[0], P(0, by + bh + gap)[1], 'n'
        elif side == 'above':
            x, y, anc = P(bx + bw / 2, 0)[0], P(0, by - gap)[1], 's'
        elif side == 'right':
            x, y, anc = P(bx + bw + gap, 0)[0], P(0, by + bh / 2)[1], 'w'
        else:
            x, y, anc = P(bx - gap, 0)[0], P(0, by + bh / 2)[1], 'e'
        slide = (1 - ease(label_age / 6)) * 10 * SS
        y += slide if anc == 'n' else -slide if anc == 's' else 0
        chip(d, lab['text'], x, y, anc, a, fonts['label'], ACCENT, (255, 255, 255))

    if f.get('key'):
        a = int(255 * ease(key_age / 5))
        chip(d, f['key'], W * SS / 2, (H - 70) * SS, 's', a, fonts['key'], (250, 249, 252), (30, 26, 36), pad=(26, 14))

    for (rx, ry, age) in ripples:
        x, y = P(rx, ry)
        draw_ring(d, x, y, age, 14)

    cx, cy = P(f['cursor']['x'], f['cursor']['y'])
    draw_cursor(d, cx, cy)
    img.alpha_composite(layer)


def render_frame(job):
    path, scale, f, cam, ripples, label_age, key_age = job
    fonts = {'label': font('SemiBold', 30 * SS), 'key': font('SemiBold', 32 * SS)}
    src = Image.open(path).convert('RGB')
    x0, y0, cw, ch = crop_rect(*cam)
    region = src.crop((round(x0 * scale), round(y0 * scale), round((x0 + cw) * scale), round((y0 + ch) * scale)))
    big = region.resize((W * SS, H * SS), Image.LANCZOS).convert('RGBA')
    overlay_frame(big, f, cam, ripples, label_age, key_age, fonts)
    return big.convert('RGB').resize((W, H), Image.LANCZOS).tobytes()


# ---------------------------------------------------------------- cards


def stitch_line(d, x1, x2, y, color, width):
    x = x1
    while x < x2:
        d.line([(x, y), (min(x + 18 * SS, x2), y)], fill=color, width=width)
        x += 28 * SS


def card(lines, logo_size=150):
    img = Image.new('RGB', (W * SS, H * SS), CARD_BG)
    d = ImageDraw.Draw(img)
    logo = Image.open(os.path.join(ROOT, 'public', 'pwa-512.png')).convert('RGBA').resize((logo_size * SS, logo_size * SS), Image.LANCZOS)
    total = logo_size * SS + sum(l[2] for l in lines)
    y = (H * SS - total) / 2
    img.paste(logo, (int((W * SS - logo.width) / 2), int(y)), logo)
    y += logo.width
    for text, (fnt, color), height, rule in lines:
        l, t, r, b = d.textbbox((0, 0), text, font=fnt)
        x = (W * SS - (r - l)) / 2
        d.text((x - l, y + (height - (b - t)) / 2 - t), text, font=fnt, fill=color)
        if rule:
            stitch_line(d, x, x + r - l, y + height + 6 * SS, ACCENT_LIGHT, 5 * SS)
        y += height
    return img.resize((W, H), Image.LANCZOS)


def intro_card(part, title):
    return card([
        ('', (font('Regular', 10), CARD_BG), 40 * SS, False),
        (f'Teil {part}', (font('SemiBold', 40 * SS), ACCENT_LIGHT), 70 * SS, False),
        (title, (font('Bold', 84 * SS), (255, 255, 255)), 110 * SS, True),
    ])


def outro_card():
    return card([
        ('', (font('Regular', 10), CARD_BG), 30 * SS, False),
        ('heatstitch', (font('Bold', 64 * SS), (255, 255, 255)), 90 * SS, False),
        ('heatstitch.app', (font('Medium', 34 * SS), (190, 182, 200)), 60 * SS, False),
    ])


def blend(a, b, t):
    return Image.blend(a, b, t).tobytes()


# ---------------------------------------------------------------- subtitles and audio


def vtt_time(t):
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f'{int(h):02d}:{int(m):02d}:{s:06.3f}'


def subtitles(scenes, texts, fps, offset, durations):
    """WebVTT with one cue per sentence, spread over the scene's speech by length."""
    out = ['WEBVTT', '']
    for sc in scenes:
        if not sc.get('audio'):
            continue
        start = offset + sc['start'] / fps + sc['lead']
        dur = durations[sc['n']]
        sentences = [s for s in re.split(r'(?<=[.?!])\s+', texts[sc['n'] - 1]) if s]
        total = sum(len(s) for s in sentences)
        t = start
        for s in sentences:
            d = dur * len(s) / total
            out += [f'{vtt_time(t)} --> {vtt_time(t + d)}', s, '']
            t += d
    return '\n'.join(out)


def duration(path):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]))


# ---------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--part', required=True)
    ap.add_argument('--title', required=True)
    ap.add_argument('--video', required=True, help='output path without extension')
    ap.add_argument('--ablauf', required=True, help='the ablauf.mjs, for the subtitle texts')
    ap.add_argument('--crf', default='30')  # about 4 MB per minute, the budget of the concept
    args = ap.parse_args()

    tl = json.load(open(os.path.join(args.out, 'timeline.json')))
    fps, scale, frames = tl['fps'], tl['scale'], tl['frames']
    cams = camera_path(frames, fps)

    jobs = []
    ripples = []
    label_age = key_age = 0
    prev_label = prev_key = None
    for i, f in enumerate(frames):
        if f.get('click'):
            ripples.append([f['click']['x'], f['click']['y'], 0])
        ripples = [r for r in ripples if r[2] < 14]
        lab = json.dumps(f.get('label'))
        label_age = label_age + 1 if lab == prev_label else 0
        prev_label = lab
        key_age = key_age + 1 if f.get('key') == prev_key else 0
        prev_key = f.get('key')
        jobs.append((os.path.join(args.out, 'frames', f'{i:06d}.jpg'), scale, f, cams[i], [tuple(r) for r in ripples], label_age, key_age))
        for r in ripples:
            r[2] += 1

    intro, outro = intro_card(args.part, args.title), outro_card()
    first = Image.frombytes('RGB', (W, H), render_frame(jobs[0]))
    last = Image.frombytes('RGB', (W, H), render_frame(jobs[-1]))
    black = Image.new('RGB', (W, H), (0, 0, 0))

    os.makedirs(os.path.dirname(os.path.abspath(args.video)), exist_ok=True)
    silent = os.path.join(args.out, 'video-silent.mp4')
    enc = subprocess.Popen([
        'ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(fps), '-i', '-',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', args.crf, '-pix_fmt', 'yuv420p', '-tune', 'animation', silent,
    ], stdin=subprocess.PIPE)
    n_in, n_out, fade = int(INTRO * fps), int(OUTRO * fps), int(0.5 * fps)
    for i in range(n_in):
        if i < fade:
            enc.stdin.write(blend(black, intro, i / fade))
        elif i >= n_in - fade:
            enc.stdin.write(blend(intro, first, (i - (n_in - fade)) / fade))
        else:
            enc.stdin.write(intro.tobytes())
    with ProcessPoolExecutor() as pool:
        for k, data in enumerate(pool.map(render_frame, jobs, chunksize=8)):
            enc.stdin.write(data)
            if k % 300 == 0:
                print(f'frame {k}/{len(jobs)}', flush=True)
    for i in range(n_out):
        if i < fade:
            enc.stdin.write(blend(last, outro, i / fade))
        elif i >= n_out - fade:
            enc.stdin.write(blend(outro, black, (i - (n_out - fade)) / fade))
        else:
            enc.stdin.write(outro.tobytes())
    enc.stdin.close()
    enc.wait()

    # Voice: each scene's take starts `lead` seconds into its scene.
    scenes = tl['scenes']
    inputs, filters, labels, durations = [], [], [], {}
    for j, sc in enumerate(s for s in scenes if s.get('audio')):
        inputs += ['-i', sc['audio']]
        durations[sc['n']] = duration(sc['audio'])
        delay = int((INTRO + sc['start'] / fps + sc['lead']) * 1000)
        filters.append(f'[{j + 1}:a]aresample=48000,adelay={delay}|{delay}[a{j}]')
        labels.append(f'[a{j}]')
    total = INTRO + len(frames) / fps + OUTRO
    graph = ';'.join(filters) + f';{"".join(labels)}amix=inputs={len(labels)}:normalize=0,loudnorm=I=-16:TP=-1.5,apad,atrim=0:{total:.3f}[voice]'
    if not labels:  # a test cut before any voice exists: a silent track keeps the rest the same
        graph = f'anullsrc=r=48000:cl=stereo,atrim=0:{total:.3f}[voice]'
    # Subtitles in German and English, without the voice's stage directions: as WebVTT for
    # the help page and as switchable tracks inside the MP4.
    script = (
        "import(process.argv[1]).then(m => console.log(JSON.stringify("
        "m.default.scenes.map(s => ({ de: s.text, en: s.textEn ?? s.text })))))"
    )
    texts = json.loads(subprocess.check_output(['node', '-e', script, os.path.abspath(args.ablauf)]))
    subs = []
    for lang in ('de', 'en'):
        path = f'{args.video}.{lang}.vtt'
        with open(path, 'w') as fh:
            fh.write(subtitles(scenes, [t[lang] for t in texts], fps, INTRO, durations))
        subs.append(path)
    sub_in = [a for p in subs for a in ('-i', p)]
    first_sub = 1 + len(inputs) // 2
    subprocess.run([
        'ffmpeg', '-v', 'error', '-y', '-i', silent, *inputs, *sub_in, '-filter_complex', graph,
        '-map', '0:v', '-map', '[voice]', '-map', f'{first_sub}:s', '-map', f'{first_sub + 1}:s',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-c:s', 'mov_text',
        '-metadata:s:a:0', 'language=deu', '-metadata:s:s:0', 'language=deu', '-metadata:s:s:0', 'title=Deutsch',
        '-metadata:s:s:1', 'language=eng', '-metadata:s:s:1', 'title=English',
        '-movflags', '+faststart', args.video + '.mp4',
    ], check=True)

    pick = next((s for s in scenes if s['n'] == int(os.environ.get('POSTER_SCENE', '0'))), scenes[-1])
    job = list(jobs[max(pick['end'] - fps, 0)])
    job[2] = {**job[2], 'label': None, 'key': None, 'cursor': {'x': -100, 'y': -100}}
    poster = Image.frombytes('RGB', (W, H), render_frame(tuple(job)))
    poster.save(args.video + '.jpg', quality=88)
    print('done', args.video + '.mp4', f'{total:.1f} s')


if __name__ == '__main__':
    main()
