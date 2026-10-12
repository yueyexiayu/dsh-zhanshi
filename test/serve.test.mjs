import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, inject, serveMedia, MAX_PREVIEW_BYTES } from "../lib/index.js";
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
    async readByteRange(target, range, signal) { calls.push(["readByteRange", target, range, signal]); return bytes.slice(range.offset, range.offset + range.length); },
    readBytes() { throw new Error("complete content reads forbidden"); },
    ...overrides,
  };
  return { fs, calls };
}
const largeProvider = overrides => provider({ stat: async () => ({ type: "file", size: 1024 * 1024, version: "large" }), readByteRange: async (_target, range) => new Uint8Array(range.length), ...overrides });

test("rejects relative, glob, NUL and non-media paths before provider access", async () => {
  for (const file of ["clip.mp4", "/tmp/clip*.mp4", "/tmp/a\0.mp4", "/tmp/secret.txt"]) {
    const { fs, calls } = provider();
    assert.equal((await serveMedia(request({}, file), fs)).status, 400); assert.equal(calls.length, 0);
  }
});
test("registration declares and uses composed binary filesystem", async () => {
  assert.ok(inject.includes("fs")); let route;
  const { fs, calls } = provider();
  apply({ fs, connection: { fetch: { register(value) { route = value; } } } });
  assert.equal(await (await route.fetch(request())).text(), "0123456789");
  assert.ok(calls.some(call => call[0] === "readByteRange"));
});
test("GET reads only the requested bounded window with provider metadata", async () => {
  const { fs, calls } = provider(); const req = request({ headers: { Range: "bytes=2-4" } });
  const response = await serveMedia(req, fs);
  assert.equal(response.status, 206); assert.equal(response.headers.get("content-length"), "3");
  assert.equal(response.headers.get("content-type"), "video/mp4"); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(await response.text(), "234");
  assert.equal(calls[0][2].signal, req.signal);
  assert.deepEqual(calls.find(call => call[0] === "readByteRange").slice(2), [{ offset: 2, length: 3 }, req.signal]);
});
test("HEAD ignores Range and If-Range and never reads content", async () => {
  const { fs, calls } = provider();
  const response = await serveMedia(request({ method: "HEAD", headers: { Range: "bytes=2-4", "If-Range": '"old"' } }), fs);
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-length"), "10");
  assert.equal(response.headers.get("content-range"), null); assert.equal(await response.text(), "");
  assert.equal(calls.filter(call => call[0] === "readByteRange").length, 0);
});
test("single ranges select provider byte windows", async () => {
  for (const [range, content, expected] of [["bytes=2-4", "234", "bytes 2-4/10"], ["bytes=7-", "789", "bytes 7-9/10"], ["bytes=-3", "789", "bytes 7-9/10"], ["bytes=8-99", "89", "bytes 8-9/10"]]) {
    const response = await serveMedia(request({ headers: { Range: range } }), provider().fs);
    assert.equal(response.status, 206); assert.equal(response.headers.get("content-range"), expected); assert.equal(await response.text(), content);
  }
});
test("unsatisfiable ranges return 416, malformed or multi-ranges are ignored", async () => {
  for (const range of ["bytes=10-", "bytes=4-2", "bytes=-0"]) {
    const response = await serveMedia(request({ headers: { Range: range } }), provider().fs);
    assert.equal(response.status, 416); assert.equal(response.headers.get("content-range"), "bytes */10");
  }
  for (const range of ["bytes=0-1,4-5", "garbage", "bytes=-", "bytes=999999999999999999999-"]) {
    assert.equal((await serveMedia(request({ headers: { Range: range } }), provider().fs)).status, 200);
  }
});
test("If-Range accepts only a matching strong version validator; HEAD is consistent", async () => {
  const first = await serveMedia(request(), provider().fs); const etag = first.headers.get("etag");
  assert.match(etag, /^"[a-f0-9]{64}"$/);
  assert.equal((await serveMedia(request({ method: "HEAD" }), provider().fs)).headers.get("etag"), etag);
  for (const [value, status] of [[etag, 206], [`W/${etag}`, 200], ['"old"', 200], ["Wed, 01 Jan 2020 00:00:00 GMT", 200]]) {
    assert.equal((await serveMedia(request({ headers: { Range: "bytes=2-4", "If-Range": value } }), provider().fs)).status, status);
  }
  const changed = provider({ stat: async () => ({ type: "file", size: 10, version: "changed" }) });
  assert.equal((await serveMedia(request({ headers: { Range: "bytes=2-4", "If-Range": etag } }), changed.fs)).status, 200);
});
test("empty files return empty GET and unsatisfiable Range", async () => {
  const { fs } = provider({ stat: async () => ({ type: "file", size: 0, version: "empty" }) });
  assert.equal(await (await serveMedia(request(), fs)).text(), "");
  assert.equal((await serveMedia(request({ headers: { Range: "bytes=0-" } }), fs)).status, 416);
});
test("provider errors fail visibly and never fall back to local reads", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zhanshi-denied-")); const file = join(dir, "clip.mp4");
  try {
    await writeFile(file, "LOCAL SECRET");
    for (const [code, status] of [["FS_PERMISSION_DENIED", 403], ["FS_SANDBOX_DENIED", 403], ["FS_NOT_FOUND", 404], ["FS_NOT_REGULAR_FILE", 403], ["FS_TOO_LARGE", 413], ["FS_ABORTED", 499], ["FS_IO_ERROR", 500], ["ENOENT", 404]]) {
      const { fs } = provider({ async readByteRange() { throw fsError(code); } });
      const response = await serveMedia(request({}, file), fs); assert.equal(response.status, status, code); assert.notEqual(await response.text(), "LOCAL SECRET");
    }
  } finally { assert.ok(dir.startsWith(join(tmpdir(), "zhanshi-denied-"))); await rm(dir, { recursive: true, force: true }); }
});
test("canonical aliases cannot bypass media or excluded-directory rules", async () => {
  for (const canonical of ["/virtual/secret.txt", "/virtual/.git/clip.mp4", "/virtual/node_modules/clip.mp4"]) {
    const { fs, calls } = provider({ processPath() { return canonical; } });
    assert.equal((await serveMedia(request(), fs)).status, 403); assert.equal(calls.filter(call => call[0] === "readByteRange").length, 0);
  }
});
test("already aborted request never accesses filesystem", async () => {
  const controller = new AbortController(); controller.abort(); const { fs, calls } = provider();
  assert.equal((await serveMedia(request({ signal: controller.signal }), fs)).status, 499); assert.equal(calls.length, 0);
});
test("cancellation during first provider read is propagated", async () => {
  const controller = new AbortController(); const { fs } = provider({ async readByteRange(_target, _range, signal) { controller.abort(); signal.throwIfAborted(); } });
  assert.equal((await serveMedia(request({ signal: controller.signal }), fs)).status, 499);
});
test("backpressure reads one window at a time; request abort stops future reads", async () => {
  const controller = new AbortController(); let reads = 0;
  const { fs } = largeProvider({ async readByteRange(_target, range) { reads++; assert.ok(range.length <= 65536); return new Uint8Array(range.length); } });
  const response = await serveMedia(request({ signal: controller.signal }), fs);
  assert.equal(reads, 1); await Promise.resolve(); assert.equal(reads, 1);
  const reader = response.body.getReader(); assert.equal((await reader.read()).value.length, 65536); assert.equal(reads, 1);
  assert.equal((await reader.read()).value.length, 65536); assert.equal(reads, 2);
  controller.abort(); await assert.rejects(reader.read(), { name: "AbortError" }); assert.equal(reads, 2);
});
test("consumer cancellation aborts in-flight provider IO without unhandled errors", async () => {
  let calls = 0, secondStarted; const started = new Promise(resolve => { secondStarted = resolve; }); let activeSignal;
  const { fs } = largeProvider({ async readByteRange(_target, range, signal) {
    if (++calls === 1) return new Uint8Array(range.length);
    activeSignal = signal; secondStarted();
    await new Promise((_, reject) => signal.addEventListener("abort", () => reject(fsError("FS_ABORTED")), { once: true }));
  } });
  const response = await serveMedia(request(), fs); const reader = response.body.getReader(); await reader.read();
  const pending = reader.read(); await started; await reader.cancel(); assert.equal(activeSignal.aborted, true); assert.equal((await pending).done, true);
});
test("file growth, replacement, shrink and deletion fail before or during body", async () => {
  for (const change of [{ type: "file", size: 11, version: "opaque-version" }, { type: "file", size: 10, version: "replacement" }, undefined]) {
    let stats = 0; const { fs } = provider({ stat: async () => ++stats === 1 ? { type: "file", size: 10, version: "opaque-version" } : change });
    assert.equal((await serveMedia(request(), fs)).status, change ? 409 : 404);
  }
  assert.equal((await serveMedia(request(), provider({ readByteRange: async () => new Uint8Array(2) }).fs)).status, 409);
  let version = "large";
  const { fs } = largeProvider({ stat: async () => ({ type: "file", size: 1024 * 1024, version }) });
  const reader = (await serveMedia(request(), fs)).body.getReader(); await reader.read(); version = "changed";
  await assert.rejects(reader.read(), { code: "FS_STALE_VERSION" });
});
test("HEAD metadata errors, 64MiB limit and unsupported seam fail visibly", async () => {
  for (const [info, status] of [[undefined, 404], [{ type: "directory" }, 403], [{ type: "file", size: MAX_PREVIEW_BYTES + 1, version: "large" }, 413], [{ type: "file" }, 500], [{ type: "file", size: -1, version: "bad" }, 500]]) {
    assert.equal((await serveMedia(request({ method: "HEAD" }), provider({ stat: async () => info }).fs)).status, status);
  }
  assert.equal((await serveMedia(request(), provider({ readByteRange: undefined }).fs)).status, 501);
});
