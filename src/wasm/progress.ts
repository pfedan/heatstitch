/**
 * How far the download of the compute core is, for the splash (src/ui/boot.ts).
 *
 * A server that compresses the file (gzip, br) sends the compressed size as Content-Length, or none
 * at all, while the reader counts the bytes after decompression; then the size of the built file
 * (known at build time) is the total. Without either the progress is unknown (null).
 */
export type Progress = (done: number | null) => void;

/** The number of bytes the body of `headers`' response will have once read, or null. */
export function downloadTotal(headers: Pick<Headers, 'get'>, knownBytes: number): number | null {
  const encoding = (headers.get('content-encoding') ?? '').trim().toLowerCase();
  const length = Number(headers.get('content-length'));
  if ((encoding === '' || encoding === 'identity') && length > 0) return length;
  return knownBytes > 0 ? knownBytes : null;
}

/**
 * The response again, with a body that reports each chunk as it arrives: still a Response with the
 * WebAssembly type, so the module compiles while it streams in (WebAssembly.instantiateStreaming).
 * The share never goes above 1, even when the known size is off.
 */
export function withProgress(res: Response, knownBytes: number, onProgress: Progress): Response {
  if (!res.ok) throw new Error(`The compute core could not be loaded (${res.status} ${res.statusText})`);
  const total = downloadTotal(res.headers, knownBytes);
  if (!res.body) return res;
  let got = 0;
  onProgress(total ? 0 : null);
  const body = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, out) {
        got += chunk.byteLength;
        onProgress(total ? Math.min(1, got / total) : null);
        out.enqueue(chunk);
      },
    }),
  );
  return new Response(body, { status: res.status, statusText: res.statusText, headers: { 'Content-Type': 'application/wasm' } });
}
