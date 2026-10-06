import './ampel.css';
import type { Mode, Settings } from '../../settings';
import type { FileList } from '../../ui/fileList';
import type { Pattern } from '../../model/pattern';
import type { Sequence } from '../../app/types';
import type { WorkerClient } from '../../density/client';
import type { Measurement } from '../../validation/measure';
import type { Zone } from '../../validation/validate';
import { FABRICS, type FabricId } from '../../validation/profiles';
import { command, runCommand } from '../../shell/commands';
import { settledBy } from '../../validation/acks';
import { h } from '../../shell/h';
import { toast } from '../../shell/ui';
import { formatNumber, getLang, onLangChange, t, type Key } from '../../i18n';
import { FINDING_TYPES, type AmpelReport, type FindingType, type Light, type MmBox, type Pending, type ReadyFix, type ReasonSummary, type RestProposal } from './engine';
import { createLive } from './live';

/** What the traffic light needs from the rest of the app. */
export interface AmpelApp {
  readonly settings: Settings;
  readonly files: FileList;
  readonly seq: (p: Pattern) => Sequence;
  readonly validator: WorkerClient;
  readonly setMode: (m: Mode) => void;
  readonly redraw: () => void;
  readonly selectZone: (z: Zone) => void;
  /** Stores a fixed design as one undo step. */
  readonly commit: (p: Pattern, m: Measurement) => void;
  readonly undo: () => void;
  readonly busy: () => boolean;
  /** Draws `before` and `after` side by side into `canvas`, each showing `box` whole. */
  readonly drawCompare: (canvas: HTMLCanvasElement, box: MmBox, before: Pattern, after: Pattern, labels: [string, string]) => void;
}

/** How many reasons the light names. */
const SHOWN_REASONS = 3;
/**
 * From this many objects the search for fixes waits to be asked for: it would keep the page busy
 * for a long while (the cat with 60 objects takes about 40 s). On a phone it always waits.
 */
const LARGE_OBJECTS = 40;
const PHONE = typeof matchMedia === 'function' ? matchMedia('(max-width: 760px)') : null;
/** The light's colours in the classes of the check area (src/areas/check/check.css). */
const LEVEL: Record<Light, string> = { green: 'safe', yellow: 'caution', red: 'critical' };
const mm = (v: number) => formatNumber(v < 10 ? Math.round(v * 10) / 10 : Math.round(v), v < 10 && v % 1 ? 1 : 0);
/** First letter upper case (a figure used as a sentence). */
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const fabricName = (f: FabricId) => t(`ampel.fabric.${f}` as Key);
const typeName = (x: FindingType | 'all') => t(`ampel.type.${x}` as Key);

/**
 * The traffic light "Klappt das?" (wow feature W2): one colour per fabric, the three main reasons
 * with their worst spot, one fix per kind of finding and "Alles beheben". It sits on top of the
 * summary card in Prüfen; its colour shows at "Prüfen" in the top bar, in Gestalten too. What it
 * shows comes from an AmpelEngine (engine.ts); the new correction engine through live.ts.
 */
