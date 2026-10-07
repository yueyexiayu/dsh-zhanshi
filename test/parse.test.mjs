import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTurnEvent, bashMediaPaths, emptyTurnState, extractSavedMediaPaths,
  extractWriteDestinations, isMediaPath, isUsablePath, looksLikeSessionDump,
  mediaFromPresented, mediaFromToolCall, mediaKind,
} from "../lib/parse.js";

// Gallery selection, URL revisions and rendering are covered against the shipped
// Client in results.test.mjs, not parallel test-only preview implementations.
test("mediaKind maps image and video extensions", () => {
  assert.equal(mediaKind("/tmp/a.PNG"), "image");
  assert.equal(mediaKind("/tmp/a.jpeg"), "image");
  assert.equal(mediaKind("/tmp/clip.mp4"), "video");
  assert.equal(mediaKind("/tmp/notes.txt"), null);
});

test("extractSavedMediaPaths only takes save-style lines and documented size metadata", () => {
  const text = "saved /tmp/icon-1.png size=12\nls /tmp/old.png\n写入 /tmp/out.webm";
  assert.deepEqual(extractSavedMediaPaths(text), ["/tmp/icon-1.png", "/tmp/out.webm"]);
  assert.deepEqual(extractSavedMediaPaths("saved '/tmp/new photo.png' size=12"), ["/tmp/new photo.png"]);
});

test("media path rules reject unsupported paths without truncating names", () => {
  for (const path of ["https://cdn.example/a.png", "/tmp/node_modules/x.png", "/tmp/.git/a.png", "/tmp/../a.png", "/tmp/a.png.backup", "/tmp/a\n.png", "//server/a.png", "/tmp/street*.png"]) {
    assert.equal(isMediaPath(path), false, path);
  }
  assert.equal(isMediaPath("street_dancing_girl.png"), true);
  assert.equal(isUsablePath("street_dancing_girl.png"), false);
  assert.equal(isUsablePath("/tmp/new photo.png"), true);
});

test("mediaFromToolCall and present helpers keep media including relative paths", () => {
  assert.deepEqual(mediaFromToolCall("present", JSON.stringify({ files: [{ path: "a.png" }, { path: "/tmp/a.txt" }] })), ["a.png"]);
  assert.deepEqual(mediaFromPresented({ data: { files: [{ path: "/tmp/clip.webm" }] } }), ["/tmp/clip.webm"]);
});

test("bash keeps saved stdout and command destinations, not a raw listing", () => {
  const args = JSON.stringify({ command: "python3 make.py > /tmp/unused.txt" });
  assert.deepEqual(bashMediaPaths(args, "listing /tmp/vacation.png\nsaved /tmp/final.png"), ["/tmp/final.png"]);
  assert.deepEqual(extractWriteDestinations("cp in.bin /tmp/out.mp4"), ["/tmp/out.mp4"]);
  assert.deepEqual(bashMediaPaths(JSON.stringify({ command: "cp in.bin /tmp/out.mp4" }), "copied /tmp/out.mp4"), ["/tmp/out.mp4"]);
});

test("bash ignores saved paths quoted inside a session log dump", () => {
  const stdout = '{"type":"tool/result","text":"saved /tmp/old.png"}\n{"type":"assistant/message","data":{}}';
  assert.equal(looksLikeSessionDump(stdout), true);
  assert.equal(bashMediaPaths('{}', stdout).length, 0);
  assert.equal(extractSavedMediaPaths(stdout).length, 0);
});

test("ls of an old png is not treated as this-turn media", () => {
  assert.deepEqual(bashMediaPaths(JSON.stringify({ command: "ls -la /tmp/old.png" }), "-rw-r--r-- old /tmp/old.png"), []);
  assert.deepEqual(extractWriteDestinations("ls -la /tmp/old.png"), []);
});

test("literal destinations support quotes and redirection but not expansion or compounds", () => {
  assert.deepEqual(extractWriteDestinations("cp '/tmp/a.png' '/tmp/new photo.png'"), ["/tmp/new photo.png"]);
  assert.deepEqual(extractWriteDestinations("echo test > '/tmp/new photo.png'"), ["/tmp/new photo.png"]);
  for (const command of ["cp /tmp/a.png /tmp/new.png; ls /tmp/old.png", "cp /tmp/a.png /tmp/new.png && ls /tmp/old.png", "cp /tmp/a.png $(echo /tmp/old.png)", "cp /tmp/a.png /tmp/old.png.backup", "cp -t /tmp/directory /tmp/old.png", "echo '>/tmp/old.png'"]) {
    assert.deepEqual(extractWriteDestinations(command), [], command);
  }
});

test("same path presented again keeps latest seq and explicit priority", () => {
  let state = emptyTurnState(1);
  for (const seq of [10, 20, 12]) state = applyTurnEvent(state, { type: "deliverables/presented", seq, data: { turn: 1, files: [{ path: "/tmp/app-icon.png" }] } });
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].path, "/tmp/app-icon.png");
  assert.equal(state.items[0].seq, 20);
  assert.equal(state.items[0].presented, true);
});
