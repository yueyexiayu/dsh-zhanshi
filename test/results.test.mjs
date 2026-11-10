import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { applyTurnEvent, emptyTurnState } from "../lib/parse.js";

// Exercise the shipped browser reducer, not a copy of its implementation.
const hookValues = [];
let hookIndex = 0;
const effects = [];
let previewFetch;
const fakeReact = {
  useEffect(effect) { effects.push(effect); },
  createElement(type, props, ...children) {
    if (typeof type === "function") { hookIndex = 0; return type(props); }
    return { type, props, children };
  },
  useState(initial) { const index = hookIndex++; if (!(index in hookValues)) hookValues[index] = initial; return [hookValues[index], value => { hookValues[index] = value; }]; },
};
let definition;
let Gallery;
runInNewContext(readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"), {
  AbortController,
  fetch: (...args) => previewFetch(...args),
  window: { __ModuleLoader__: { load(bundle) {
    bundle.factory(() => fakeReact).apply({
      uiConversation: { events: { register(value) { definition = value; } } },
      slots: { inject(_name, apply) { apply(); }, register(_options, component) { Gallery = component; } },
    });
  } } },
  document: { getElementById: () => ({}), createElement: () => ({}), head: { appendChild() {} } },
});

const reducers = {
  parser: { start: () => emptyTurnState(1), update: applyTurnEvent },
  client: {
    start: () => definition.start({}, { event: { data: { turn: 1 } } }),
    update: (state, event) => definition.update({ state }, { event }),
  },
};
const calls = [
  ["write", { file_path: "/tmp/output.png", content: "x" }],
  ["edit", { file_path: "/tmp/output.png", old_string: "a", new_string: "b" }],
  ["read_image", { file_path: "/tmp/output.png" }],
  ["present", { files: [{ path: "/tmp/output.png" }] }],
  ["bash", { command: "cp input.png /tmp/output.png" }],
  ["shengcheng", {}],
  ["chrome_screenshot", {}],
  ["huoqu", {}],
];
function events(name, args, isError, text = "saved /tmp/output.png", extra = {}) {
  return [
    { type: "tool/call", seq: 1, data: { turn: 1, step: 1, callId: "c", name, arguments: JSON.stringify(args) } },
    { type: "tool/result", seq: 2, data: { turn: 1, step: 1, message: {
      role: "tool", source: { kind: "tool", callId: "c" }, toolCallId: "c", isError,
      content: [{ type: "text", text }],
    }, ...extra } },
  ];
}
function replay(reducer, inputs) { return inputs.reduce(reducer.update, reducer.start()); }

