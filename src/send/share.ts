/**
 * Handing the file to another app through the system's share sheet: on an iPad or iPhone to
 * Artspira, mySewnet, a Janome app or Files. Safari shares any file type. Chrome shares only an
 * allowlist of types (pictures, audio, video, PDF, text) without embroidery files, so there the
 * entry stays hidden and the download is the way.
 */

import type { OutputFormat } from '../writers';

type ShareNavigator = { canShare?: (d: { files: File[] }) => boolean; share?: (d: { files: File[]; title?: string }) => Promise<void> };

const fileOf = (name: string, data: BlobPart) => new File([data], name, { type: 'application/octet-stream' });

/** Whether this browser can share a file of that format. */
export function shareSupported(format: OutputFormat): boolean {
  const n = (typeof navigator !== 'undefined' ? navigator : {}) as ShareNavigator;
  if (!n.canShare || !n.share) return false;
  try {
    return n.canShare({ files: [fileOf(`design.${format}`, new Uint8Array(1))] });
  } catch {
    return false;
  }
}

/** Opens the share sheet. Resolves false when the user closed it. */
export async function shareFile(fileName: string, data: Uint8Array): Promise<boolean> {
  const n = navigator as ShareNavigator;
  try {
    await n.share!({ files: [fileOf(fileName, data as BlobPart)], title: fileName });
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return false;
    throw err;
  }
}
