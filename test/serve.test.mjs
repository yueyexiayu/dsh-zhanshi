import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, inject, serveMedia } from "../lib/index.js";

const MAX_BYTES = 64 * 1024 * 1024;
const path = "/virtual/clip.mp4";
const bytes = new TextEncoder().encode("0123456789");
const request = (options = {}, file = path) => new Request(`http://localhost/api/zhanshi/file?path=${encodeURIComponent(file)}`, options);
const fsError = code => Object.assign(new Error(code), { code });
function provider(overrides = {}) {
  const calls = [];
  const fs = {
    async resolve(path, options) { calls.push(["resolve", path, options]); return { targetKey: "opaque-id", displayPath: path }; },
    processPath() { return path; },
    async stat(target, signal) { calls.push(["stat", target, signal]); return { type: "file", size: bytes.length, version: "opaque-version" }; },
    async readBytes(target, signal, maxBytes) { calls.push(["readBytes", target, signal, maxBytes]); return bytes; },
    ...overrides,
  };
  return { fs, calls };
}

test("rejects relative, glob, NUL and non-media paths before provider access", async () => {
  for (const file of ["clip.mp4", "/tmp/clip*.mp4", "/tmp/a\0.mp4", "/tmp/secret.txt"]) {
    const { fs, calls } = provider();
    assert.equal((await serveMedia(request({}, file), fs)).status, 400);
    assert.equal(calls.length, 0);
  }
});

test("registration declares and uses composed filesystem", async () => {
  assert.ok(inject.includes("fs"));
  let route;
  const { fs, calls } = provider();
  apply({ fs, connection: { fetch: { register(value) { route = value; } } } });
  const response = await route.fetch(request());
  assert.equal(await response.text(), "0123456789");
  assert.ok(calls.some(call => call[0] === "readBytes"));
});

test("GET uses provider bytes and actual length without stat/open assumptions", async () => {
  const { fs, calls } = provider({ stat() { throw new Error("GET must not trust separate stat"); } });
  const req = request();
  const response = await serveMedia(req, fs);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), "10");
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(await response.text(), "0123456789");
  assert.equal(calls[0][2].signal, req.signal);
  assert.deepEqual(calls[1].slice(2), [req.signal, MAX_BYTES]);
});

test("HEAD ignores Range and If-Range and never reads content", async () => {
  const { fs, calls } = provider();
  const response = await serveMedia(request({ method: "HEAD", headers: { Range: "bytes=2-4", "If-Range": '"old"' } }), fs);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), "10");
  assert.equal(response.headers.get("content-range"), null);
  assert.equal(await response.text(), "");
  assert.equal(calls.filter(call => call[0] === "readBytes").length, 0);
});

test("single ranges select snapshot bytes", async () => {
  for (const [range, content, expected] of [["bytes=2-4", "234", "bytes 2-4/10"], ["bytes=7-", "789", "bytes 7-9/10"], ["bytes=-3", "789", "bytes 7-9/10"], ["bytes=8-99", "89", "bytes 8-9/10"]]) {
    const response = await serveMedia(request({ headers: { Range: range } }), provider().fs);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), expected);
    assert.equal(await response.text(), content);
  }
});

test("unsatisfiable single ranges return 416, malformed or multi-ranges are ignored", async () => {
  for (const range of ["bytes=10-", "bytes=4-2", "bytes=-0"]) {
    const response = await serveMedia(request({ headers: { Range: range } }), provider().fs);
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), "bytes */10");
  }
  for (const range of ["bytes=0-1,4-5", "garbage", "bytes=-", "bytes=999999999999999999999-"]) {
    assert.equal((await serveMedia(request({ headers: { Range: range } }), provider().fs)).status, 200);
  }
});

