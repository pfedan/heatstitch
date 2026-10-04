import { formatNumber, t } from '../i18n';
import type { Settings } from '../settings';

export interface PlayerModel {
  /** Number of stitches in the design. */
  total: number;
  /** Stitch numbers (1-based) where each color block starts. */
  blockStarts: number[];
  /** Color blocks as stitch ranges [start, end) with their thread color, drawn on the bar. */
  sections: { start: number; end: number; color: string }[];
  /** Estimated sewing time in seconds up to stitch k. */
  timeAt: (k: number) => number;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const clock = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/**
 * The sewing sequence bar under the canvas: shows the design sewn up to a stitch, plays it at a
 * multiple of the machine speed, steps by stitch or color block.
 */
export class Player {
  readonly root = $<HTMLElement>('player');
  private slider = $<HTMLInputElement>('player-pos');
  private info = $<HTMLElement>('player-info');
  private speed = $<HTMLSelectElement>('player-speed');
  private toggleBtn = this.root.querySelector<HTMLButtonElement>('[data-play="toggle"]')!;
  private sections = $<HTMLElement>('player-sections');
  private rest = document.createElement('div');
  private model: PlayerModel = { total: 0, blockStarts: [], sections: [], timeAt: () => 0 };
  /** Stitches shown; equal to total when the design is complete. */
  pos = 0;
  private playing = false;
  private raf = 0;
  private lastT = 0;
  private carry = 0;

  constructor(
    private s: Settings,
    private changed: () => void,
  ) {
    this.speed.value = String(s.playSpeed);
    this.speed.addEventListener('change', () => {
      s.playSpeed = Number(this.speed.value);
      changed();
    });
    this.slider.addEventListener('input', () => {
      this.pause();
      this.set(Number(this.slider.value));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-play]').forEach((b) =>
      b.addEventListener('click', () => {
        const a = b.dataset.play;
        if (a === 'toggle') this.toggle();
        else if (a === 'prev') this.step(-1);
        else if (a === 'next') this.step(1);
        else if (a === 'block-prev') this.block(-1);
        else this.block(1);
      }),
    );
  }

  get complete(): boolean {
    return this.pos >= this.model.total;
  }

  /** A new design (or a new version of it): shows it complete. */
  setModel(m: PlayerModel, keep = false): void {
    const wasComplete = this.complete;
    this.model = m;
    this.slider.max = String(Math.max(1, m.total));
    if (!keep || wasComplete) this.pos = m.total;
    else this.pos = Math.min(this.pos, m.total);
    if (!m.total) this.pause();
    // The bar shows each color block in its thread color; what is not sewn yet is dimmed.
    this.rest.className = 'rest';
    this.sections.replaceChildren(
      ...m.sections.map((sec) => {
        const d = document.createElement('div');
        d.style.left = `${(sec.start / m.total) * 100}%`;
        d.style.width = `${((sec.end - sec.start) / m.total) * 100}%`;
        d.style.background = sec.color;
        return d;
      }),
      this.rest,
    );
    this.render();
  }

  set(k: number): void {
    this.pos = Math.max(0, Math.min(this.model.total, Math.round(k)));
    this.render();
    this.changed();
  }

  step(dir: number): void {
    this.pause();
    this.set(this.pos + dir);
  }

  /** To the start of the current color (or the one before when already there), or to the next one. */
  block(dir: 1 | -1): void {
    this.pause();
    const starts = this.model.blockStarts;
    if (dir > 0) {
      const next = starts.find((b) => b > this.pos + 1);
      this.set(next !== undefined ? next - 1 : this.model.total);
    } else {
      const prev = [...starts].reverse().find((b) => b - 1 < this.pos);
      this.set(prev !== undefined ? prev - 1 : 0);
    }
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  play(): void {
    if (!this.model.total) return;
    if (this.complete) this.pos = 0;
    this.playing = true;
    this.lastT = performance.now();
    this.carry = 0;
    this.render();
    const tick = (now: number) => {
      if (!this.playing) return;
      const dt = Math.min(0.25, (now - this.lastT) / 1000);
      this.lastT = now;
      this.carry += (dt * this.s.machineSpm * this.s.playSpeed) / 60;
      const adv = Math.floor(this.carry);
      this.carry -= adv;
      if (adv) this.set(this.pos + adv);
      if (this.complete) this.pause();
      else this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.render();
  }

  render(): void {
    const m = this.model;
    this.slider.value = String(this.pos);
    this.rest.style.left = `${m.total ? (this.pos / m.total) * 100 : 0}%`;
    this.slider.disabled = !m.total;
    this.info.textContent = m.total
      ? t('player.info', {
          i: formatNumber(this.pos),
          n: formatNumber(m.total),
          time: `${clock(m.timeAt(this.pos))} / ${clock(m.timeAt(m.total))}`,
        })
      : '';
    this.toggleBtn.querySelector('span')!.textContent = this.playing ? '❚❚' : '▶';
    this.toggleBtn.title = t(this.playing ? 'player.pause' : 'player.play');
    this.toggleBtn.classList.toggle('primary', this.playing);
    this.speed.value = String(this.s.playSpeed);
  }
}