for (const [surface, reducer] of Object.entries(reducers)) {
  for (const [name, args] of calls) {
    test(`${surface}: v4 failed ${name} contributes no media`, () => {
      const state = replay(reducer, events(name, args, true));
      assert.equal(state.items.length, 0);
    });
    test(`${surface}: v4 successful ${name} ${name === "read_image" ? "does not imply production" : "still contributes media"}`, () => {
      const state = replay(reducer, events(name, args, false));
      assert.equal(state.items.length, name === "read_image" ? 0 : 1);
      if (name !== "read_image") assert.equal(state.items[0].path, "/tmp/output.png");
    });
  }
  for (const text of [
    "saved /tmp/output.png\n[exit code: 1]",
    "saved /tmp/output.png\n[timed out after 100ms]\n[exit code: 0]",
    "saved /tmp/output.png\n[timed out after 100.5ms]",
    "saved /tmp/output.png\n[killed by signal: SIGTERM]",
    "saved /tmp/output.png\n[stopped: tool call aborted]\n[exit code: 0]",
    "saved /tmp/output.png\n[still running after 100ms; moved to background job j1]\nThe command keeps running in the background.",
    "saved /tmp/output.png\n[still running after 100.5ms; moved to background job j1]\nThe command keeps running in the background.",
  ]) {
    test(`${surface}: unsuccessful or unfinished bash output does not enter gallery: ${text.split("\n")[1]}`, () => {
      assert.equal(replay(reducer, events("bash", {}, false, text)).items.length, 0);
    });
  }
  test(`${surface}: incomplete result and structured error are not success`, () => {
    assert.equal(replay(reducer, events("write", calls[0][1], undefined)).items.length, 0);
    assert.equal(replay(reducer, events("write", calls[0][1], false, "saved /tmp/output.png", { error: { name: "ToolError", code: "IO_ERROR" } })).items.length, 0);
  });
  test(`${surface}: failed retry does not overwrite earlier successful media identity`, () => {
    const good = replay(reducer, events("write", calls[0][1], false));
    const failure = events("write", calls[0][1], true)[1];
    failure.seq = 8;
    const after = reducer.update(good, failure);
    assert.equal(after.items.length, 1);
    assert.equal(after.items[0].seq, 2);
  });
  test(`${surface}: replacement tool results do not contribute media`, () => {
    const good = replay(reducer, events("write", calls[0][1], false));
    const call = events("write", { file_path: "/tmp/replacement.png" }, false)[0];
    const result = events("write", { file_path: "/tmp/replacement.png" }, false)[1];
    call.seq = 8;
    result.seq = 9;
    result.surfaceOp = "replace";
    const match = definition.match(result);
    assert.equal(match.id, "1");
    assert.equal(match.role, "update");
    const after = reducer.update(reducer.update(good, call), result);
    assert.deepEqual(Array.from(after.items, item => item.path), ["/tmp/output.png"]);
    assert.equal(Object.keys(after.calls).length, 0);
  });
}

for (const [surface, reducer] of Object.entries(reducers)) {
  const path = '/tmp/图 像.png folder/引号"与\'emoji🎨.png';
  const structured = `shengcheng_result ${JSON.stringify({ path })}`;
  test(`${surface}: structured path preserves spaces, quotes and Unicode without legacy truncation`, () => {
    const state = replay(reducer, events("shengcheng", {}, false, `${structured}\nsaved ${path}\nprovider metadata`));
    assert.deepEqual(Array.from(state.items, item => item.path), [path]);
  });
  test(`${surface}: structured duplicate paths are deduplicated`, () => {
    assert.equal(replay(reducer, events("shengcheng", {}, false, `${structured}\n${structured}`)).items.length, 1);
  });
  for (const value of [null, [], {}, { path: 1 }, { path: "relative.png" }, { path: "//server/a.png" },
    { path: "/tmp/../a.png" }, { path: "/tmp/node_modules/a.png" }, { path: "/tmp/a.png.exe" },
    { path: "/tmp/a\n.png" }, { path: "/tmp/a\u0000.png" }, { path: " /tmp/a.png" }]) {
    test(`${surface}: rejects invalid structured record ${JSON.stringify(value)}`, () => {
      const text = `shengcheng_result ${JSON.stringify(value)}\nsaved /tmp/fallback.png`;
      assert.equal(replay(reducer, events("shengcheng", {}, false, text)).items.length, 0);
    });
  }
  for (const text of [
    'shengcheng_result {broken}\nsaved /tmp/fallback.png',
    'shengcheng_result {"path":"/tmp/a.png"} trailing',
    JSON.stringify({ type: "tool/result", text: structured }),
    `{"type": "tool/result"}\n${structured}\nsaved /tmp/fallback.png`,
    `quoted example: ${structured}`,
  ]) {
    test(`${surface}: rejects malformed, quoted and dumped protocol ${text}`, () => {
      assert.equal(replay(reducer, events("shengcheng", {}, false, text)).items.length, 0);
    });
  }
  test(`${surface}: structured success text cannot override failed event status`, () => {
    for (const isError of [true, undefined]) {
      assert.equal(replay(reducer, events("shengcheng", {}, isError, structured)).items.length, 0);
    }
    assert.equal(replay(reducer, events("shengcheng", {}, false, structured, { error: { code: "IO_ERROR" } })).items.length, 0);
  });
  test(`${surface}: huoqu labeled local preview is media, but missing/relative output is not`, () => {
    assert.deepEqual(Array.from(replay(reducer, events("huoqu", {}, false, "本地预览：/tmp/source.png")).items, item => item.path), ["/tmp/source.png"]);
    for (const text of ["本地预览：未生成", "本地预览：relative.png", "说明：本地预览：/tmp/example.png"]) {
      assert.equal(replay(reducer, events("huoqu", {}, false, text)).items.length, 0, text);
    }
  });
}

