import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { isMediaPath } from "./parse.js";

export const name = "zhanshi";
export const inject = ["connection"];

export const API_PATH = "/api/zhanshi/file";
const MAX_BYTES = 64 * 1024 * 1024;
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

function fail(request, status, text) {
  return new Response(request.method === "HEAD" ? null : text, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function extOf(path) {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  return match ? match[1].toLowerCase() : "";
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(header || "").trim());
  if (!match) return null;
  let start = match[1] === "" ? NaN : Number(match[1]);
  let end = match[2] === "" ? NaN : Number(match[2]);
  if (Number.isNaN(start) && Number.isNaN(end)) return null;
  if (Number.isNaN(start)) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (Number.isNaN(end)) {
    end = size - 1;
  }
  if (start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export async function serveMedia(request) {
  const path = new URL(request.url).searchParams.get("path");
  if (!path || !isAbsolute(path) || !isMediaPath(path)) return fail(request, 400, "bad path");
  let info;
  try {
    info = await stat(path);
  } catch {
    return fail(request, 404, "not found");
  }
  if (!info.isFile()) return fail(request, 403, "not a file");
  if (info.size > MAX_BYTES) return fail(request, 413, "too large");
  const mime = MIME[extOf(path)] || "application/octet-stream";
  const range = parseRange(request.headers.get("range"), info.size);
  if (range) {
    const length = range.end - range.start + 1;
    const headers = {
      "Content-Type": mime,
      "Content-Length": String(length),
      "Content-Range": `bytes ${range.start}-${range.end}/${info.size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (request.method === "HEAD") return new Response(null, { status: 206, headers });
    return new Response(createReadStream(path, { start: range.start, end: range.end }), { status: 206, headers });
  }
  const headers = {
    "Content-Type": mime,
    "Content-Length": String(info.size),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method === "HEAD") return new Response(null, { headers });
  return new Response(createReadStream(path), { headers });
}

export function apply(ctx) {
  ctx.connection.fetch.register({
    path: API_PATH,
    methods: ["GET", "HEAD"],
    requestBody: "buffered",
    fetch: (request) => serveMedia(request),
  });
}
