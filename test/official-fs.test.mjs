import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, open, rm, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { serveMedia } from "../lib/index.js";
if (!process.env.DSH_OFFICIAL_ROOT) throw new Error("Set DSH_OFFICIAL_ROOT to an extracted official DSH runtime before running filesystem integration tests.");
const root = resolve(process.env.DSH_OFFICIAL_ROOT);
const load = name => import(pathToFileURL(join(root, "node_modules/@deepseek-ai", name, "lib/index.js")));
const [{ Context }, { SandboxPolicyService }, { SandboxedFileSystem }] = await Promise.all([load("cordis"), load("dsh-sandbox-policy"), load("dsh-fs-sandbox")]);
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "zhanshi-official-fs-"));
  const ctx = new Context();
  ctx.provide("sessionProjections", { register() {}, stateOf() { return "read-only"; } });
  new SandboxPolicyService(ctx, { mode: "read-only", workspaceRoot: directory });
  new SandboxedFileSystem(ctx, { cwd: directory, diffBasisMaxBytes: 1024 });
  t.after(async () => { await ctx.fiber.dispose(); assert.ok(directory.startsWith(join(tmpdir(), "zhanshi-official-fs-"))); await rm(directory, { recursive: true, force: true }); });
  const path = join(directory, "clip.mp4");
  return { ctx, path, request: options => new Request(`http://localhost/api/zhanshi/file?path=${encodeURIComponent(path)}`, options) };
}
test("official sandbox binary ranges avoid complete file reads and support read-only preview", async t => {
  const f = await fixture(t);
  await writeFile(f.path, "0123456789");
  const windows = [];
  const fs = { resolve: f.ctx.fs.resolve.bind(f.ctx.fs), processPath: f.ctx.fs.processPath.bind(f.ctx.fs), stat: f.ctx.fs.stat.bind(f.ctx.fs), readBytes() { throw new Error("whole-file I/O forbidden"); }, async readByteRange(target, range, signal) { windows.push(range); return f.ctx.fs.readByteRange(target, range, signal); } };
  const response = await serveMedia(f.request({ headers: { Range: "bytes=2-4" } }), fs);
  assert.equal(response.status, 206);
  assert.equal(await response.text(), "234");
  assert.deepEqual(windows, [{ offset: 2, length: 3 }]);
  const etag = response.headers.get("etag");
  await rename(f.path, `${f.path}.old`);
  await writeFile(f.path, "abcdefghij");
  const changed = await serveMedia(f.request({ headers: { Range: "bytes=2-4", "If-Range": etag } }), fs);
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get("etag"), etag);
  assert.equal(await changed.text(), "abcdefghij");
});
test("official 256MiB saved video explicitly downgrades without any content reads", async t => {
  const f = await fixture(t);
  const file = await open(f.path, "wx");
  try { await file.truncate(256 * 1024 * 1024); } finally { await file.close(); }
  const response = await serveMedia(f.request({ method: "HEAD" }), f.ctx.fs);
  assert.equal(response.status, 413);
  assert.equal(response.headers.get("x-zhanshi-preview"), "open-file");
  assert.equal(response.headers.get("x-zhanshi-file-size"), String(256 * 1024 * 1024));
});
