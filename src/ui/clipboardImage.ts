import type { Key } from '../i18n';

/**
 * What the clipboard holds, read at once: a paste event lets its data be read only while it runs,
 * so everything is taken out first and looked at afterwards.
 */
export interface ClipData {
  /** Images and copied files, in the order the clipboard gave them. */
  blobs: Blob[];
  html: string;
  text: string;
}

/** A picture found in the clipboard, or the hint why there is none. */
export type Clipped = { file: File } | { hint: Key };

const IMAGE_NAME = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;
const isImage = (b: Blob) => b.type.startsWith('image/') || (b instanceof File && IMAGE_NAME.test(b.name));
const isSvgBlob = (b: Blob) => b.type === 'image/svg+xml' || (b instanceof File && /\.svg$/i.test(b.name));
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/avif': 'avif' };

/** The data of a paste event (Strg+V): copied files, a copied picture, HTML and text. */
export function fromTransfer(dt: DataTransfer): ClipData {
  const blobs: Blob[] = [...dt.files];
  if (!blobs.length) {
    for (const item of dt.items) {
      const f = item.kind === 'file' ? item.getAsFile() : null;
      if (f) blobs.push(f);
    }
  }
  return { blobs, html: dt.getData('text/html'), text: dt.getData('text/plain') || dt.getData('text/uri-list') };
}

/** The clipboard read by the button. Throws when the browser does not let the page read it. */
export async function fromClipboard(): Promise<ClipData> {
  const items = await navigator.clipboard.read();
  const out: ClipData = { blobs: [], html: '', text: '' };
  for (const item of items) {
    for (const type of item.types) {
      if (type.startsWith('image/')) out.blobs.push(await item.getType(type));
      else if (type === 'text/html' && !out.html) out.html = await (await item.getType(type)).text();
      else if (type === 'text/plain' && !out.text) out.text = await (await item.getType(type)).text();
    }
  }
  return out;
}

/** SVG markup out of a text, from `<svg` to its last `</svg>`; null when there is none. */
export function svgMarkup(text: string): string | null {
  const start = text.search(/<svg[\s>]/i);
  const end = text.toLowerCase().lastIndexOf('</svg>');
  return start >= 0 && end > start ? text.slice(start, end + 6) : null;
}

/** An image address in a text: a data URL, or a web address standing alone. */
export function imageAddress(text: string): string | null {
  const s = text.trim();
  if (/^data:image\/[\w.+-]+[;,]/i.test(s)) return s.replace(/\s+/g, '');
  return /^https?:\/\/\S+$/i.test(s) ? s : null;
}

/** The last part of a web address as a file name ("rose.png"), or '' for a data URL. */
export function addressName(url: string): string {
  if (url.startsWith('data:')) return '';
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch {
    return '';
  }
}

/**
 * The picture in the clipboard, in the order that keeps the most: an SVG (exact shapes and colors),
 * then a copied image or image file, then SVG markup or an image in copied HTML (a part of a web page),
 * then SVG markup, a data URL or an image address as text. `pasted` names a picture without a name.
 */
export async function clippedImage(data: ClipData, pasted: string): Promise<Clipped> {
  const named = (b: Blob, name: string) => {
    const ext = EXT[b.type] ?? 'png';
    return new File([b], name ? (IMAGE_NAME.test(name) ? name : `${name}.${ext}`) : `${pasted}.${ext}`, { type: b.type });
  };
  const images = data.blobs.filter(isImage);
  const blob = images.find(isSvgBlob) ?? images[0];
  if (blob) {
    // A screenshot comes as "image.png": it gets the name of a pasted picture.
    const name = blob instanceof File && blob.name && !/^image\.\w+$/i.test(blob.name) ? blob.name : '';
    return { file: named(blob, name) };
  }

  let address: string | null = null;
  if (data.html) {
    const svg = svgMarkup(data.html);
    if (svg) return { file: new File([svg], `${pasted}.svg`, { type: 'image/svg+xml' }) };
    const img = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(data.html);
    if (img) address = imageAddress((img[1] ?? img[2] ?? img[3]).replace(/&amp;/g, '&'));
  }
  if (!address && data.text) {
    const svg = svgMarkup(data.text);
    if (svg) return { file: new File([svg], `${pasted}.svg`, { type: 'image/svg+xml' }) };
    address = imageAddress(data.text);
  }
  if (!address) return { hint: data.blobs.length ? 'image.paste.noImageFile' : 'image.paste.none' };

  let b: Blob;
  try {
    const res = await fetch(address);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    b = await res.blob();
  } catch {
    // Most web pages do not give their pictures to other pages: copying the picture itself works.
    return { hint: address.startsWith('data:') ? 'image.paste.none' : 'image.paste.web' };
  }
  if (!isImage(b) && !/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(address)) return { hint: 'image.paste.web' };
  const type = b.type.startsWith('image/') ? b.type : address.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : b.type;
  return { file: named(new Blob([b], { type }), addressName(address)) };
}