for (const [surface, reducer] of Object.entries(reducers)) {
  test(`${surface}: legacy saved paths preserve spaces and never truncate extensions`, () => {
    assert.equal(replay(reducer, events("shengcheng", {}, false, "saved /tmp/new photo.png")).items[0]?.path, "/tmp/new photo.png");
    for (const path of ["/tmp/a.png.backup", "/tmp/a.png-more", "/tmp/a.png/child.txt"]) {
      assert.equal(replay(reducer, events("shengcheng", {}, false, `saved ${path}`)).items.length, 0);
    }
  });
  test(`${surface}: compound shell does not infer an unrelated ls target`, () => {
    const state = replay(reducer, events("bash", { command: "cp '/tmp/in.png' '/tmp/out.png'; ls '/tmp/old.png'" }, false, "/tmp/old.png\n[exit code: 0]"));
    assert.equal(state.items.length, 0);
  });
  test(`${surface}: literal shell paths are complete and quoted targets work`, () => {
    const accepted = replay(reducer, events("bash", { command: "cp /tmp/in.png '/tmp/new photo.png'" }, false, "'/tmp/new photo.png'\n[exit code: 0]"));
    assert.equal(accepted.items[0]?.path, "/tmp/new photo.png");
    for (const [command, output] of [
      ["cp /tmp/in.png /tmp/out.png.backup", "/tmp/out.png.backup"],
      ["cp /tmp/in.png /tmp/out.png", "/tmp/out.png.backup"],
      ["grep -o /tmp/old.png notes.txt", "/tmp/old.png"],
      ["cp /tmp/in.png $(echo /tmp/old.png)", "/tmp/old.png"],
    ]) assert.equal(replay(reducer, events("bash", { command }, false, output + "\n[exit code: 0]")).items.length, 0);
  });
  test(`${surface}: curl and wget output options have command-specific meanings`, () => {
    for (const [command, expected] of [
      ["curl -o /tmp/new.png https://example.test/image", 1],
      ["curl --output /tmp/new.png https://example.test/image", 1],
      ["wget -O /tmp/new.png https://example.test/image", 1],
      ["wget --output-document /tmp/new.png https://example.test/image", 1],
      ["curl -O /tmp/new.png", 0],
      ["wget -o /tmp/new.png https://example.test/image", 0],
    ]) assert.equal(replay(reducer, events("bash", { command }, false, "/tmp/new.png\n[exit code: 0]")).items.length, expected, command);
  });
  test(`${surface}: image tools and joined output options keep parser parity`, () => {
    for (const [command, expected] of [
      ["magick identify /tmp/source.png", 0],
      ["convert /tmp/source.png /tmp/new.png", 1],
      ["magick /tmp/source.png -resize 50% /tmp/new.png", 1],
      ["ffmpeg -i /tmp/source.png", 0],
      ["curl --output=/tmp/new.png https://example.test/image", 1],
      ["wget --output-document=/tmp/new.png https://example.test/image", 1],
      ["curl https://example.test/image | tee /tmp/new.png", 1],
    ]) {
      const path = expected ? "/tmp/new.png" : "/tmp/source.png";
      assert.equal(replay(reducer, events("bash", { command }, false, `${path}\n[exit code: 0]`)).items.length, expected, command);
    }
  });
  test(`${surface}: copy-like commands require reliable explicit destination operands`, () => {
    for (const command of ["cp -vt/tmp/output /tmp/old.png", "cp -t/tmp/output -v /tmp/old.png", "mv -vt/tmp/output /tmp/old.png", "install -vt/tmp/output /tmp/old.png", "ln -vt/tmp/output /tmp/old.png", "ln -v /tmp/old.png", "ln --suffix .bak /tmp/old.png"]) {
      assert.equal(replay(reducer, events("bash", { command }, false, "/tmp/old.png\n[exit code: 0]")).items.length, 0, command);
    }
    for (const command of ["cp -v /tmp/input.png /tmp/new.png", "ln -sv /tmp/input.png /tmp/new.png", "cp -- /tmp/input.png /tmp/new.png"]) {
      assert.equal(replay(reducer, events("bash", { command }, false, "/tmp/new.png\n[exit code: 0]")).items[0]?.path, "/tmp/new.png", command);
    }
  });
  test(`${surface}: later present survives and completed relevant calls remain bounded`, () => {
    let state = reducer.start();
    for (let i = 0; i < 1000; i++) {
      const pair = events("write", { file_path: `/tmp/intermediate${i % 20}.png`, content: "payload" }, false);
      state = reducer.update(reducer.update(state, pair[0]), pair[1]);
      assert.equal(Object.keys(state.calls).length, 0);
    }
    state = reducer.update(state, { type: "deliverables/presented", seq: 1001, data: { files: [{ path: "/tmp/FINAL.png" }] } });
    assert.ok(state.items.some(item => item.path === "/tmp/FINAL.png"));
  });
  test(`${surface}: irrelevant calls are not retained and relevant calls keep only paths`, () => {
    let state = reducer.start();
    for (let i = 0; i < 4000; i++) state = reducer.update(state, { type: "tool/call", data: { name: "read", callId: `r${i}`, arguments: '{"file_path":"huge.txt"}' } });
    assert.equal(Object.keys(state.calls).length, 0);
    const input = events("write", { file_path: "/tmp/a.png", content: "PAYLOAD".repeat(10000) }, false);
    state = reducer.update(state, input[0]);
    assert.ok(JSON.stringify(state.calls).length < 200);
    state = reducer.update(state, input[1]);
    assert.equal(Object.keys(state.calls).length, 0);
    state = replay(reducer, events("write", { file_path: "/tmp/a.png" }, true));
    assert.equal(Object.keys(state.calls).length, 0);
  });
}

