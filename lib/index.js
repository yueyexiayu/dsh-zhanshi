import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { isMediaPath } from "./parse.js";

export const name = "zhanshi";
export const inject = ["connection", "fs"];
export const API_PATH = "/api/zhanshi/file";
export const MAX_PREVIEW_BYTES = 64 * 1024 * 1024;
export const CHUNK_BYTES = 256 * 1024;
const BASE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'",
};
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", m4v: "video/mp4" };
function fail(request, status, text, headers = {}) {
  return new Response(request.method === "HEAD" ? null : text, { status, headers: { ...BASE_HEADERS, ...headers } });
}

// null means ignore malformed/unsupported Range; false means unsatisfiable.
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(header || "").trim());
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null;
  if (size === 0 || (first === null && last === 0)) return false;
  const start = first === null ? Math.max(0, size - last) : first;
  const end = first === null || last === null ? size - 1 : Math.min(last, size - 1);
  return start >= size || end < start ? false : { start, end };
}

function stale() { return Object.assign(new Error("media changed during preview"), { code: "FS_STALE_VERSION" }); }
async function metadata(fs, target, signal) {
  const info = await fs.stat(target, signal);
  signal.throwIfAborted();
  if (!info) throw Object.assign(new Error("not found"), { code: "FS_NOT_FOUND" });
  if (info.type !== "file") throw Object.assign(new Error("not a regular file"), { code: "FS_NOT_REGULAR_FILE" });
  if (!Number.isSafeInteger(info.size) || info.size < 0 || typeof info.version !== "string" || !info.version) throw new Error("invalid media metadata");
  return info;
}
async function readWindow(fs, target, info, offset, length, signal) {
  const before = await metadata(fs, target, signal);
  if (before.version !== info.version || before.size !== info.size) throw stale();
  const bytes = await fs.readByteRange(target, { offset, length }, signal);
  signal.throwIfAborted();
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) throw stale();
  const after = await metadata(fs, target, signal);
  if (after.version !== info.version || after.size !== info.size) throw stale();
  return bytes;
}

// The official binary seam is readByteRange, not a native file handle. Read one
// bounded window per demand; abort/cancel also aborts the in-flight provider IO.
function windowBody(fs, target, info, start, end, first, requestSignal, cancellation) {
  const signal = AbortSignal.any([requestSignal, cancellation.signal]);
  let offset = start, initial = first, closed = false, controller;
  const cleanup = () => { closed = true; initial = null; requestSignal.removeEventListener("abort", abort); };
  const abort = () => { if (!closed) { cleanup(); controller.error(requestSignal.reason); } };
  return new ReadableStream({
    start(value) { controller = value; if (requestSignal.aborted) abort(); else requestSignal.addEventListener("abort", abort, { once: true }); },
    async pull() {
      if (closed) return;
      try {
        signal.throwIfAborted();
        if (offset === end) { cleanup(); controller.close(); return; }
        const length = Math.min(CHUNK_BYTES, end - offset);
        const bytes = initial || await readWindow(fs, target, info, offset, length, signal);
        initial = null;
        if (closed) return;
        signal.throwIfAborted();
        offset += length;
        controller.enqueue(bytes);
      } catch (error) {
        if (!closed) { cleanup(); cancellation.abort(error); controller.error(error); }
      }
    },
    cancel(reason) { cleanup(); cancellation.abort(reason); },
  }, { highWaterMark: 0 });
}

export async function serveMedia(request, fs) {
  const path = new URL(request.url).searchParams.get("path");
  if (!path || !isAbsolute(path) || !isMediaPath(path)) return fail(request, 400, "bad path");
  try {
    request.signal.throwIfAborted();
    if (typeof fs.readByteRange !== "function") return fail(request, 501, "filesystem does not support bounded binary preview");
    const target = await fs.resolve(path, { signal: request.signal });
    const canonical = fs.processPath(target);
    if (!isMediaPath(canonical)) return fail(request, 403, "not a media target");
    const info = await metadata(fs, target, request.signal);
    const ext = /\.([a-z0-9]+)$/i.exec(canonical)?.[1].toLowerCase();
    const headers = { ...BASE_HEADERS, "Content-Type": MIME[ext] || "application/octet-stream", "Accept-Ranges": "bytes", "X-Zhanshi-Preview-Limit": String(MAX_PREVIEW_BYTES) };
    // The official opaque version tracks identity, size and nanosecond mtime/ctime.
    // This is a representation validator, NOT a claimed whole-file content hash.
    headers.ETag = `"${createHash("sha256").update(info.version).digest("hex")}"`;
    headers["X-Zhanshi-File-Size"] = String(info.size);
    if (info.size > MAX_PREVIEW_BYTES) return fail(request, 413, "file exceeds 64 MiB preview limit; open the saved file", { ...headers, "X-Zhanshi-Preview": "open-file" });
    if (request.method === "HEAD") return new Response(null, { headers: { ...headers, "Content-Length": String(info.size) } });
    const ifRange = request.headers.get("if-range");
    const range = ifRange === null || ifRange === headers.ETag ? parseRange(request.headers.get("range"), info.size) : null;
    if (range === false) return fail(request, 416, "range not satisfiable", { ...headers, "Content-Range": `bytes */${info.size}` });
    const start = range ? range.start : 0, end = range ? range.end + 1 : info.size;
    headers["Content-Length"] = String(end - start);
    if (range) headers["Content-Range"] = `bytes ${start}-${end - 1}/${info.size}`;
    // A bounded first read catches provider permission/IO failures before headers.
    const cancellation = new AbortController();
    const first = end > start ? await readWindow(fs, target, info, start, Math.min(CHUNK_BYTES, end - start), request.signal) : null;
    return new Response(windowBody(fs, target, info, start, end, first, request.signal, cancellation), { status: range ? 206 : 200, headers });
  } catch (error) {
    if (request.signal.aborted || error?.name === "AbortError" || error?.code === "FS_ABORTED") return fail(request, 499, "read aborted");
    const status = { FS_NOT_FOUND: 404, ENOENT: 404, ENOTDIR: 404, FS_NOT_REGULAR_FILE: 403, FS_PERMISSION_DENIED: 403, FS_SANDBOX_DENIED: 403, EACCES: 403, EPERM: 403, FS_TOO_LARGE: 413, FS_STALE_VERSION: 409 }[error?.code] || 500;
    return fail(request, status, status === 500 ? "file read failed" : (error.code || "file read failed"));
  }
}

export function apply(ctx) {
  ctx.connection.fetch.register({ path: API_PATH, methods: ["GET", "HEAD"], requestBody: "buffered", fetch: request => serveMedia(request, ctx.fs) });
}
