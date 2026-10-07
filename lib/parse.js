/** Pure media-path collectors for zhanshi; tests also exercise the shipped Client reducer. */

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

const SAVE_LINE_RE = /^(?:saved|wrote|written|downloaded|output|已保存|写入)\s+(.+)$/i;
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
  if (/[\u0000-\u001f\u007f]/.test(trimmed) || trimmed.includes("://")) return false;
  if (trimmed.startsWith("//")) return false;
  if (/[*?\[\]{}]/.test(trimmed)) return false;
  if (SKIP_PATH.test(trimmed)) return false;
  if (trimmed.split(/[/\\]/).includes("..")) return false;
  return mediaKind(trimmed) !== null;
}

export function isUsablePath(path) {
  return isMediaPath(path) && path.trim().startsWith("/");
}

// A deliberately small literal-command parser, not a shell interpreter. Reject
// compound commands, expansion, substitutions and comments instead of guessing.
function literalShellWords(command) {
  if (typeof command !== "string") return [];
  const words = [];
  let word = "", quote = "", started = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) { quote = ""; continue; }
      if (quote === '"' && /[$`\\]/.test(ch)) return [];
      if (/\r|\n/.test(ch)) return [];
      word += ch; continue;
    }
    if (/[$`;|&()<\r\n#]/.test(ch)) return [];
    if (ch === ">") {
      if (started) words.push(word);
      words.push("\0>");
      if (command[i + 1] === ">") i++;
      word = ""; started = false; continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; started = true; continue; }
    if (ch === "\\") {
      if (++i >= command.length || /\r|\n/.test(command[i])) return [];
      word += command[i]; started = true; continue;
    }
    if (/\s/.test(ch)) {
      if (started) words.push(word);
      word = ""; started = false;
    } else { word += ch; started = true; }
  }
  if (quote) return [];
  if (started) words.push(word);
  return words;
}

function savedLinePath(line) {
  const match = SAVE_LINE_RE.exec(line);
  if (!match) return null;
  let value = match[1];
  // Only the documented numeric size suffix is recognized as metadata.
  // Never stop at a media extension in the middle of a filename.
  if (!isUsablePath(value)) value = value.replace(/\s+size=\d+$/, "");
  if ((value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) value = value.slice(1, -1);
  return isUsablePath(value) ? value : null;
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
  if (typeof text !== "string" || text.length === 0 || looksLikeSessionDump(text)) return [];
  const found = [];
  const seen = new Set();
  const lines = text.split(/\r?\n/);
  const records = lines.filter((line) => /^shengcheng_result(?:\s|$)/.test(line));
  // The machine record is authoritative: never fall back to a truncated legacy
  // save line when a new producer supplied a malformed or unsupported record.
  if (records.length) {
    for (const line of records) {
      const record = parseArgs(line.slice("shengcheng_result".length));
      const path = record && record.path;
      if (typeof path !== "string" || path !== path.trim() || /[\u0000-\u001f\u007f]/.test(path)
        || !isUsablePath(path) || seen.has(path)) continue;
      seen.add(path);
      found.push(path);
    }
    return found;
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (!isCleanSaveLine(trimmed)) continue;
    const path = savedLinePath(trimmed);
    if (!isUsablePath(path) || seen.has(path)) continue;
    seen.add(path);
    found.push(path);
  }
  return found;
}

export function extractWriteDestinations(command) {
  const words = literalShellWords(command);
  const found = [];
  const add = path => { if (isUsablePath(path) && !found.includes(path)) found.push(path); };
  for (let i = 0; i < words.length; i++) {
    if (words[i] === "\0>") add(words[i + 1]);
  }
  // Output options are command-specific; e.g. grep -o is not a destination.
  const name = basename(words[0] || "");
  const outputFlags = name === "curl" ? ["-o", "--output"] : name === "wget" ? ["-O", "--output-document"] : [];
  for (let i = 1; i < words.length; i++) {
    if (outputFlags.includes(words[i])) add(words[i + 1]);
  }
  if (["cp", "mv", "install", "ln"].includes(name) && !words.includes("\0>")) {
    // Only no-argument flags are understood. Unknown/argument-taking options
    // (notably -tDIR, -vtDIR and --suffix) make operand counting unreliable.
    const flags = { cp: /^[aRrfivnpPLH]+$/, mv: /^[fivn]+$/, install: /^[svbcD]+$/, ln: /^[sfivnPL]+$/ }[name];
    const operands = [];
    let options = true, reliable = true;
    for (const word of words.slice(1)) {
      if (options && word === "--") { options = false; continue; }
      if (options && word.startsWith("-")) {
        if (!flags.test(word.slice(1))) { reliable = false; break; }
      } else operands.push(word);
    }
    if (reliable && operands.length >= 2) add(operands.at(-1));
  } else if (["ffmpeg", "magick", "convert"].includes(name) && !words.includes("\0>")) add(words.at(-1));
  return found;
}

export function toolResultText(event) {
  const content = event && event.data && event.data.message && event.data.message.content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text).join("\n");
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
  }
  return paths.filter(isMediaPath);
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

