import { effect } from './signal';

type Child = Node | string | number | null | undefined | false | Child[];
type Value<T> = T | (() => T);
type Props = {
  [k: string]: Value<unknown> | ((ev: Event) => void) | undefined;
};

const append = (el: Node, c: Child): void => {
  if (c === null || c === undefined || c === false) return;
  if (Array.isArray(c)) for (const x of c) append(el, x);
  else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
};

const setProp = (el: HTMLElement, k: string, v: unknown): void => {
  if (k === 'class') el.className = String(v ?? '');
  else if (k === 'hidden') el.hidden = !!v;
  else if (k === 'text') el.textContent = String(v ?? '');
  else if (k in el && !k.startsWith('aria-') && !k.startsWith('data-')) (el as unknown as Record<string, unknown>)[k] = v;
  else if (v === false || v === null || v === undefined) el.removeAttribute(k);
  else el.setAttribute(k, v === true ? '' : String(v));
};

/**
 * Builds an element: h('button', { class: 'tool', onclick }, 'Text'). A prop given as a function
 * (other than on…) is reactive: it is set again whenever a signal it reads changes.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (typeof v === 'function') effect(() => setProp(el, k, (v as () => unknown)()));
    else setProp(el, k, v);
  }
  append(el, children);
  return el;
}

/** An SVG icon from the sprite in index.html (`#i-<name>`). */
export function icon(name: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}
