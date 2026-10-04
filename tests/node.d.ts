// The few Node APIs the tests use, so the project does not need @types/node.
declare module 'node:fs' {
  export function existsSync(path: URL): boolean;
  export function mkdirSync(path: URL, opts?: { recursive?: boolean }): void;
  export function readFileSync(path: URL): Uint8Array;
  export function writeFileSync(path: URL, data: Uint8Array): void;
}
declare const process: { env: Record<string, string | undefined> };
