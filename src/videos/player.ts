import { cardPath, VIDEOS, videoByKey, type Lang, type Video } from './catalog';

/**
 * The player of the tutorial videos, on the guide and on the video page: a medium dialog over the
 * page (written by src/build/videoHtml.ts), full screen one tap away. Under the video the parts
 * before and after it; at the end the next part is offered, never started on its own.
 *
 * Subtitles: the voice is German, so the English page starts with English subtitles and the German
 * one without. Whoever picks something else gets it again next time. They come from the same host
 * as the video, which needs a CORS request: a first fetch of one subtitle file tells whether that
 * host allows it; where it does not (the guide shown from another origin), the video plays without
 * them and the subtitle switch goes away.
 */

const CC_KEY = 'heatstitch.videoSubtitles';

const TEXT = {
  part: { de: 'Teil', en: 'Part' },
  next: { de: 'Weiter mit', en: 'Next up' },
  again: { de: 'Nochmal ansehen', en: 'Watch again' },
  last: { de: 'Das war der letzte Teil.', en: 'That was the last part.' },
  all: { de: 'Alle Videos', en: 'All videos' },
  prevLabel: { de: 'Voriger Teil', en: 'Previous part' },
  nextLabel: { de: 'Nächster Teil', en: 'Next part' },
  kinds: {
    pes: ['Stickmuster', 'embroidery file'],
    dst: ['Stickmuster', 'embroidery file'],
    svg: ['Vektorgrafik', 'vector image'],
    jpg: ['Bild', 'image'],
    jpeg: ['Bild', 'image'],
    png: ['Bild', 'image'],
  } as Record<string, [string, string]>,
};

const lang = (): Lang => (document.documentElement.dataset.lang === 'en' || document.documentElement.lang === 'en' ? 'en' : 'de');

