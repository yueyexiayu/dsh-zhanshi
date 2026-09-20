import test from "node:test";
import assert from "node:assert/strict";
import { serveMedia } from "../lib/index.js";

test("serveMedia rejects relative and glob paths", async () => {
  const relative = await serveMedia(new Request("http://127.0.0.1/api/zhanshi/file?path=clip.mp4"));
  assert.equal(relative.status, 400);
  const glob = await serveMedia(new Request("http://127.0.0.1/api/zhanshi/file?path=/tmp/clip*.mp4"));
  assert.equal(glob.status, 400);
});
