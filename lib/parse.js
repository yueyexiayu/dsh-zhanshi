/** Pure media-path collectors for zhanshi. Host tests import this; the Client copies the same rules. */

export const MEDIA_EXT = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  mp4: "video",
  webm: "video",
  mov: "video",
  m4v: "video",
};

const ABS_MEDIA_RE = new RegExp(String.raw`(^|[\s"'=\`:,])(/[^\s"'<>]+?\.(?:png|jpe?g|webp|gif|mp4|webm|mov|m4v))\b`, "gi");
const SAVE_LINE_RE = new RegExp(
  String.raw`^(?:saved|wrote|written|downloaded|output|已保存|写入)\s+(/[^\s"'<>]+?\.(?:png|jpe?g|webp|gif|mp4|webm|mov|m4v))\b`,
  "i",
);
const SKIP_PATH = /(?:^|\/)(?:node_modules|\.git)(?:\/|$)/;
const SESSION_DUMP_MARKERS = [
  '"type":"tool/result"',
  '"type": "tool/result"',
  '"type":"tool/call"',
  '"type": "tool/call"',
  '"type":"assistant/message"',
  '"type": "assistant/message"',
  '"type":"deliverables/presented"',
  '"type": "deliverables/presented"',
  "session.v3.jsonl",
];
const WRITE_REDIR_RE = new RegExp(
  String.raw`(?:>>?)\s*(/[^\s"'<>]+?\.(?:png|jpe?g|webp|gif|mp4|webm|mov|m4v))\b`,
  "gi",
);
const WRITE_DASH_O_RE = new RegExp(
  String.raw`(?:^|[\s])(?:-o|--output|--out|--outfile)\s+(/[^\s"'<>]+?\.(?:png|jpe?g|webp|gif|mp4|webm|mov|m4v))\b`,
  "gi",
);
const COPY_MOVE_RE = /(?:^|[;&|\n]\s*)(?:cp|mv|install|ln|ffmpeg|magick|convert)\b/;

export function mediaKind(path) {
  if (typeof path !== "string") return null;
  const match = /\.([a-z0-9]+)$/i.exec(path.trim());
  if (!match) return null;
  return MEDIA_EXT[match[1].toLowerCase()] || null;
}

export function basename(path) {
  if (typeof path !== "string") return "";
  const trimmed = path.replace(/\/+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

export function isMediaPath(path) {
  if (typeof path !== "string") return false;
  const trimmed = path.trim();
  if (!trimmed) return false;
  if (trimmed.includes("\0") || trimmed.includes("://")) return false;
  if (trimmed.startsWith("//")) return false;
  if (/[*?\[\]{}]/.test(trimmed)) return false;
  if (SKIP_PATH.test(trimmed)) return false;
  if (trimmed.split(/[/\\]/).includes("..")) return false;
  return mediaKind(trimmed) !== null;
}

export function isUsablePath(path) {
  return isMediaPath(path) && path.trim().startsWith("/");
}

function collect(regex, text, group) {
  if (typeof text !== "string" || text.length === 0) return [];
  const found = [];
  const seen = new Set();
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const path = match[group];
    if (!isUsablePath(path) || seen.has(path)) continue;
    seen.add(path);
    found.push(path);
  }
  return found;
}

export function looksLikeSessionDump(text) {
  if (typeof text !== "string" || text.length === 0) return false;
  for (const marker of SESSION_DUMP_MARKERS) {
    if (text.includes(marker)) return true;
  }
  let jsonl = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('{"type":') || trimmed.startsWith('{ "type":')) {
      jsonl += 1;
      if (jsonl >= 2) return true;
    }
  }
  return false;
}

function isCleanSaveLine(trimmed) {
  if (!trimmed) return false;
  const first = trimmed.charAt(0);
  if (first === "{" || first === "[" || first === '"') return false;
  if (trimmed.includes('"type":') || trimmed.includes('"text":') || trimmed.includes("'type':")) return false;
  if (trimmed.includes("\\n") && /(?:saved|wrote|written|downloaded|output|已保存|写入)\s+\//i.test(trimmed)) {
    return false;
  }
  return SAVE_LINE_RE.test(trimmed);
}

export function extractSavedMediaPaths(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const found = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!isCleanSaveLine(trimmed)) continue;
    const match = SAVE_LINE_RE.exec(trimmed);
    if (!match) continue;
    const path = match[1];
    if (!isUsablePath(path) || seen.has(path)) continue;
    seen.add(path);
    found.push(path);
  }
  return found;
}

