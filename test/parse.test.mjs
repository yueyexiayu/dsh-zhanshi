import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTurnEvent,
  bashMediaPaths,
  emptyTurnState,
  extractMediaPaths,
  extractSavedMediaPaths,
  extractWriteDestinations,
  galleryAnchorSeq,
  isMediaPath,
  isUsablePath,
  itemsFromDeliverables,
  looksLikeSessionDump,
  mediaFileUrl,
  mediaFromPresented,
  mediaFromToolCall,
  mediaKind,
  mergeMediaItems,
  uniquePreviewItems,
} from "../lib/parse.js";

test("mediaKind maps image and video extensions", () => {
  assert.equal(mediaKind("/tmp/a.PNG"), "image");
  assert.equal(mediaKind("/tmp/a.jpeg"), "image");
  assert.equal(mediaKind("/tmp/clip.mp4"), "video");
  assert.equal(mediaKind("/tmp/notes.txt"), null);
});

test("extractSavedMediaPaths only takes save-style lines", () => {
  const text = [
    "saved /Users/ning/Downloads/macos-yaso-app-icon-1.png size=12",
    "ls /Users/ning/Downloads/old.png",
    "写入 /tmp/out.webm",
  ].join("\n");
  assert.deepEqual(extractSavedMediaPaths(text), [
    "/Users/ning/Downloads/macos-yaso-app-icon-1.png",
    "/tmp/out.webm",
  ]);
});

test("extractMediaPaths finds absolute media paths", () => {
  assert.deepEqual(extractMediaPaths('out="/tmp/icon.png" done'), ["/tmp/icon.png"]);
  assert.equal(extractMediaPaths("https://cdn.example/a.png").length, 0);
  assert.equal(extractMediaPaths("/tmp/node_modules/x.png").length, 0);
});

test("present and write calls collect media after success", () => {
  let state = emptyTurnState(3);
  state = applyTurnEvent(state, {
    type: "tool/call",
    seq: 10,
    data: {
      turn: 3,
      callId: "w1",
      name: "write",
      arguments: JSON.stringify({ file_path: "/tmp/icon.png", content: "x" }),
    },
  });
  state = applyTurnEvent(state, {
    type: "tool/result",
    seq: 11,
    data: {
      turn: 3,
      message: {
        source: { callId: "w1" },
        content: [{ type: "tool-result", isError: false, content: [{ type: "text", text: "ok" }] }],
      },
    },
  });
  state = applyTurnEvent(state, {
    type: "deliverables/presented",
    seq: 12,
    data: {
      turn: 3,
      files: [
        { path: "/Users/ning/Downloads/macos-yaso-app-icon-2.png", description: "推荐" },
        { path: "/tmp/notes.md" },
      ],
    },
  });
  assert.deepEqual(state.items.map((item) => item.path), [
    "/tmp/icon.png",
    "/Users/ning/Downloads/macos-yaso-app-icon-2.png",
  ]);
  assert.equal(state.items[1].kind, "image");
});

test("failed writes contribute nothing", () => {
  let state = emptyTurnState(1);
  state = applyTurnEvent(state, {
    type: "tool/call",
    seq: 1,
    data: { turn: 1, callId: "w", name: "write", arguments: JSON.stringify({ file_path: "/tmp/a.png", content: "x" }) },
  });
  state = applyTurnEvent(state, {
    type: "tool/result",
    seq: 2,
    data: {
      turn: 1,
      message: {
        source: { callId: "w" },
        content: [{ type: "tool-result", isError: true, content: [{ type: "text", text: "no" }] }],
      },
    },
  });
  assert.equal(state.items.length, 0);
});

test("bash keeps saved stdout and command destinations, not a raw listing", () => {
  const args = JSON.stringify({ command: "python3 make.py > /tmp/unused.txt" });
  const stdout = [
    "listing /Users/ning/Pictures/vacation.png",
    "saved /Users/ning/Downloads/macos-yaso-app-icon-2.png",
  ].join("\n");
  assert.deepEqual(bashMediaPaths(args, stdout), [
    "/Users/ning/Downloads/macos-yaso-app-icon-2.png",
  ]);
});

test("bash keeps a media path that also appears in the command", () => {
  const args = JSON.stringify({ command: "cp in.bin /tmp/out.mp4" });
  assert.deepEqual(bashMediaPaths(args, "wrote /tmp/out.mp4"), ["/tmp/out.mp4"]);
});