function nodes(node, type, out = []) {
  if (Array.isArray(node)) node.forEach(child => nodes(child, type, out));
  else if (node && typeof node === "object") { if (node.type === type) out.push(node); nodes(node.children, type, out); }
  return out;
}

test("client keeps a single media preview when an official card presents the same path", () => {
  const rendered = Gallery({ cwd: "/tmp/fixture", seq: 9, turn: { data: {
    zhanshi: { items: [{ path: "./actual.png", seq: 6 }] },
    deliverables: { presented: [{ path: "/tmp//fixture/actual.png", seq: 2 }], produced: [{ path: "actual.png", seq: 6 }] },
  } } });
  const images = nodes(rendered, "img");
  assert.equal(images.length, 1);
  assert.equal(new URL(images[0].props.src, "https://fixture.invalid").searchParams.get("path"), "/tmp/fixture/actual.png");
});

test("client normalizes cwd before dedup", () => {
  const rendered = Gallery({ cwd: "/tmp/fixture", turn: { data: {
    zhanshi: { items: [{ path: "./actual.png", seq: 6 }] },
    deliverables: { produced: [{ path: "/tmp//fixture/actual.png", seq: 2 }] },
  } } });
  const images = nodes(rendered, "img");
  assert.equal(images.length, 1);
  assert.equal(new URL(images[0].props.src, "https://fixture.invalid").searchParams.get("path"), "/tmp/fixture/actual.png");
});