export function initAmpel(app: AmpelApp): { update: () => void } {
  const engine = createLive({
    files: app.files,
    seq: app.seq,
    validator: app.validator,
    trimMm: () => app.settings.trimMm,
    commit: app.commit,
    busy: app.busy,
    onRequest: () => {
      const p = app.files.active?.pattern;
      return !!PHONE?.matches || (!!p && app.seq(p).objects.length >= LARGE_OBJECTS);
    },
  });
  let version = 0;
  engine.onChange(() => {
    version++;
    app.redraw();
  });

  const head = document.getElementById('ampel-head');
  const body = document.getElementById('ampel-body');
  const light = document.getElementById('check-light');
  const badge = document.getElementById('check-badge');
  const card = document.getElementById('check-summary');

  const loaded = () => !!app.files.active?.pattern;
  const current = () => engine.report();
  const active = (r: AmpelReport | null = current()) => (r ? r.fabrics[r.fabric] : null);
  const ready = <T,>(p: Pending<T> | undefined): T | null => (p?.state === 'ready' ? p.value : null);
  const directOf = (x: FindingType) => ready(active()?.fixes?.[x]?.direct);
  const restOf = (x: FindingType) => ready(active()?.fixes?.[x]?.rest);
  /** Whether there are fixes still to be worked out. */
  const searchable = (a = active()) => !!a && (FINDING_TYPES.some((x) => a.fixes?.[x]?.direct.state === 'pending') || a.all?.state === 'pending');

  /** Into the check view, the card in sight. */
  function open(): void {
    if (app.settings.mode !== 'density') app.setMode('density');
    requestAnimationFrame(() => card?.scrollIntoView({ block: 'nearest' }));
  }

  /** The zone of the current findings that best covers `b` (most shared area), to select and zoom to. */
  function jump(b: MmBox): void {
    const zones = app.files.active?.validation?.zones ?? [];
    const area = (x: MmBox) => Math.max(0, x.maxX - x.minX) * Math.max(0, x.maxY - x.minY);
    const iou = (z: Zone) => {
      const i = area({ minX: Math.max(b.minX, z.bbox.minX), minY: Math.max(b.minY, z.bbox.minY), maxX: Math.min(b.maxX, z.bbox.maxX), maxY: Math.min(b.maxY, z.bbox.maxY) });
      return i / (area(b) + area(z.bbox) - i || 1);
    };
    let best: Zone | null = null;
    let score = 0;
    for (const z of zones) {
      const s = iou(z);
      if (s > score) [best, score] = [z, s];
    }
    if (!best) return;
    if (app.settings.mode !== 'density') app.setMode('density');
    app.selectZone(best);
  }

  function apply(fix: ReadyFix | null): void {
    if (!fix) return;
    const done = engine.apply(fix);
    if (!done) return toast(t('ampel.stale'));
    toast(t('ampel.done', { type: typeName(fix.type), mm: mm(fix.outcome.fixedMm2) }), { label: t('ampel.undo'), run: app.undo });
  }

  /** The visible proposal shown with its before and after in the card, by kind (null: none). */
  let looking: FindingType | null = null;
  function offer(type: FindingType): void {
    looking = looking === type ? null : type;
    last = [];
    update();
  }

  /** Takes back what fixes changed on the objects that still remember it, as one undo step. */
  function revertAll(): void {
    const n = engine.revertable().length;
    if (!engine.revertObjects()) return;
    looking = null;
    toast(n === 1 ? t('ampel.reverted.one') : t('ampel.reverted', { n }), { label: t('ampel.undo'), run: app.undo });
  }

  /** Another fabric: set as the design's material, as in the material panel. */
  function pickFabric(f: FabricId): void {
    const sel = document.getElementById('fabric') as HTMLSelectElement | null;
    if (!sel || sel.value === f) return;
    sel.value = f;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Commands --------------------------------------------------------------------------------------
  const G = 'ampel.group' as const;
  command({ id: 'ampel.open', label: 'ampel.open', group: G, when: loaded, run: open });
  command({ id: 'ampel.worst', label: 'ampel.jump', group: G, when: () => !!active()?.verdict.worst, run: () => jump(active()!.verdict.worst!.bbox) });
  for (const x of FINDING_TYPES) {
    command({ id: `ampel.fix.${x}`, label: `ampel.cmd.fix.${x}` as Key, group: G, when: () => !!directOf(x), run: () => apply(directOf(x)) });
    command({ id: `ampel.rest.${x}`, label: `ampel.cmd.rest.${x}` as Key, group: G, when: () => !!restOf(x) && !app.busy(), run: () => offer(x) });
  }
  command({ id: 'ampel.search', label: 'ampel.search', group: G, when: () => loaded() && engine.onRequest() && searchable(), run: () => engine.search() });
  command({ id: 'ampel.revert', label: 'ampel.revert', group: G, when: () => loaded() && engine.revertable().length > 0, run: revertAll });
  command({ id: 'ampel.fix.all', label: 'ampel.cmd.fix.all', group: G, when: () => !!ready(active()?.all), run: () => apply(ready(active()?.all)) });
  for (const f of FABRICS) {
    command({ id: `ampel.fabric.${f.id}`, label: `ampel.cmd.fabric.${f.id}` as Key, group: G, when: () => loaded() && app.settings.mode !== 'image' && app.settings.profile.fabric !== f.id, run: () => pickFabric(f.id) });
  }

  // View ------------------------------------------------------------------------------------------
  const verdictText = (l: Light, f: FabricId) => t(`ampel.verdict.${l}` as Key, { fabric: fabricName(f) });

  /** "gut für Webware, Kappe · riskant auf Strick": the other fabrics grouped by their colour. */
  function others(r: AmpelReport): string {
    const by: Record<Light, string[]> = { green: [], yellow: [], red: [] };
    for (const f of FABRICS) if (f.id !== r.fabric) by[r.fabrics[f.id].verdict.light].push(fabricName(f.id));
    const own = r.fabrics[r.fabric].verdict.light;
    if (by[own].length === FABRICS.length - 1) return t(`ampel.others.all.${own}` as Key);
    return (['green', 'yellow', 'red'] as Light[])
      .filter((l) => by[l].length)
      .map((l) => t(`ampel.others.${l}` as Key, { list: by[l].join(', ') }))
      .join(' · ');
  }

  function fabricChips(r: AmpelReport): HTMLElement {
    return h(
      'div',
      { class: 'ampel-fabrics', role: 'group', 'aria-label': t('ampel.fabrics') },
      FABRICS.map((f) => {
        const v = r.fabrics[f.id].verdict;
        const on = f.id === r.fabric;
        return h(
          'button',
          {
            type: 'button',
            class: `ampel-fab ${LEVEL[v.light]}`,
            'aria-pressed': String(on),
            title: t('ampel.fabric.pick', { fabric: t(`fabric.${f.id}` as Key), verdict: t(`ampel.light.${v.light}` as Key) }),
            onclick: () => runCommand(`ampel.fabric.${f.id}`),
          },
          h('span', { class: 'dot', 'aria-hidden': 'true' }),
          fabricName(f.id),
        );
      }),
    );
  }

  /** The figures of a fix: "behebt 22 von 30 mm²". */
  const fixes = (o: { fixedMm2: number; ofMm2: number }, short = true) => t(short ? 'ampel.fixes.short' : 'ampel.fixes', { fixed: mm(o.fixedMm2), of: mm(o.ofMm2) });

  function reasonRow(r: ReasonSummary, report: AmpelReport, working: boolean, asked: boolean): HTMLElement {
    const fx = report.fabrics[report.fabric].fixes?.[r.type];
    const area = r.level === 'critical' ? t('ampel.area.critical', { mm: mm(r.targetMm2 || r.areaMm2) }) : t('ampel.area.caution', { mm: mm(r.areaMm2) });
    const spots = t('ampel.spots', { n: r.spots });
    const top = h(
      'button',
      { type: 'button', class: 'ampel-why', title: `${t('ampel.worst', { mm: mm(r.worst.areaMm2) })}`, onclick: () => jump(r.worst.bbox) },
      h('span', { class: `dot ${r.level}`, 'aria-hidden': 'true' }),
      h('span', { class: 'name' }, typeName(r.type)),
      h('span', { class: 'fig' }, `${area} · ${spots}`),
    );
    const actions: HTMLElement[] = [];
    const direct = ready(fx?.direct);
    const rest = ready(fx?.rest);
    if (direct) {
      actions.push(
        h(
          'button',
          {
            type: 'button',
            class: 'ampel-fix',
            title: `${cap(fixes(direct.outcome, false))}. ${t('ampel.fix.hint')} ${t('ampel.fix.after', { light: t(`ampel.light.${direct.outcome.lightAfter}` as Key) })}`,
            onclick: () => runCommand(`ampel.fix.${r.type}`),
          },
          h('b', null, t('ampel.fix')),
          h('span', null, fixes(direct.outcome)),
        ),
      );
    }
    if (rest) {
      const hand = rest.replacesHandEdits ? ` ${t('ampel.rest.hand', { n: rest.replacesHandEdits })}` : '';
      actions.push(
        h(
          'button',
          { type: 'button', class: 'ampel-rest', 'aria-expanded': String(looking === r.type), title: `${cap(fixes(rest.outcome, false))}. ${t('ampel.rest.hint')}${hand}`, onclick: () => runCommand(`ampel.rest.${r.type}`) },
          h('b', null, t('ampel.rest')),
          h('span', null, direct ? t('ampel.rest.left', { mm: mm(rest.outcome.leftMm2) }) : fixes(rest.outcome)),
        ),
      );
    }
    const pending = fx?.direct.state === 'pending' || fx?.rest.state === 'pending';
    if (pending) {
      if (asked) actions.push(h('span', { class: `ampel-wait${working ? ' on' : ''}` }, t('ampel.working')));
    } else if (!direct && !rest && fx && r.targetMm2 > 0) actions.push(h('span', { class: 'ampel-wait' }, t('ampel.noFix')));
    return h('li', { class: 'ampel-reason' }, top, actions.length ? h('div', { class: 'ampel-acts' }, actions) : null, rest && looking === r.type ? restPreview(rest) : null);
  }

  /** The visible proposal: before and after side by side, what it fixes, take over or close. */
  function restPreview(rest: RestProposal): HTMLElement {
    const cv = h('canvas', { class: 'ampel-compare', role: 'img', 'aria-label': t('ampel.rest.compare') }) as HTMLCanvasElement;
    requestAnimationFrame(() => app.drawCompare(cv, rest.preview.box, rest.preview.before, rest.preview.after, [t('plan.before'), t('plan.after')]));
    const hand = rest.replacesHandEdits ? ` ${t('ampel.rest.hand', { n: rest.replacesHandEdits })}` : '';
    const fix = rest.fix ?? null;
    return h(
      'div',
      { class: 'ampel-look' },
      cv,
      h('p', { class: 'small' }, `${cap(fixes(rest.outcome, false))}. ${t('ampel.rest.visible')}${hand}`),
      h(
        'div',
        { class: 'ampel-acts' },
        h('button', { type: 'button', class: 'primary', disabled: !fix, onclick: () => {
          looking = null;
          apply(fix);
        } }, t('ampel.rest.take')),
        h('button', { type: 'button', onclick: () => offer(rest.type as FindingType) }, t('ampel.rest.close')),
      ),
    );
  }

  let last: unknown[] = [];
  function update(): void {
    const f = app.files.active;
    const r = current();
    const key = [f, f?.pattern, f?.validation, f?.acks, getLang(), version, r?.fabric, looking, engine.revertable().length];
    if (key.length === last.length && key.every((k, i) => k === last[i])) return;
    last = key;
    const a = active(r);
    const l = a?.verdict.light;

    // The light in the card and the badge at "Prüfen" (seen from Gestalten too).
    if (light) {
      light.dataset.level = l ? LEVEL[l] : '';
      light.setAttribute('aria-label', l && r ? verdictText(l, r.fabric) : '');
    }
    if (badge) {
      const open = f?.validation ? f.validation.zones.filter((z) => !settledBy(z, f.acks)).length : 0;
      badge.hidden = !l;
      badge.className = `check-badge ampel-badge ${l ? LEVEL[l] : ''}`;
      badge.textContent = l && l !== 'green' && open ? String(open) : '';
      badge.title = l && r ? t('ampel.badge', { verdict: verdictText(l, r.fabric) }) : '';
      badge.setAttribute('aria-label', badge.title);
    }
    if (!head || !body) return;
    if (!f?.pattern) {
      head.replaceChildren();
      body.replaceChildren();
      return;
    }
    if (!r || !a || !l) {
      head.replaceChildren(h('span', { class: 'ampel-q' }, t('ampel.title')), h('strong', { class: 'ampel-verdict pending' }, t('ampel.pending')));
      body.replaceChildren();
      return;
    }
    const verdict = h('strong', { class: 'ampel-verdict', title: t('ampel.rule', { mm: formatNumber(a.verdict.redMinMm2) }) }, verdictText(l, r.fabric));
    const rest = others(r);
    head.replaceChildren(h('span', { class: 'ampel-q' }, t('ampel.title')), verdict, rest ? h('p', { class: 'ampel-others' }, rest) : '');

    const parts: HTMLElement[] = [fabricChips(r)];
    const working = engine.working();
    // On a phone and for large designs the search waits for a click.
    const asked = !engine.onRequest();
    const shown = a.reasons.slice(0, SHOWN_REASONS);
    if (shown.length) parts.push(h('ol', { class: 'ampel-reasons' }, shown.map((x) => reasonRow(x, r, working, asked))));
    else parts.push(h('p', { class: 'muted small' }, t('ampel.none')));
    // "Alles beheben" when more than one kind is fixed, or together it fixes more than any one fix.
    const singles = FINDING_TYPES.map((x) => ready(a.fixes?.[x]?.direct)).filter((x): x is ReadyFix => !!x);
    const allFix = ready(a.all);
    const all = allFix && (singles.length > 1 || allFix.outcome.fixedMm2 > Math.max(0, ...singles.map((x) => x.outcome.fixedMm2)) + 0.5) ? allFix : null;
    if (all) {
      parts.push(
        h(
          'button',
          { type: 'button', class: 'primary ampel-all', title: `${cap(fixes(all.outcome, false))}. ${t('ampel.all.hint')} ${t('ampel.fix.after', { light: t(`ampel.light.${all.outcome.lightAfter}` as Key) })}`, onclick: () => runCommand('ampel.fix.all') },
          h('b', null, t('ampel.all')),
          h('span', null, fixes(all.outcome)),
        ),
      );
    } else if (!asked && searchable(a)) {
      parts.push(
        h(
          'button',
          { type: 'button', class: 'ampel-search', title: t('ampel.search.hint'), onclick: () => runCommand('ampel.search') },
          h('b', null, t('ampel.search')),
          h('span', null, t('ampel.search.time')),
        ),
      );
    } else if (a.all?.state === 'pending' && shown.length > 1) {
      parts.push(h('p', { class: `ampel-wait${working ? ' on' : ''}` }, `${t('ampel.all')}: ${t('ampel.working')}`));
    }
    const back = engine.revertable().length;
    if (back) {
      parts.push(
        h('button', { type: 'button', class: 'ampel-revert', title: t('ampel.revert.hint'), onclick: () => runCommand('ampel.revert') }, back === 1 ? t('ampel.revert.one') : t('ampel.revert.n', { n: back })),
      );
    }
    body.replaceChildren(...parts);
  }

  // Texts follow the language at once, also while the stage is not drawn.
  onLangChange(() => {
    last = [];
    update();
  });

  return { update };
}