function mentionsPath(text, path) {
  let offset = -1;
  while ((offset = text.indexOf(path, offset + 1)) >= 0) {
    const before = offset === 0 ? "" : text[offset - 1];
    const after = text[offset + path.length] || "";
    if ((!before || /[\s'"=:]/.test(before)) && (!after || /[\s'"]/.test(after))) return true;
  }
  return false;
}

function successfulBashOutput(text) {
  // Foreground failure and background markers live in durable rendered output.
  return typeof text === "string" && !/(?:^|\n)\[(?:exit code: (?:-?[1-9]\d*|null)|killed by signal:|timed out after|stopped:|still running after)/.test(text) && !looksLikeSessionDump(text);
}

export function bashMediaPaths(argsRaw, resultText) {
  if (!successfulBashOutput(resultText)) return [];
  const command = String((parseArgs(argsRaw) || {}).command || "");
  const fromSaved = extractSavedMediaPaths(resultText);
  const fromDest = extractWriteDestinations(command).filter((path) => mentionsPath(resultText, path));
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
    presented: source === "present",
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
      next.presented = next.presented || items[index].presented;
      if (items[index].seq > next.seq) next.seq = items[index].seq;
      if (sameItem(items[index], next) && items[index].presented === next.presented) continue;
      items[index] = next;
      changed = true;
      continue;
    }
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
    const name = String(data.name || "");
    if (!["write", "edit", "present", "read_image", "bash", "shengcheng", "shengcheng_image", "shengcheng_video", "chrome_screenshot"].includes(name)) return state;
    // Keep only pending calls and parsed media destinations, never file contents,
    // prompts, complete commands or parameters of unrelated tools.
    const paths = name === "bash"
      ? extractWriteDestinations((parseArgs(data.arguments) || {}).command)
      : mediaFromToolCall(name, data.arguments);
    const calls = { ...state.calls, [String(data.callId || "")]: { name, paths } };
    return { ...state, calls };
  }
  if (type === "deliverables/presented") return pushItems(state, mediaFromPresented(event), seq, "present");
  if (type === "tool/result") {
    const callId = String(data.message?.source?.callId || data.callId || "");
    if (!Object.prototype.hasOwnProperty.call(state.calls, callId)) return state;
    const call = state.calls[callId];
    const calls = { ...state.calls };
    delete calls[callId];
    state = { ...state, calls };
    if (!data.message || data.message.isError !== false || data.error != null) return state;
    if (["write", "edit", "present", "read_image"].includes(call.name)) return pushItems(state, call.paths, seq, call.name);
    const text = toolResultText(event);
    if (call.name === "bash") {
      if (!successfulBashOutput(text)) return state;
      return pushItems(state, extractSavedMediaPaths(text).concat(call.paths.filter(path => mentionsPath(text, path))), seq, call.name);
    }
    return pushItems(state, extractSavedMediaPaths(text), seq, call.name);
  }
  return state;
}