test("client validates cwd-resolved paths and uses the bounded media route", () => {
  for (const cwd of ["/tmp/.git", "/tmp/node_modules"]) {
    assert.equal(Gallery({ cwd, turn: { data: { deliverables: { presented: [{ path: "a.png", seq: 3 }] } } } }), null);
  }
  const tree = Gallery({ cwd: "/tmp", turn: { data: { deliverables: { produced: [{ path: "photo.png", seq: 2 }, { path: "clip.mp4", seq: 8 }] } } } });
  assert.equal(nodes(tree, "img")[0].props.src, "/api/zhanshi/file?path=%2Ftmp%2Fphoto.png");
  assert.equal(nodes(tree, "video")[0].props.src, "/api/zhanshi/file?path=%2Ftmp%2Fclip.mp4");
  assert.equal(nodes(tree, "img")[0].props.loading, "lazy");
  assert.equal(nodes(tree, "img")[0].props.decoding, "async");
  assert.equal(nodes(tree, "img")[0].props.referrerPolicy, "no-referrer");
});

test("client resolves Windows drive paths and deduplicates canonical argument aliases", () => {
  const windows = Gallery({ cwd: "C:\\work", turn: { data: {
    zhanshi: { items: [{ path: "out\\Image.png" }] },
    deliverables: { produced: [{ path: "c:/WORK/OUT/image.png" }] },
  } } });
  assert.equal(nodes(windows, "img").length, 1);
  assert.equal(new URL(nodes(windows, "img")[0].props.src, "https://fixture.invalid").searchParams.get("path"), "C:/WORK/OUT/image.png");
  const aliased = Gallery({ cwd: "/tmp/work", turn: { data: {
    zhanshi: { items: [{ path: "argument.png", seq: 2 }] },
    deliverables: { produced: [{ path: "/tmp/canonical.png", argumentPath: "argument.png" }] },
  } } });
  const images = nodes(aliased, "img");
  assert.equal(images.length, 1);
  assert.equal(new URL(images[0].props.src, "https://fixture.invalid").searchParams.get("path"), "/tmp/canonical.png");
});

test("client merges official presented files and keeps post-closing media", () => {
  const presented = Gallery({ seq: 2, turn: { data: { deliverables: { presented: [{ path: "/tmp/presented.png", seq: 8 }] } } } });
  assert.equal(nodes(presented, "img").length, 1);
  const late = Gallery({ seq: 2, turn: { data: { zhanshi: { items: [{ path: "/tmp/late.png", seq: 9 }] } } } });
  assert.equal(nodes(late, "img").length, 1);
});

test("client prioritizes final presented files and reports hidden media", () => {
  const state = { items: Array.from({ length: 20 }, (_, i) => ({ path: `/tmp/intermediate${i}.png`, seq: i })) };
  state.items.push({ path: "/tmp/FINAL.png", seq: 25, source: "present", presented: true });
  const rendered = Gallery({ turn: { data: { zhanshi: state } } });
  const images = nodes(rendered, "img");
  assert.equal(images.length, 16);
  assert.ok(images.some(image => image.props.src.includes("FINAL.png")));
  assert.match(JSON.stringify(rendered), /另有 5 项/);
});

test("client media errors remain visible with retry and open actions", () => {
  for (const [path, type] of [["/tmp/missing.png", "img"], ["/tmp/missing.mp4", "video"]]) {
    hookValues.length = 0;
    const props = { turn: { data: { zhanshi: { items: [{ path, seq: 1 }] } } }, openFile() {} };
    let rendered = Gallery(props);
    const media = nodes(rendered, type)[0];
    if (type === "video") assert.equal(media.props.preload, "metadata");
    assert.equal(typeof media.props.onError, "function");
    const card = { style: {} };
    media.props.onError({ currentTarget: { closest: () => card } });
    assert.notEqual(card.style.display, "none");
    rendered = Gallery(props);
    assert.match(JSON.stringify(rendered), /预览失败/);
    const retry = nodes(rendered, "button").find(button => button.children.includes("重试"));
    assert.ok(retry);
    retry.props.onClick();
    rendered = Gallery(props);
    assert.notEqual(nodes(rendered, type)[0].props.src, media.props.src);
    assert.doesNotMatch(JSON.stringify(rendered), /预览失败/);
  }
  hookValues.length = 0;
});