export function extractWriteDestinations(command) {
  if (typeof command !== "string" || command.length === 0) return [];
  const found = [];
  const seen = new Set();
  const add = (path) => {
    if (!isUsablePath(path) || seen.has(path)) return;
    seen.add(path);
    found.push(path);
  };
  for (const regex of [WRITE_REDIR_RE, WRITE_DASH_O_RE]) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(command)) !== null) add(match[1]);
  }
  if (COPY_MOVE_RE.test(command)) {
    const paths = extractMediaPaths(command);
    if (paths.length) add(paths[paths.length - 1]);
  }
  return found;
}

export function extractMediaPaths(text) {
  return collect(ABS_MEDIA_RE, text, 2);
}

export function toolResultText(event) {
  const content = event && event.data && event.data.message && event.data.message.content;
  const parts = [];
  const walk = (nodes) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      if (typeof node.text === "string") parts.push(node.text);
      if (Array.isArray(node.content)) walk(node.content);
    }
  };
  walk(content);
  return parts.join("\n");
}

function parseArgs(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function pathField(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function mediaFromToolCall(name, argsRaw) {
  const args = parseArgs(argsRaw);
  const paths = [];
  if (name === "write" || name === "edit") {
    const path = args ? pathField(args.file_path) : null;
    if (path) paths.push(path);
  } else if (name === "present" && args && Array.isArray(args.files)) {
    for (const file of args.files) {
      const path = file && pathField(file.path);
      if (path) paths.push(path);
    }
  } else if (name === "read_image") {
    const path = args ? pathField(args.file_path) : null;
    if (path) paths.push(path);
  } else if (name === "bash") {
    const command = args ? pathField(args.command) : null;
    if (command) paths.push(...extractMediaPaths(command));
  }
  return paths.filter(name === "bash" ? isUsablePath : isMediaPath);
}

export function mediaFromPresented(event) {
  const files = event && event.data && event.data.files;
  if (!Array.isArray(files)) return [];
  const paths = [];
  for (const file of files) {
    const path = file && pathField(file.path);
    if (path && isMediaPath(path)) paths.push(path);
  }
  return paths;
}

export function bashMediaPaths(argsRaw, resultText) {
  if (looksLikeSessionDump(resultText)) return [];
  const command = String((parseArgs(argsRaw) || {}).command || "");
  const fromSaved = extractSavedMediaPaths(resultText);
  const fromDest = extractWriteDestinations(command).filter((path) => resultText.includes(path));
  const seen = new Set();
  const paths = [];
  for (const path of [...fromSaved, ...fromDest]) {
    if (!isUsablePath(path) || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

export function emptyTurnState(turn) {
  return { turn: turn || 0, calls: {}, items: [] };
}

function sameItem(left, right) {
  return left.path === right.path
    && left.kind === right.kind
    && left.seq === right.seq
    && left.source === right.source
    && left.name === right.name;
}

function mediaItem(path, seq, source) {
  return {
    path,
    kind: mediaKind(path),
    seq: typeof seq === "number" ? seq : 0,
    source,
    name: basename(path),
  };
}

function pushItems(state, paths, seq, source) {
  if (!paths.length) return state;
  let changed = false;
  const items = state.items.slice();
  const indexByPath = new Map(items.map((item, index) => [item.path, index]));
  for (const path of paths) {
    if (!isMediaPath(path)) continue;
    const next = mediaItem(path, seq, source);
    const index = indexByPath.get(path);
    if (index !== undefined) {
      if (sameItem(items[index], next)) continue;
      items[index] = next;
      changed = true;
      continue;
    }
    if (items.length >= 16) continue;
    indexByPath.set(path, items.length);
    items.push(next);
    changed = true;
  }
  return changed ? { ...state, items } : state;
}

export function applyTurnEvent(state, event) {
  if (!event || typeof event !== "object") return state;
  const type = event.type;
  const data = event.data || {};
  const seq = typeof event.seq === "number" ? event.seq : 0;
  if (type === "turn/start") return emptyTurnState(data.turn);
  if (type === "tool/call") {
    const callId = String(data.callId || "");
    const calls = { ...state.calls };
    calls[callId] = { name: String(data.name || ""), argsRaw: String(data.arguments || "") };
    return { ...state, calls };
  }
  if (type === "deliverables/presented") {
    return pushItems(state, mediaFromPresented(event), seq, "present");
  }
  if (type === "tool/result") {
    const block = Array.isArray(data.message && data.message.content) ? data.message.content[0] : null;
    if (block && block.isError === true) return state;
    const callId = String((data.message && data.message.source && data.message.source.callId) || "");
    const call = state.calls[callId];
    if (!call) return state;
    if (call.name === "write" || call.name === "edit" || call.name === "present" || call.name === "read_image") {
      return pushItems(state, mediaFromToolCall(call.name, call.argsRaw), seq, call.name);
    }
    if (call.name === "bash") {
      return pushItems(state, bashMediaPaths(call.argsRaw, toolResultText(event)), seq, "bash");
    }
    if (call.name === "shengcheng" || call.name === "shengcheng_image" || call.name === "shengcheng_video") {
      return pushItems(state, extractSavedMediaPaths(toolResultText(event)), seq, call.name);
    }
  }
  return state;
}

export function lastTextAssistantSeq(matches) {
  let seq;
  if (!Array.isArray(matches)) return seq;
  for (const match of matches) {
    const event = match && match.event;
    if (!event || event.type !== "assistant/message") continue;
    const content = event.data && event.data.message && event.data.message.content;
    if (!Array.isArray(content)) continue;
    const hasText = content.some((block) => block && block.type === "text" && String(block.text || "").trim());
    if (hasText && typeof event.seq === "number") seq = event.seq;
  }
  return seq;
}

export function galleryAnchorSeq(state, matches) {
  const items = state && Array.isArray(state.items) ? state.items : [];
  const last = items[items.length - 1];
  let anchor = last ? last.seq + 0.02 : 0;
  const assistantSeq = lastTextAssistantSeq(matches);
  if (typeof assistantSeq === "number") anchor = assistantSeq + 0.02;
  return anchor;
}

export function itemsFromDeliverables(data) {
  const byPath = new Map();
  for (const file of data && Array.isArray(data.presented) ? data.presented : []) {
    const path = file && file.path;
    if (!isMediaPath(path)) continue;
    if (!byPath.has(path) && byPath.size >= 16) continue;
    byPath.set(path, mediaItem(path, file && file.seq, "present"));
  }
  for (const file of data && Array.isArray(data.produced) ? data.produced : []) {
    const path = file && file.path;
    if (!isMediaPath(path) || byPath.has(path) || byPath.size >= 16) continue;
    byPath.set(path, mediaItem(path, file && file.seq, "produced"));
  }
  return [...byPath.values()];
}

export function mergeMediaItems(primary, secondary) {
  const byPath = new Map();
  for (const item of [...(primary || []), ...(secondary || [])]) {
    if (!item || !isMediaPath(item.path)) continue;
    const prev = byPath.get(item.path);
    if (!prev) {
      if (byPath.size >= 16) continue;
      byPath.set(item.path, item);
      continue;
    }
    const prevSeq = typeof prev.seq === "number" ? prev.seq : 0;
    const nextSeq = typeof item.seq === "number" ? item.seq : 0;
    if (nextSeq >= prevSeq) byPath.set(item.path, item);
  }
  return [...byPath.values()];
}

export function mediaStem(path) {
  return basename(path).replace(/\.[a-z0-9]+$/i, "").toLowerCase();
}

export function mediaFileUrl(path, kind, rev) {
  if (!path || path.charAt(0) !== "/") return "";
  const api = kind === "video" ? "/api/zhanshi/file" : "/api/file";
  const url = `${api}?path=${encodeURIComponent(path)}`;
  return rev == null || String(rev) === "" ? url : `${url}&rev=${encodeURIComponent(String(rev))}`;
}

function newerOrSameSeq(prev, item) {
  const prevSeq = typeof prev.seq === "number" ? prev.seq : 0;
  const nextSeq = typeof item.seq === "number" ? item.seq : 0;
  return nextSeq >= prevSeq;
}

export function uniquePreviewItems(items) {
  const list = Array.isArray(items) ? items.filter((item) => item && isMediaPath(item.path)) : [];
  const presented = list.filter((item) => item.source === "present");
  const pool = presented.length > 0 ? presented : list;
  const videos = pool.filter((item) => mediaKind(item.path) === "video");
  const chosen = videos.length > 0 ? videos : pool;
  const byKey = new Map();
  for (const item of chosen) {
    const key = basename(item.path).toLowerCase();
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev || newerOrSameSeq(prev, item)) byKey.set(key, item);
  }
  return [...byKey.values()].slice(0, 16);
}
