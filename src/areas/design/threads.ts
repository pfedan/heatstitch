import { formatNumber, getLang, t } from '../../i18n';
import { recolorBlock } from '../../model/border';
import type { Pattern, ThreadColor } from '../../model/pattern';
import { colorBlocks, type ColorBlock } from '../../model/sequence';
import { threadMeters, threadUse } from '../../model/threadUse';
import { canRun, runCommand } from '../../shell/commands';
import { h } from '../../shell/h';
import { toast } from '../../shell/ui';
import { BROTHER, catalogOf, catalogPicked, catalogsNow, chooseCatalog, chosenCatalog, inCatalog, nearest, threadCode, type Catalog } from '../../threads/catalog';
import { cssColor, hexColor, ThreadPicker } from '../../ui/threadPicker';
import type { DesignApp } from './index';

const same = (a: ThreadColor, b: ThreadColor) => a.r === b.r && a.g === b.g && a.b === b.b && a.name === b.name && a.catalog === b.catalog;
const spoolKey = (c: ThreadColor) => `${c.r},${c.g},${c.b},${c.name ?? ''},${c.catalog ?? ''}`;

/**
 * "Garne" on the design page: the colors of the design in sewing order with their threads (a click
 * changes one), the thread brand with switching every color to it in one step, and the color list.
 */
