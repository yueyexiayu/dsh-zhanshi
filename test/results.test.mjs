import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { applyTurnEvent, emptyTurnState } from "../lib/parse.js";

// Exercise the shipped browser reducer, not a copy of its implementation.
let definition;
let Gallery;
runInNewContext(readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"), {
  window: { __ModuleLoader__: { load(bundle) {
    bundle.factory(() => ({ createElement: (type, props, ...children) => ({ type, props, children }) })).apply({
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
    test(`${surface}: v4 successful ${name} still contributes media`, () => {
      const state = replay(reducer, events(name, args, false));
      assert.equal(state.items.length, 1);
      assert.equal(state.items[0].path, "/tmp/output.png");
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
}

test("gallery retains trusted official deliverables with no local match", () => {
  const rendered = Gallery({ turn: { data: { deliverables: { produced: [{ path: "/tmp/official.png", seq: 3 }] } } } });
  assert.equal(rendered.props["data-zhanshi"], "media");
});

test("client gallery remains empty after failed collection", () => {
  const state = replay(reducers.client, events("write", calls[0][1], true));
  assert.equal(Gallery({ turn: { data: { zhanshi: state } } }), null);
});