function storedCc(): string | null {
  try {
    const v = localStorage.getItem(CC_KEY);
    return v === 'off' || v === 'de' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

function storeCc(v: string): void {
  try {
    localStorage.setItem(CC_KEY, v);
  } catch {
    // Private windows and blocked storage: the choice holds for this visit only.
  }
}

/** A video without a card picture yet shows its poster instead. */
function fallBackToPoster(img: HTMLImageElement): void {
  const poster = img.dataset.poster;
  if (!poster) return;
  const swap = () => {
    if (img.src !== poster) img.src = poster;
  };
  if (img.complete && img.naturalWidth === 0) swap();
  else img.addEventListener('error', swap, { once: true });
}

export function initVideos(): void {
  const dialog = document.getElementById('video-dialog') as HTMLDialogElement | null;
  if (!dialog) return;
  const base = dialog.dataset.base ?? '';
  const dialogTitle = document.getElementById('video-dialog-title') as HTMLElement;
  const stage = document.getElementById('video-dialog-stage') as HTMLElement;
  const ccGroup = dialog.querySelector<HTMLElement>('.video-cc')!;
  const ccButtons = Array.from(ccGroup.querySelectorAll<HTMLButtonElement>('button[data-cc]'));
  const prevBtn = document.getElementById('video-prev') as HTMLButtonElement;
  const nextBtn = document.getElementById('video-next') as HTMLButtonElement;
  const filesMenu = document.getElementById('video-files') as HTMLDetailsElement;
  const filesList = document.getElementById('video-files-menu') as HTMLElement;

  let cc = storedCc() ?? (lang() === 'en' ? 'en' : 'off');
  let player: HTMLVideoElement | null = null;
  let current: Video | null = null;
  let subtitlesAllowed: Promise<boolean> | null = null;
  let filesRun = 0;

  const title = (v: Video) => `${TEXT.part[lang()]} ${v.part} · ${v.title[lang()]}`;
  const neighbour = (v: Video, step: number): Video | undefined => VIDEOS[VIDEOS.indexOf(v) + step];

  function showSubtitles(which: string): void {
    cc = which;
    for (const b of ccButtons) b.setAttribute('aria-pressed', String(b.dataset.cc === which));
    if (!player) return;
    for (const t of Array.from(player.textTracks)) t.mode = t.language === which ? 'showing' : 'disabled';
  }
  for (const b of ccButtons)
    b.addEventListener('click', () => {
      showSubtitles(b.dataset.cc ?? 'off');
      storeCc(cc);
    });

  function closePlayer(): void {
    if (player) {
      player.pause();
      player.removeAttribute('src');
      player.load();
      player.remove();
      player = null;
    }
    current = null;
    if (dialog!.open) dialog!.close();
  }
  document.getElementById('video-close')?.addEventListener('click', closePlayer);
  dialog.addEventListener('close', closePlayer);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closePlayer();
  });
  document.getElementById('video-full')?.addEventListener('click', () => {
    const v = player as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!v) return;
    if (v.requestFullscreen) void v.requestFullscreen();
    else v.webkitEnterFullscreen?.();
  });

  // Files that belong to a video (the embroidery file or picture the video works with) hang in a
  // small menu of the dialog. A HEAD request drops the ones the host does not have, and where the
  // host refuses the request the names stay as given.
  function offerFiles(v: Video): void {
    const run = ++filesRun;
    filesMenu.open = false;
    filesMenu.hidden = true;
    filesList.replaceChildren();
    if (!v.files.length) return;
    const items = v.files.map((name) => {
      const url = `${base}${v.key}-${name}`;
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.append(name);
      const kind = TEXT.kinds[name.split('.').pop()?.toLowerCase() ?? ''];
      if (kind) {
        const small = document.createElement('small');
        for (const [l, text] of [['de', kind[0]], ['en', kind[1]]]) {
          const span = document.createElement('span');
          span.lang = l;
          span.textContent = text;
          small.append(span);
        }
        a.append(small);
      }
      a.addEventListener('click', () => (filesMenu.open = false));
      li.append(a);
      const exists = fetch(url, { method: 'HEAD', mode: 'cors' })
        .then((r) => r.ok)
        .catch(() => true);
      return { li, exists };
    });
    void Promise.all(items.map((i) => i.exists)).then((found) => {
      if (run !== filesRun || !dialog!.open) return;
      const kept = items.filter((_, i) => found[i]).map((i) => i.li);
      filesList.replaceChildren(...kept);
      filesMenu.hidden = kept.length === 0;
    });
  }
  dialog.addEventListener('click', (e) => {
    if (filesMenu.open && !filesMenu.contains(e.target as Node)) filesMenu.open = false;
  });
  dialog.addEventListener('close', () => (filesMenu.open = false));

  /** The parts before and after, under the video: a small picture, the part and its title. */
  function step(btn: HTMLButtonElement, v: Video | undefined, label: string, arrow: 'prev' | 'next'): void {
    btn.hidden = !v;
    if (!v) return;
    const img = Object.assign(document.createElement('img'), { src: import.meta.env.BASE_URL + cardPath(v.key), alt: '', width: 64, height: 48 });
    img.dataset.poster = `${base}${v.key}.jpg`;
    fallBackToPoster(img);
    const text = document.createElement('span');
    text.className = 'video-step-text';
    const small = document.createElement('small');
    small.textContent = `${label} · ${v.length}`;
    const name = document.createElement('span');
    name.className = 'video-step-title';
    name.textContent = ` · ${v.title[lang()]}`;
    const line = document.createElement('span');
    line.append(`${TEXT.part[lang()]} ${v.part}`, name);
    text.append(small, line);
    const chevron = document.createElement('span');
    chevron.className = 'video-step-arrow';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = arrow === 'prev' ? '‹' : '›';
    btn.replaceChildren(...(arrow === 'prev' ? [chevron, img, text] : [text, img, chevron]));
    btn.onclick = () => open(v);
  }

  /** At the end: the next part to start, and the same one again. Nothing starts by itself. */
  function offerNext(v: Video): void {
    stage.querySelector('.video-end')?.remove();
    const next = neighbour(v, 1);
    const end = document.createElement('div');
    end.className = 'video-end';
    if (next) {
      const p = document.createElement('p');
      p.textContent = TEXT.next[lang()];
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'video-end-next';
      const img = Object.assign(document.createElement('img'), { src: import.meta.env.BASE_URL + cardPath(next.key), alt: '', width: 160, height: 120 });
      img.dataset.poster = `${base}${next.key}.jpg`;
      fallBackToPoster(img);
      const text = document.createElement('span');
      const small = document.createElement('small');
      small.textContent = `${TEXT.part[lang()]} ${next.part} · ${next.length}`;
      text.append(small, next.title[lang()]);
      go.append(img, text);
      go.addEventListener('click', () => open(next));
      end.append(p, go);
    } else {
      const p = document.createElement('p');
      p.textContent = TEXT.last[lang()];
      end.append(p);
      if (!document.querySelector('.video-page')) {
        const all = Object.assign(document.createElement('a'), { className: 'video-end-all', href: 'videos.html', textContent: TEXT.all[lang()] });
        end.append(all);
      }
    }
    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'video-end-again';
    again.textContent = TEXT.again[lang()];
    again.addEventListener('click', () => {
      end.remove();
      if (player) {
        player.currentTime = 0;
        void player.play();
      }
    });
    end.append(again);
    stage.append(end);
    (end.querySelector<HTMLButtonElement>('.video-end-next') ?? again).focus();
  }

  function open(v: Video): void {
    current = v;
    const build = (subtitles: boolean) => {
      if (current !== v) return;
      const el = document.createElement('video');
      el.controls = true;
      el.autoplay = true;
      el.playsInline = true;
      el.preload = 'metadata';
      el.poster = `${base}${v.key}.jpg`;
      if (subtitles) {
        el.crossOrigin = 'anonymous';
        for (const l of ['de', 'en']) {
          const track = document.createElement('track');
          track.kind = 'subtitles';
          track.srclang = l;
          track.label = l === 'de' ? 'Deutsch' : 'English';
          track.src = `${base}${v.key}.${l}.vtt`;
          el.append(track);
        }
      }
      el.src = `${base}${v.key}.mp4`;
      el.addEventListener('ended', () => offerNext(v));
      el.addEventListener('play', () => stage.querySelector('.video-end')?.remove());
      player?.remove();
      player = el;
      stage.replaceChildren(el);
      ccGroup.hidden = !subtitles;
      showSubtitles(subtitles ? cc : 'off');
      el.focus();
    };
    if (player) {
      player.pause();
      player.remove();
      player = null;
    }
    dialogTitle.textContent = title(v);
    offerFiles(v);
    step(prevBtn, neighbour(v, -1), TEXT.prevLabel[lang()], 'prev');
    step(nextBtn, neighbour(v, 1), TEXT.nextLabel[lang()], 'next');
    stage.replaceChildren();
    if (!dialog!.open) dialog!.showModal();
    subtitlesAllowed ??= fetch(`${base}${v.key}.de.vtt`, { mode: 'cors' })
      .then((r) => r.ok)
      .catch(() => false);
    void subtitlesAllowed.then((ok) => {
      if (dialog!.open) build(ok);
    });
  }

  // Cards and the links beside the guide's sections open the player here; without the script the
  // links lead to the video page.
  for (const el of document.querySelectorAll<HTMLElement>('.video[data-key] .video-play, a.video-ref[data-key]')) {
    const key = el.closest<HTMLElement>('[data-key]')?.dataset.key ?? '';
    const v = videoByKey(key);
    if (!v) continue;
    el.addEventListener('click', (e) => {
      e.preventDefault();
      open(v);
    });
  }
  for (const img of document.querySelectorAll<HTMLImageElement>('img[data-poster]')) fallBackToPoster(img);
}