export function createThreads(app: DesignApp): { el: HTMLElement; render: (p: Pattern) => string; canSwitch: () => boolean; switchAll: () => void } {
  const picker = new ThreadPicker('.dt-sw');
  const list = h('ul', { class: 'dt-list' });
  const brand = h('select', { class: 'dt-brand' });
  const brandLabel = h('span', null);
  const state = h('p', { class: 'dt-state muted', role: 'status' });
  const switchBtn = h('button', { type: 'button', class: 'dt-switch', onclick: () => switchAll() });
  const listBtn = h('button', { type: 'button', class: 'link dt-listlink', onclick: () => runCommand('colorList.open') });
  const total = h('p', { class: 'dt-total' });
  const el = h('div', { class: 'dt' }, list, total, h('label', { class: 'dt-brandrow' }, brandLabel, brand), h('div', { class: 'dt-actions' }, state, switchBtn), listBtn);

  brand.addEventListener('change', () => {
    chooseCatalog(brand.value);
    last = '';
    render(app.files.active?.pattern ?? null);
  });

  let last = '';
  let blocks: ColorBlock[] = [];
  let summary = '';

  /** The brand chosen, or, before anyone chose, the brand the colors are from. */
  const catalog = (): Catalog | undefined =>
    (catalogPicked() ? undefined : catalogOf(blocks.map((b) => b.color))) ??
    catalogsNow().find((c) => c.id === chosenCatalog()) ??
    catalogsNow().find((c) => c.id === BROTHER);
  /** Per color, the nearest thread of the chosen brand when it is not one of them. */
  const matches = () => {
    const cat = catalog();
    return blocks.map((b) => (cat && !inCatalog(b.color, cat) ? nearest(b.color, cat, 1)[0] : undefined));
  };
  const canSwitch = () => !!app.files.active?.pattern && matches().some(Boolean);

  function switchAll(): void {
    const f = app.files.active;
    const cat = catalog();
    if (!f?.pattern || !cat) return;
    const m = matches();
    let next = f.pattern;
    blocks.forEach((b, i) => {
      const to = m[i]?.thread;
      if (to && !same(to, b.color)) next = recolorBlock(next, i, { ...to });
    });
    if (next === f.pattern) return;
    // Only the colors change, so the density measurement still holds.
    app.applyEdit(next, f.measurement);
    toast(t('colorList.switched', { catalog: cat.name }), { label: t('edit.undo'), run: () => runCommand('edit.undo') });
  }

  let blocksOf: Pattern | null = null;
  const render = (p: Pattern | null): string => {
    if (!p) return '';
    // The color list may only be opened while the frame offers it.
    listBtn.disabled = !canRun('colorList.open');
    const cats = catalogsNow();
    const key = [getLang(), chosenCatalog(), catalogPicked(), cats.length, app.settings.profile.fabric].join('|');
    if (last === key && blocksOf === p) return summary;
    last = key;
    blocksOf = p;
    blocks = colorBlocks(p);
    const use = threadUse(p, app.settings.profile.fabric);
    const spools = new Set(blocks.map((b) => spoolKey(b.color))).size;
    summary = blocks.length ? t('design.threads.count', { colors: blocks.length, spools, n: blocks.length === 1 && spools === 1 ? 1 : 0 }) : '';

    list.replaceChildren(
      ...blocks.map((b, i) => {
        const code = threadCode(b.color);
        const sw = h('button', {
          type: 'button',
          class: 'dt-sw',
          title: t('design.threads.recolor', { n: b.index + 1 }),
          'aria-label': t('design.threads.recolor', { n: b.index + 1 }),
          onclick: (e: Event) => open(i, e.currentTarget as HTMLElement),
        });
        sw.style.background = cssColor(b.color);
        return h(
          'li',
          { class: 'dt-row', title: `${b.color.name ?? hexColor(b.color)}${code ? ` · ${code}` : ''} · ${formatNumber(b.stitches)} ${t('stats.stitches')} · ${t('design.threads.length', { m: threadMeters(use.top[b.index] ?? 0) })}` },
          h('span', { class: 'dt-num' }, String(b.index + 1)),
          sw,
          h('span', { class: 'dt-text' }, h('span', { class: 'dt-name' }, b.color.name || hexColor(b.color)), code ? h('span', { class: 'dt-code' }, code) : null),
          h('span', { class: 'dt-count' }, `${threadMeters(use.top[b.index] ?? 0)} m`),
        );
      }),
    );
    if (!blocks.length) list.append(h('li', { class: 'muted dt-none' }, t('design.threads.none')));
    // All the thread, and the bobbin thread small below: estimates (see threadUse).
    total.hidden = !blocks.length;
    total.title = t('design.threads.estimate');
    total.replaceChildren(
      h('span', { class: 'dt-total-row' }, h('span', null, t('design.threads.total')), h('span', { class: 'dt-total-m' }, `${threadMeters(use.topTotal)} m`)),
      h('span', { class: 'dt-bobbin' }, t('design.threads.bobbin', { m: threadMeters(use.bobbin) })),
    );

    // The brand: the same choice as in the thread picker and the color list.
    brandLabel.textContent = t('design.threads.brand');
    const common = cats.filter((c) => c.common);
    const more = cats.filter((c) => !c.common);
    const group = (label: string, cs: Catalog[]) => {
      const g = h('optgroup', null);
      g.label = label;
      for (const c of cs) g.append(new Option(c.name, c.id));
      return g;
    };
    brand.replaceChildren(group(t('threads.common'), common), ...(more.length ? [group(t('threads.more'), more)] : []));
    const cat = catalog();
    brand.value = cat?.id ?? BROTHER;

    const off = matches().filter(Boolean).length;
    state.textContent = !cat || !blocks.length ? '' : off ? t('design.threads.mixed', { n: off, catalog: cat.name }) : t('design.threads.allIn', { catalog: cat.name });
    switchBtn.hidden = !off;
    if (cat) {
      switchBtn.textContent = t('design.threads.switch', { catalog: cat.name });
      switchBtn.title = t('design.threads.switchHint', { catalog: cat.name });
    }
    listBtn.textContent = `${t('design.threads.list')} …`;
    listBtn.title = t('design.threads.listHint');
    return summary;
  };

  /** The thread picker next to a swatch, to change that color. */
  const open = (i: number, anchor: HTMLElement) => {
    const b = blocks[i];
    if (!b) return;
    picker.toggle(anchor, {
      key: `design-${b.index}`,
      title: t('design.threads.recolor', { n: b.index + 1 }),
      current: b.color,
      onPick: (c) => {
        const f = app.files.active;
        if (f?.pattern && !same(c, b.color)) app.applyEdit(recolorBlock(f.pattern, b.index, c), f.measurement);
      },
    });
  };

  return { el, render: (p) => render(p), canSwitch, switchAll };
}
