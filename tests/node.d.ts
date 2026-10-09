// The few Node APIs the tests use, so the project does not need @types/node.
declare module 'node:fs' {
  export function existsSync(path: URL | string): boolean;
  export function mkdirSync(path: URL | string, opts?: { recursive?: boolean }): void;
  export function mkdtempSync(prefix: string): string;
  export function readdirSync(path: URL | string): string[];
  export function readFileSync(path: URL | string): Uint8Array;
  export function readFileSync(path: URL | string, encoding: 'utf8'): string;
  export function writeFileSync(path: URL | string, data: Uint8Array | string): void;
}
declare module 'node:os' {
  export function tmpdir(): string;
}
declare module 'node:path' {
  const path: { join(...parts: string[]): string };
  export default path;
}
declare module 'node:url' {
  export function pathToFileURL(path: string): URL;
}
declare const process: { env: Record<string, string | undefined> };