test("gallery retains trusted official deliverables with no local match", () => {
  const rendered = Gallery({ turn: { data: { deliverables: { produced: [{ path: "/tmp/official.png", seq: 3 }] } } } });
  assert.equal(rendered.props["data-zhanshi"], "media");
});

test("client gallery remains empty after failed collection", () => {
  const state = replay(reducers.client, events("write", calls[0][1], true));
  assert.equal(Gallery({ turn: { data: { zhanshi: state } } }), null);
});

test("client definition runs the full match/start/update path and clears replacement calls", () => {
  const startEvent = { type: "turn/start", seq: 0, data: { turn: 1 } };
  const start = definition.match(startEvent);
  assert.equal(start.id, "1");
  assert.equal(start.role, "start");
  let state = definition.start({}, { event: startEvent });
  const [callEvent, resultEvent] = events("write", { file_path: "/tmp/output.png" }, false);
  const call = definition.match(callEvent);
  assert.equal(call.id, "1");
  assert.equal(call.role, "update");
  state = definition.update({ state }, { event: callEvent });
  resultEvent.surfaceOp = "replace";
  const result = definition.match(resultEvent);
  assert.equal(result.id, "1");
  assert.equal(result.role, "update");
  state = definition.update({ state }, { event: resultEvent });
  assert.equal(Object.keys(state.calls).length, 0);
  assert.equal(state.items.length, 0);
});

function galleryMedia(node, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) galleryMedia(child, out);
  } else if (node && typeof node === "object") {
    if (node.type === "img" || node.type === "video") out.push({ type: node.type, src: node.props.src });
    galleryMedia(node.children, out);
  }
  return out;
}

for (const [name, image, video, presentVideo] of [
  ["same-stem generated", "/tmp/output.jpg", "/tmp/output.mp4", false],
  ["different-stem generated", "/tmp/image.jpg", "/tmp/movie.mp4", false],
  ["generated image beside presented video", "/tmp/image.jpg", "/tmp/movie.mp4", true],
]) {
  test(`client gallery renders image and video together: ${name}`, () => {
    const inputs = [image, video].flatMap((path, index) => events("shengcheng", {}, false, `saved ${path}`)
      .map(event => ({ ...event, seq: index * 2 + event.seq })));
    if (presentVideo) inputs.push({ type: "deliverables/presented", seq: 5,
      data: { turn: 1, files: [{ path: video }] } });
    const state = replay(reducers.client, inputs);
    const media = galleryMedia(Gallery({ turn: { data: { zhanshi: state } } }));
    assert.deepEqual(media.map(item => item.type), ["img", "video"]);
    assert.deepEqual(media.map(item => new URL(item.src, "https://fixture.invalid").searchParams.get("path")), [image, video]);
  });
}

test("client gallery keeps equal basenames in separate directories", () => {
  const rendered = Gallery({ turn: { data: { zhanshi: { items: [
    { path: "/tmp/first/output.jpg", kind: "image", source: "present", seq: 2 },
    { path: "/tmp/second/output.jpg", kind: "image", source: "shengcheng", seq: 4 },
  ] } } } });
  const media = galleryMedia(rendered);
  assert.deepEqual(media.map(item => new URL(item.src, "https://fixture.invalid").searchParams.get("path")),
    ["/tmp/first/output.jpg", "/tmp/second/output.jpg"]);
});