test("If-Range accepts only the matching strong content ETag", async () => {
  const first = await serveMedia(request(), provider().fs);
  const etag = first.headers.get("etag");
  assert.match(etag, /^"[a-f0-9]{64}"$/);
  for (const [value, status] of [[etag, 206], [`W/${etag}`, 200], ['"old"', 200], ["Wed, 01 Jan 2020 00:00:00 GMT", 200]]) {
    const response = await serveMedia(request({ headers: { Range: "bytes=2-4", "If-Range": value } }), provider().fs);
    assert.equal(response.status, status);
  }
  const changed = provider({ async readBytes() { return new TextEncoder().encode("abcdefghij"); } });
  assert.equal((await serveMedia(request({ headers: { Range: "bytes=2-4", "If-Range": etag } }), changed.fs)).status, 200);
});

test("empty files return empty GET and unsatisfiable Range", async () => {
  const { fs } = provider({ async readBytes() { return new Uint8Array(); } });
  assert.equal(await (await serveMedia(request(), fs)).text(), "");
  assert.equal((await serveMedia(request({ headers: { Range: "bytes=0-" } }), fs)).status, 416);
});

test("provider errors fail visibly and never fall back to local reads", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zhanshi-denied-"));
  const file = join(dir, "clip.mp4");
  try {
    await writeFile(file, "LOCAL SECRET");
    for (const [code, status] of [["FS_PERMISSION_DENIED", 403], ["FS_SANDBOX_DENIED", 403], ["FS_NOT_FOUND", 404], ["FS_NOT_REGULAR_FILE", 403], ["FS_TOO_LARGE", 413], ["FS_ABORTED", 499], ["FS_IO_ERROR", 500], ["ENOENT", 404]]) {
      const { fs } = provider({ async readBytes() { throw fsError(code); } });
      const response = await serveMedia(request({}, file), fs);
      assert.equal(response.status, status, code);
      assert.notEqual(await response.text(), "LOCAL SECRET");
    }
  } finally {
    // dir is the exact fresh mkdtemp fixture above, never a caller-supplied path.
    await rm(dir, { recursive: true, force: true });
  }
});

test("canonical aliases cannot bypass media or excluded-directory rules", async () => {
  for (const canonical of ["/virtual/secret.txt", "/virtual/.git/clip.mp4", "/virtual/node_modules/clip.mp4"]) {
    const { fs, calls } = provider({ processPath() { return canonical; } });
    assert.equal((await serveMedia(request(), fs)).status, 403);
    assert.equal(calls.filter(call => call[0] === "readBytes").length, 0);
  }
});

test("already aborted request never accesses filesystem", async () => {
  const controller = new AbortController();
  controller.abort();
  const { fs, calls } = provider();
  assert.equal((await serveMedia(request({ signal: controller.signal }), fs)).status, 499);
  assert.equal(calls.length, 0);
});

test("cancellation during provider read is propagated", async () => {
  const controller = new AbortController();
  const { fs } = provider({ async readBytes(target, signal) {
    controller.abort();
    signal.throwIfAborted();
  } });
  assert.equal((await serveMedia(request({ signal: controller.signal }), fs)).status, 499);
});

test("cancellation after response stops unread body chunks", async () => {
  const controller = new AbortController();
  const { fs } = provider({ async readBytes() { return new Uint8Array(1024 * 1024); } });
  const response = await serveMedia(request({ signal: controller.signal }), fs);
  const reader = response.body.getReader();
  assert.equal((await reader.read()).value.length, 65536);
  controller.abort();
  await assert.rejects(reader.read(), { name: "AbortError" });
});

test("body consumer cancellation succeeds without unhandled abort", async () => {
  const controller = new AbortController();
  const response = await serveMedia(request({ signal: controller.signal }), provider().fs);
  await response.body.cancel();
  controller.abort();
});

test("HEAD metadata errors and size limits", async () => {
  for (const [info, status] of [[undefined, 404], [{ type: "directory" }, 403], [{ type: "file", size: MAX_BYTES + 1 }, 413], [{ type: "file" }, 200]]) {
    const { fs } = provider({ async stat() { return info; } });
    assert.equal((await serveMedia(request({ method: "HEAD" }), fs)).status, status);
  }
});

test("rejects oversized provider result as a defensive bound", async () => {
  const { fs } = provider({ async readBytes() { return new Uint8Array(MAX_BYTES + 1); } });
  assert.equal((await serveMedia(request(), fs)).status, 413);
});
