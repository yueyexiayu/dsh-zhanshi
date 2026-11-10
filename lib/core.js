/** Shared media collectors and turn reducer embedded into the self-contained Client. */

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
const LABELED_MEDIA_LINE_RE = /^(?:本地预览|来源截图|预览图|截图|local\s+preview|source\s+screenshot|preview\s+image|screenshot)\s*[:：]\s*(.+)$/i;
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_DRIVE = /^[a-z]:[\\/]/i;
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
  const match = /\.([a-z0-9]+)\s*$/i.exec(path);
  if (!match) return null;
  return MEDIA_EXT[match[1].toLowerCase()] || null;
}

export function basename(path) {
  if (typeof path !== "string") return "";
  const trimmed = path.replace(/[/\\]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

export function isMediaPath(path) {
  if (typeof path !== "string") return false;
  if (!path) return false;
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  const normalized = path.replace(/\\/g, "/");
  if (!WINDOWS_DRIVE.test(path) && URI_SCHEME.test(normalized)) return false;
  if (normalized.startsWith("//")) return false;
  if (/[*?\[\]{}]/.test(path)) return false;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === ".." || ["node_modules", ".git"].includes(part.toLowerCase()))) return false;
  return mediaKind(path) !== null;
}

export function isAbsoluteMediaPath(path) {
  if (typeof path !== "string" || !path) return false;
  if (path.startsWith("/")) return !path.startsWith("//");
  return WINDOWS_DRIVE.test(path);
}

export function isUsablePath(path) {
  return isMediaPath(path) && isAbsoluteMediaPath(path);
}

function normalizeAbsoluteMediaPath(path) {
  const normalized = path.replace(/\\/g, "/");
  const drive = WINDOWS_DRIVE.test(path);
  const prefix = drive ? `${normalized[0].toUpperCase()}:/` : "/";
  const rest = drive ? normalized.slice(3) : normalized.slice(1);
  const parts = [];
  for (const part of rest.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return prefix + parts.join("/");
}

export function resolveMediaPath(cwd, path) {
  if (!isMediaPath(path)) return "";
  if (isAbsoluteMediaPath(path)) return normalizeAbsoluteMediaPath(path);
  if (!isAbsoluteMediaPath(cwd)) return "";
  const normalized = normalizeAbsoluteMediaPath(`${normalizeAbsoluteMediaPath(cwd).replace(/\/+$/, "")}/${path.replace(/\\/g, "/")}`);
  return isMediaPath(normalized) ? normalized : "";
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
    if (/[$`;&()<\r\n#]/.test(ch)) return [];
    if (ch === "|") {
      if (command[i + 1] === "|") return [];
      if (started) words.push(word);
      words.push("\0|");
      word = ""; started = false; continue;
    }
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
  const match = SAVE_LINE_RE.exec(line) || LABELED_MEDIA_LINE_RE.exec(line);
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
  return SAVE_LINE_RE.test(trimmed) || LABELED_MEDIA_LINE_RE.test(trimmed);
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
  const segments = [[]];
  for (const word of words) {
    if (word === "\0|") segments.push([]);
    else segments.at(-1).push(word);
  }
  for (const segment of segments) {
    for (let i = 0; i < segment.length; i++) if (segment[i] === "\0>") add(segment[i + 1]);
    const name = basename(segment[0] || "");
    const redirected = segment.includes("\0>");
    const output = name === "curl" ? ["-o", "--output"] : name === "wget" ? ["-O", "--output-document"] : null;
    if (output) {
      for (let i = 1; i < segment.length; i++) {
        const word = segment[i];
        if (word === output[0] || word === output[1]) add(segment[i + 1]);
        else if (word.startsWith(`${output[1]}=`)) add(word.slice(output[1].length + 1));
        else if (word.startsWith(output[0]) && word.length > output[0].length) add(word.slice(output[0].length));
      }
    }
    if (["cp", "mv", "install", "ln"].includes(name) && !redirected) {
      // Only no-argument flags are understood. Unknown/argument-taking options
      // (notably -tDIR, -vtDIR and --suffix) make operand counting unreliable.
      const flags = { cp: /^[aRrfivnpPLH]+$/, mv: /^[fivn]+$/, install: /^[svbcD]+$/, ln: /^[sfivnPL]+$/ }[name];
      const operands = [];
      let options = true, reliable = true;
      for (const word of segment.slice(1)) {
        if (options && word === "--") { options = false; continue; }
        if (options && word.startsWith("-")) {
          if (!flags.test(word.slice(1))) { reliable = false; break; }
        } else operands.push(word);
      }
      if (reliable && operands.length >= 2) add(operands.at(-1));
    } else if (name === "tee" && !redirected) {
      let options = true;
      for (const word of segment.slice(1)) {
        if (options && word === "--") { options = false; continue; }
        if (options && (word === "-a" || word === "--append")) continue;
        if (options && word.startsWith("-")) continue;
        add(word);
      }
    } else if (name === "ffmpeg" && !redirected) {
      const input = segment.lastIndexOf("-i");
      if (input >= 0 && input + 1 < segment.length - 1) add(segment.at(-1));
    } else if (["magick", "convert"].includes(name) && !redirected) {
      const operands = segment.slice(1).filter((word) => !word.startsWith("-"));
      const excludedSubcommand = name === "magick" && ["identify", "compare"].includes(String(operands[0] || "").toLowerCase());
      if (!excludedSubcommand && operands.length >= 2) add(operands.at(-1));
    }
  }
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
  return typeof value === "string" && value.trim() ? value : null;
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

export function turnId(event) {
  return event?.data?.turn != null ? String(event.data.turn) : null;
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
    if (!["write", "edit", "present", "bash", "shengcheng", "shengcheng_image", "shengcheng_video", "chrome_screenshot", "huoqu"].includes(name)) return state;
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
    if (event.surfaceOp !== undefined && event.surfaceOp !== "append") return state;
    if (!data.message || data.message.isError !== false || data.error != null) return state;
    if (["write", "edit", "present"].includes(call.name)) return pushItems(state, call.paths, seq, call.name);
    const text = toolResultText(event);
    if (call.name === "bash") {
      if (!successfulBashOutput(text)) return state;
      return pushItems(state, extractSavedMediaPaths(text).concat(call.paths.filter(path => mentionsPath(text, path))), seq, call.name);
    }
    return pushItems(state, extractSavedMediaPaths(text), seq, call.name);
  }
  return state;
}