test("gallery sits just after the last text assistant", () => {
  const state = {
    items: [{ path: "/tmp/a.png", seq: 10, kind: "image", source: "present", name: "a.png" }],
  };
  const matches = [
    { event: { type: "deliverables/presented", seq: 10, data: {} } },
    {
      event: {
        type: "assistant/message",
        seq: 20,
        data: { message: { content: [{ type: "text", text: "好了" }] } },
      },
    },
  ];
  assert.equal(galleryAnchorSeq(state, matches), 20.02);
});

test("mediaFromToolCall and present helpers", () => {
  assert.deepEqual(
    mediaFromToolCall("present", JSON.stringify({ files: [{ path: "/tmp/a.png" }, { path: "/tmp/a.txt" }] })),
    ["/tmp/a.png"],
  );
  assert.deepEqual(
    mediaFromPresented({ data: { files: [{ path: "/tmp/clip.webm" }] } }),
    ["/tmp/clip.webm"],
  );
});

test("relative present paths used by GPT sessions are media, not bash-usable", () => {
  assert.equal(isMediaPath("street_dancing_girl.png"), true);
  assert.equal(isUsablePath("street_dancing_girl.png"), false);
  assert.equal(isMediaPath("/Users/ning/.dsh/street_dancing_girl.png"), true);
  assert.deepEqual(
    mediaFromToolCall("present", JSON.stringify({ files: [{ path: "street_dancing_girl.png" }] })),
    ["street_dancing_girl.png"],
  );
});

test("itemsFromDeliverables keeps presented pngs used by the turn-tail slot", () => {
  const items = itemsFromDeliverables({
    presented: [{ path: "/Users/ning/Downloads/girl-dancing-street-20260919-201510.png", seq: 117 }],
    produced: [{ path: "/tmp/notes.md", seq: 10 }],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "image");
  assert.equal(items[0].name, "girl-dancing-street-20260919-201510.png");
  const relative = itemsFromDeliverables({
    presented: [{ path: "street_dancing_girl.png", seq: 54 }],
  });
  assert.equal(relative.length, 1);
  assert.equal(relative[0].path, "street_dancing_girl.png");
});

test("bash saved line from the dancing-girl session is collected", () => {
  let state = emptyTurnState(1);
  state = applyTurnEvent(state, {
    type: "tool/call",
    seq: 106,
    data: { turn: 1, callId: "b", name: "bash", arguments: JSON.stringify({ command: "python3 gen.py" }) },
  });
  state = applyTurnEvent(state, {
    type: "tool/result",
    seq: 107,
    data: {
      turn: 1,
      message: {
        source: { callId: "b" },
        content: [{
          type: "tool-result",
          isError: false,
          content: [{ type: "text", text: "saved /Users/ning/Downloads/girl-dancing-street-20260919-201510.png\nbytes 6620783" }],
        }],
      },
    },
  });
  assert.equal(state.items[0].path, "/Users/ning/Downloads/girl-dancing-street-20260919-201510.png");
});

test("ls globs are not media paths", () => {
  assert.equal(isMediaPath("/Users/ning/.dsh/street*.png"), false);
  assert.equal(
    bashMediaPaths(
      JSON.stringify({ command: "ls -la /Users/ning/.dsh/street*.png" }),
      "",
    ).length,
    0,
  );
});

test("uniquePreviewItems keeps one present file and drops backups", () => {
  const items = uniquePreviewItems([
    { path: "/Users/ning/.dsh/street*.png", source: "bash", name: "street*.png" },
    { path: "/Users/ning/.dsh/european-girl-street-dance.png", source: "present", name: "european-girl-street-dance.png" },
    { path: "/Users/ning/Downloads/european-girl-street-dance.png", source: "bash", name: "european-girl-street-dance.png" },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].path, "/Users/ning/.dsh/european-girl-street-dance.png");
});

test("bash ignores saved paths quoted inside a session log dump", () => {
  const args = JSON.stringify({
    command: "cd ~/.dsh/sessions && python3 - <<'EOF'\nimport zstandard, json\nprint(txt)\nEOF",
  });
  const stdout = [
    '{"type":"tool/result","seq":95,"data":{"turn":1,"message":{"content":[{"type":"text","text":"saved /Users/ning/.dsh/european-girl-street-dance.png\\nsaved /Users/ning/Downloads/european-girl-street-dance.png"}]}}}',
    '{"type":"assistant/message","seq":96,"data":{}}',
  ].join("\n");
  assert.equal(looksLikeSessionDump(stdout), true);
  assert.equal(bashMediaPaths(args, stdout).length, 0);
  assert.equal(extractSavedMediaPaths(stdout).length, 0);
});

test("ls of an old png is not treated as this-turn media", () => {
  const path = "/Users/ning/.dsh/european-girl-street-dance.png";
  const args = JSON.stringify({ command: "ls -la " + path });
  const stdout = "-rw-r--r--  1 ning  staff  6141874 Sep 20 11:44 " + path;
  assert.equal(bashMediaPaths(args, stdout).length, 0);
  assert.equal(extractWriteDestinations("ls -la " + path).length, 0);
});

test("cp destination still counts when stdout mentions the file", () => {
  assert.deepEqual(extractWriteDestinations("cp in.bin /tmp/out.mp4"), ["/tmp/out.mp4"]);
  assert.deepEqual(
    bashMediaPaths(JSON.stringify({ command: "cp in.bin /tmp/out.mp4" }), "copied /tmp/out.mp4"),
    ["/tmp/out.mp4"],
  );
});

test("same path presented again keeps the later seq so the preview can refresh", () => {
  let state = emptyTurnState(1);
  state = applyTurnEvent(state, {
    type: "deliverables/presented",
    seq: 10,
    data: { turn: 1, files: [{ path: "/tmp/app-icon.png" }] },
  });
  state = applyTurnEvent(state, {
    type: "deliverables/presented",
    seq: 20,
    data: { turn: 1, files: [{ path: "/tmp/app-icon.png" }] },
  });
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].path, "/tmp/app-icon.png");
  assert.equal(state.items[0].seq, 20);
});