for (const [kind, mediaType, path, label] of [
  ["image", "img", "/tmp/large.png", "图片"],
  ["video", "video", "/tmp/large.mp4", "视频"],
]) {
  test(`client ${kind} HEAD downgrades oversized media with retry and open actions`, async () => {
    hookValues.length = 0;
    let opened;
    previewFetch = async (url, options) => {
      assert.equal(options.method, "HEAD");
      assert.equal(url, "/api/zhanshi/file?path=" + encodeURIComponent(path));
      return new Response(null, { status: 413, headers: { "X-Zhanshi-Preview": "open-file", "X-Zhanshi-File-Size": String(256 * 1048576), "X-Zhanshi-Preview-Limit": String(64 * 1048576) } });
    };
    const props = { turn: { data: { zhanshi: { items: [{ path, kind, seq: 1 }] } } }, openFile(value) { opened = value; } };
    Gallery(props); const cleanup = effects.at(-1)();
    await new Promise(resolve => setImmediate(resolve));
    const rendered = Gallery(props);
    assert.equal(nodes(rendered, mediaType).length, 0);
    assert.match(JSON.stringify(rendered), new RegExp(label + ".*256 MiB.*64 MiB"));
    const buttons = nodes(rendered, "button");
    assert.ok(buttons.find(button => button.children.includes("重试")));
    buttons.find(button => button.children.includes("打开文件")).props.onClick();
    assert.equal(opened, path); cleanup(); hookValues.length = 0;
  });
}

test("client video HEAD failures remain visible and disposed requests do not update state", async () => {
  const props = { turn: { data: { zhanshi: { items: [{ path: "/tmp/missing.mp4", kind: "video", seq: 1 }] } } } };
  for (const status of [403, 404, 500]) {
    hookValues.length = 0; previewFetch = async () => new Response(null, { status });
    Gallery(props); const cleanup = effects.at(-1)(); await new Promise(resolve => setImmediate(resolve));
    assert.match(JSON.stringify(Gallery(props)), new RegExp("HTTP " + status)); cleanup();
  }
  hookValues.length = 0; let release, signal;
  previewFetch = (_url, options) => { signal = options.signal; return new Promise(resolve => { release = resolve; }); };
  Gallery(props); const cleanup = effects.at(-1)(); cleanup();
  assert.equal(signal.aborted, true); release(new Response(null, { status: 404 }));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(hookValues[0], false);
  hookValues.length = 0;
});

for (const [surface, reducer] of Object.entries(reducers)) {
  test(`${surface}: read_image is inspection, not this-turn production`, () => {
    assert.equal(replay(reducer, events("read_image", { file_path: "/tmp/old.png" }, false)).items.length, 0);
  });
}

test("client gallery merges official present with local latest seq without hiding other media", () => {
  const rendered = Gallery({ turn: { data: {
    zhanshi: { items: [
      { path: "/tmp/output.jpg", kind: "image", source: "shengcheng", seq: 6 },
      { path: "/tmp/clip.mp4", kind: "video", source: "shengcheng", seq: 5 },
    ] },
    deliverables: { presented: [{ path: "/tmp/output.jpg", seq: 2 }] },
  } } });
  const media = galleryMedia(rendered);
  assert.deepEqual(media.map(item => item.type), ["img", "video"]);
  assert.equal(new URL(media[1].src, "https://fixture.invalid").searchParams.get("path"), "/tmp/clip.mp4");
});

test("client preserves presented video preview alongside its official card", () => {
  const state = replay(reducers.client, [
    ...events("shengcheng", {}, false, "saved /tmp/clip.mp4"),
    { type: "deliverables/presented", seq: 3, data: { turn: 1, files: [{ path: "/tmp/clip.mp4" }] } },
  ]);
  const media = galleryMedia(Gallery({ seq: 4, turn: { data: {
    zhanshi: state, deliverables: { presented: [{ path: "/tmp/clip.mp4", seq: 3 }] },
  } } }));
  assert.equal(media.length, 1);
  assert.equal(media[0].type, "video");
  assert.equal(new URL(media[0].src, "https://fixture.invalid").searchParams.get("path"), "/tmp/clip.mp4");
});
