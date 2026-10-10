"""Gives a finished screencast the closing card that compose.py draws now, without recording it again.

The closing card is the video's last OUTRO seconds: half a second from the last scene into the
card, the card, half a second into black (compose.py). This decodes the video, draws those frames
again from the frame just before them and the current card, and encodes the video with
compose.py's settings; voice and subtitle tracks are copied as they are.

    python3 tools/screencast/outro.py IN.mp4 OUT.mp4

Needs Pillow and ffmpeg, like compose.py.
"""

import os
import subprocess
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compose import OUTRO, H, W, blend, outro_card  # noqa: E402


def frame_count(path):
    out = subprocess.check_output(['ffprobe', '-v', 'error', '-count_packets', '-select_streams', 'v:0',
                                   '-show_entries', 'stream=nb_read_packets,r_frame_rate', '-of', 'csv=p=0', path], text=True)
    rate, n = out.strip().split(',')
    num, den = rate.split('/')
    return int(n), round(int(num) / int(den))


def main():
    src, dst = sys.argv[1], sys.argv[2]
    n, fps = frame_count(src)
    n_out, fade = int(OUTRO * fps), int(0.5 * fps)
    size = W * H * 3
    silent = dst + '.video.mp4'
    dec = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', src, '-map', '0:v', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                           stdout=subprocess.PIPE)
    enc = subprocess.Popen([
        'ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(fps), '-i', '-',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p', '-tune', 'animation', silent,
    ], stdin=subprocess.PIPE)
    outro, black = outro_card(), Image.new('RGB', (W, H), (0, 0, 0))
    last = None
    for k in range(n):
        data = dec.stdout.read(size)
        if len(data) < size:
            sys.exit(f'{src}: only {k} of {n} frames')
        i = k - (n - n_out)
        if i < 0:
            if i == -1:
                last = Image.frombytes('RGB', (W, H), data)
            enc.stdin.write(data)
        elif i < fade:
            enc.stdin.write(blend(last, outro, i / fade))
        elif i >= n_out - fade:
            enc.stdin.write(blend(outro, black, (i - (n_out - fade)) / fade))
        else:
            enc.stdin.write(outro.tobytes())
    dec.wait()
    enc.stdin.close()
    if enc.wait():
        sys.exit('encoding failed')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', silent, '-i', src, '-map', '0:v', '-map', '1:a', '-map', '1:s',
                    '-c', 'copy', '-map_metadata', '1', '-movflags', '+faststart', dst], check=True)
    os.remove(silent)
    print('done', dst, n, 'frames')


if __name__ == '__main__':
    main()