test("uniquePreviewItems keeps the later same-basename present, not the first copy", () => {
  const items = uniquePreviewItems([
    { path: "/Users/ning/.dsh/app-icon.png", source: "present", name: "app-icon.png", seq: 10 },
    { path: "/Users/ning/Downloads/app-icon.png", source: "present", name: "app-icon.png", seq: 20 },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].path, "/Users/ning/Downloads/app-icon.png");
  assert.equal(items[0].seq, 20);
});

test("itemsFromDeliverables keeps the later present of the same path", () => {
  const items = itemsFromDeliverables({
    presented: [
      { path: "/tmp/app-icon.png", seq: 10 },
      { path: "/tmp/app-icon.png", seq: 20 },
    ],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].seq, 20);
  assert.equal(items[0].source, "present");
});

test("mergeMediaItems keeps the higher seq for the same path", () => {
  const items = mergeMediaItems(
    [{ path: "/tmp/app-icon.png", source: "write", seq: 11, name: "app-icon.png" }],
    [{ path: "/tmp/app-icon.png", source: "present", seq: 20, name: "app-icon.png" }],
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].source, "present");
  assert.equal(items[0].seq, 20);
});

test("mediaFileUrl cache-busts with the event seq", () => {
  assert.equal(
    mediaFileUrl("/tmp/app-icon.png", "image", 20),
    "/api/file?path=" + encodeURIComponent("/tmp/app-icon.png") + "&rev=20",
  );
  assert.equal(
    mediaFileUrl("/tmp/clip.mp4", "video", 8),
    "/api/zhanshi/file?path=" + encodeURIComponent("/tmp/clip.mp4") + "&rev=8",
  );
});

test("present mp4 wins over same-stem png so the gallery shows video", () => {
  const items = uniquePreviewItems([
    { path: "/Users/ning/.dsh/european-girl-street-dance.png", source: "bash", name: "european-girl-street-dance.png" },
    { path: "/Users/ning/.dsh/european-girl-street-dance.mp4", source: "present", name: "european-girl-street-dance.mp4" },
    { path: "/Users/ning/Downloads/european-girl-street-dance.mp4", source: "bash", name: "european-girl-street-dance.mp4" },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].path, "/Users/ning/.dsh/european-girl-street-dance.mp4");
  assert.equal(mediaKind(items[0].path), "video");
});
