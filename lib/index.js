import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { isMediaPath } from "./parse.js";

export const name = "zhanshi";
export const inject = ["connection", "fs"];

export const API_PATH = "/api/zhanshi/file";
const MAX_BYTES = 64 * 1024 * 1024;
const BASE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'",
};
const MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/mp4",
};

function fail(request, status, text, headers = {}) {
  return new Response(request.method === "HEAD" ? null : text, {
    status,
    headers: { ...BASE_HEADERS, ...headers },
  });
}

// null means ignore malformed/unsupported Range; false means unsatisfiable.
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(header || "").trim());
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) ||
      (last !== null && !Number.isSafeInteger(last))) return null;
  if (size === 0 || (first === null && last === 0)) return false;
  const start = first === null ? Math.max(0, size - last) : first;
  const end = first === null || last === null ? size - 1 : Math.min(last, size - 1);
  if (start >= size || end < start) return false;
  return { start, end };
}

// Provider I/O has completed before we publish headers. Stream the bounded
// snapshot with backpressure, retaining request cancellation during delivery.
function snapshotBody(bytes, start, end, signal) {
  let snapshot = bytes;
  let offset = start;
  let controller;
  const cleanup = () => {
    signal.removeEventListener("abort", abort);
    snapshot = null;
  };
  const abort = () => {
    cleanup();
    controller.error(signal.reason || new DOMException("Aborted", "AbortError"));
  };
  return new ReadableStream({
    start(value) {
      controller = value;
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    },
    pull() {
      if (!snapshot) return;
      if (offset >= end) {
        cleanup();
        controller.close();
        return;
      }
      const next = Math.min(offset + 65536, end);
      // Copy only a delivery chunk, not the whole provider snapshot.
      controller.enqueue(new Uint8Array(snapshot.subarray(offset, next)));
      offset = next;
    },
    cancel: cleanup,
  }, { highWaterMark: 0 });
}

/**
 * All path resolution, authorization and content reads use composed ctx.fs.
 * readBytes is its bounded/cancellable binary seam; there is no native fallback.
 * Even Range reads take one complete <=64MiB snapshot, so headers/ETag and body
 * cannot describe different reads. This trades per-request memory and full-file
 * I/O for provider compatibility; it is not a zero-copy filesystem stream.
 */
export async function serveMedia(request, fs) {
  const path = new URL(request.url).searchParams.get("path");
  if (!path || !isAbsolute(path) || !isMediaPath(path)) return fail(request, 400, "bad path");
  try {
    request.signal.throwIfAborted();
    const target = await fs.resolve(path, { signal: request.signal });
    // processPath belongs to the provider's execution world, NOT necessarily
    // this host. Check canonical aliases as product filters, not access control.
    const canonical = fs.processPath(target);
    if (!isMediaPath(canonical)) return fail(request, 403, "not a media target");
    const ext = /\.([a-z0-9]+)$/i.exec(canonical)?.[1].toLowerCase();
    const headers = { ...BASE_HEADERS, "Content-Type": MIME[ext] || "application/octet-stream", "Accept-Ranges": "bytes" };
    if (request.method === "HEAD") {
      const info = await fs.stat(target, request.signal);
      request.signal.throwIfAborted();
      if (info === undefined) return fail(request, 404, "not found");
      if (info.type !== "file") return fail(request, 403, "not a regular file");
      if (info.size !== undefined) {
        if (!Number.isSafeInteger(info.size) || info.size < 0) return fail(request, 500, "invalid file size");
        if (info.size > MAX_BYTES) return fail(request, 413, "file exceeds 64 MiB limit");
        headers["Content-Length"] = String(info.size);
      }
      // No content hash available without reading; omit ETag on HEAD.
      return new Response(null, { headers });
    }
    const bytes = await fs.readBytes(target, request.signal, MAX_BYTES);
    request.signal.throwIfAborted();
    if (!(bytes instanceof Uint8Array)) return fail(request, 500, "invalid file bytes");
    if (bytes.byteLength > MAX_BYTES) return fail(request, 413, "file exceeds 64 MiB limit");
    const size = bytes.byteLength;
    headers.ETag = `"${createHash("sha256").update(bytes).digest("hex")}"`;
    // No Last-Modified is advertised. Dates, weak tags and mismatches therefore
    // cannot validate If-Range and receive the complete current representation.
    const ifRange = request.headers.get("if-range");
    const range = ifRange === null || ifRange === headers.ETag
      ? parseRange(request.headers.get("range"), size) : null;
    if (range === false) return fail(request, 416, "range not satisfiable", {
      ETag: headers.ETag, "Accept-Ranges": "bytes", "Content-Range": `bytes */${size}`,
    });
    const start = range ? range.start : 0;
    const end = range ? range.end + 1 : size;
    headers["Content-Length"] = String(end - start);
    if (range) headers["Content-Range"] = `bytes ${start}-${end - 1}/${size}`;
    return new Response(snapshotBody(bytes, start, end, request.signal), { status: range ? 206 : 200, headers });
  } catch (error) {
    if (request.signal.aborted || error?.name === "AbortError" || error?.code === "FS_ABORTED") {
      return fail(request, 499, "read aborted");
    }
    const statuses = {
      FS_NOT_FOUND: 404, ENOENT: 404, ENOTDIR: 404,
      FS_NOT_REGULAR_FILE: 403, FS_PERMISSION_DENIED: 403, FS_SANDBOX_DENIED: 403,
      EACCES: 403, EPERM: 403, FS_TOO_LARGE: 413,
    };
    const status = statuses[error?.code] || 500;
    return fail(request, status, status === 500 ? "file read failed" : (error.code || "file read failed"));
  }
}

export function apply(ctx) {
  ctx.connection.fetch.register({
    path: API_PATH,
    methods: ["GET", "HEAD"],
    requestBody: "buffered",
    fetch: (request) => serveMedia(request, ctx.fs),
  });
}
