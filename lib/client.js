window.__ModuleLoader__.load({
  id: "zhanshi",
  factory: (require) => {
    const React = require("react");
    const inject = ["slots", "uiConversation"];
    const STYLE_ID = "zhanshi-style";
    const MEDIA_EXT = { png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image", mp4: "video", webm: "video", mov: "video", m4v: "video" };
    const SAVE_LINE_RE = /^(?:saved|wrote|written|downloaded|output|已保存|写入)\s+(.+)$/i;
    const SKIP_PATH = /(?:^|\/)(?:node_modules|\.git)(?:\/|$)/;
    const SESSION_DUMP_MARKERS = ['"type":"tool/result"', '"type": "tool/result"', '"type":"tool/call"', '"type": "tool/call"', '"type":"assistant/message"', '"type": "assistant/message"', '"type":"deliverables/presented"', '"type": "deliverables/presented"', "session.v3.jsonl"];
    const cssText = [
      ".zs-gallery { display: flex; flex-direction: column; gap: 10px; margin: 10px 0 6px; max-width: min(100%, 420px); }",
      ".zs-gallery.zs-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: min(100%, 720px); }",
      ".zs-item { margin: 0; min-width: 0; border-radius: 12px; overflow: hidden; background: var(--dsw-alias-bg-layer-1, #f4f4f5); border: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.06)); }",
      ".zs-hit { display: block; width: 100%; padding: 0; border: 0; background: transparent; cursor: pointer; }",
      ".zs-item img, .zs-item video { display: block; width: 100%; height: auto; max-height: min(52vh, 480px); object-fit: contain; background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1)); }",
      ".zs-grid .zs-item img, .zs-grid .zs-item video { max-height: min(36vh, 280px); }",
      ".zs-cap { font-size: 12px; line-height: 1.4; font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", sans-serif); color: var(--dsw-alias-label-secondary, #868e96); padding: 6px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
      ".zs-cap button { border: 0; padding: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }",
      ".zs-error { padding: 10px; font-size: 12px; line-height: 1.5; font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", sans-serif); overflow-wrap: anywhere; color: var(--dsw-alias-label-primary, #1f2937); }",
      ".zs-error p { margin: 0 0 6px; } .zs-error button, .zs-error a { margin-right: 10px; }",
      ".zs-overflow { grid-column: 1 / -1; font-size: 12px; font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", sans-serif); color: var(--dsw-alias-label-secondary, #868e96); }",
    ].join(" ");

    function ensureStyle() {
      let style = document.getElementById(STYLE_ID);
      if (!style) { style = document.createElement("style"); style.id = STYLE_ID; document.head.appendChild(style); }
      style.textContent = cssText;
    }
    function mediaKind(path) {
      const match = typeof path === "string" && /\.([a-z0-9]+)$/i.exec(path.trim());
      return match ? MEDIA_EXT[match[1].toLowerCase()] || null : null;
    }
    function basename(path) {
      if (typeof path !== "string") return "";
      const trimmed = path.replace(/\/+$/, "");
      return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
    }
    function isMediaPath(path) {
      if (typeof path !== "string") return false;
      const trimmed = path.trim();
      return !!trimmed && !/[\u0000-\u001f\u007f]/.test(trimmed) && !trimmed.includes("://")
        && !trimmed.startsWith("//") && !/[*?\[\]{}]/.test(trimmed) && !SKIP_PATH.test(trimmed)
        && !trimmed.split(/[/\\]/).includes("..") && mediaKind(trimmed) !== null;
    }
    function isUsablePath(path) { return isMediaPath(path) && path.trim().startsWith("/"); }
    // Match the tested pure collectors in parse.js. This bundle is intentionally
    // self-contained: the DSH ModuleLoader does not resolve relative ESM imports.
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
      if (!isUsablePath(value)) value = value.replace(/\s+size=\d+$/, "");
      if ((value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) value = value.slice(1, -1);
      return isUsablePath(value) ? value : null;
    }
    function looksLikeSessionDump(text) {
      if (typeof text !== "string" || !text) return false;
      if (SESSION_DUMP_MARKERS.some(marker => text.includes(marker))) return true;
      return text.split(/\r?\n/).filter(line => /^\{ ?"type":/.test(line.trim())).length >= 2;
    }
    function isCleanSaveLine(line) {
      if (!line || /^[{[\"]/.test(line)) return false;
      if (line.includes('"type":') || line.includes('"text":') || line.includes("'type':")) return false;
      if (line.includes("\\n") && /(?:saved|wrote|written|downloaded|output|已保存|写入)\s+\//i.test(line)) return false;
      return SAVE_LINE_RE.test(line);
    }
    function parseArgs(raw) {
      if (typeof raw !== "string" || !raw) return null;
      try { const value = JSON.parse(raw); return value && typeof value === "object" && !Array.isArray(value) ? value : null; }
      catch { return null; }
    }
    function extractSavedMediaPaths(text) {
      if (typeof text !== "string" || !text || looksLikeSessionDump(text)) return [];
      const found = [], seen = new Set();
      const lines = text.split(/\r?\n/);
      const records = lines.filter(line => /^shengcheng_result(?:\s|$)/.test(line));
      // Structured records are authoritative; malformed records cannot fall back.
      if (records.length) {
        for (const line of records) {
          const path = parseArgs(line.slice("shengcheng_result".length))?.path;
          if (typeof path !== "string" || path !== path.trim() || /[\u0000-\u001f\u007f]/.test(path) || !isUsablePath(path) || seen.has(path)) continue;
          seen.add(path); found.push(path);
        }
        return found;
      }
      for (const line of lines) {
        if (!isCleanSaveLine(line.trim())) continue;
        const path = savedLinePath(line.trim());
        if (!isUsablePath(path) || seen.has(path)) continue;
        seen.add(path); found.push(path);
      }
      return found;
    }
    function extractWriteDestinations(command) {
      const words = literalShellWords(command), found = [];
      const add = path => { if (isUsablePath(path) && !found.includes(path)) found.push(path); };
      for (let i = 0; i < words.length; i++) if (words[i] === "\0>") add(words[i + 1]);
      const name = basename(words[0] || "");
      const outputFlags = name === "curl" ? ["-o", "--output"] : name === "wget" ? ["-O", "--output-document"] : [];
      for (let i = 1; i < words.length; i++) if (outputFlags.includes(words[i])) add(words[i + 1]);
      if (["cp", "mv", "install", "ln"].includes(name) && !words.includes("\0>")) {
        // Unknown/argument-taking options make operand counting unreliable.
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
    function pathField(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
    function mediaFromToolCall(name, raw) {
      const args = parseArgs(raw), paths = [];
      if (["write", "edit", "read_image"].includes(name)) {
        const path = pathField(args?.file_path); if (path) paths.push(path);
      } else if (name === "present" && Array.isArray(args?.files)) {
        for (const file of args.files) { const path = pathField(file?.path); if (path) paths.push(path); }
      }
      return paths.filter(isMediaPath);
    }
    function mediaFromPresented(event) {
      return (Array.isArray(event?.data?.files) ? event.data.files : []).map(file => pathField(file?.path)).filter(isMediaPath);
    }
    function mentionsPath(text, path) {
      let offset = -1;
      while ((offset = text.indexOf(path, offset + 1)) >= 0) {
        const before = offset === 0 ? "" : text[offset - 1], after = text[offset + path.length] || "";
        if ((!before || /[\s'"=:]/.test(before)) && (!after || /[\s'"]/.test(after))) return true;
      }
      return false;
    }
    function toolResultText(event) {
      const content = event?.data?.message?.content;
      return Array.isArray(content) ? content.filter(block => block?.type === "text" && typeof block.text === "string").map(block => block.text).join("\n") : "";
    }
    function emptyTurnState(turn) { return { turn: turn || 0, calls: {}, items: [] }; }
    function mediaItem(path, seq, source) {
      return { path, kind: mediaKind(path), seq: typeof seq === "number" ? seq : 0, source, presented: source === "present", name: basename(path) };
    }
    function pushItems(state, paths, seq, source) {
      if (!paths.length) return state;
      const items = state.items.slice(), indices = new Map(items.map((item, index) => [item.path, index]));
      let changed = false;
      for (const path of paths) {
        if (!isMediaPath(path)) continue;
        const next = mediaItem(path, seq, source), index = indices.get(path);
        if (index !== undefined) {
          const prev = items[index];
          next.presented = next.presented || prev.presented;
          next.seq = Math.max(next.seq, prev.seq);
          if (prev.seq === next.seq && prev.source === next.source && prev.presented === next.presented) continue;
          items[index] = next;
        } else { indices.set(path, items.length); items.push(next); }
        changed = true;
      }
      return changed ? { ...state, items } : state;
    }
    function applyTurnEvent(state, event) {
      if (!event || typeof event !== "object") return state;
      const data = event.data || {}, seq = typeof event.seq === "number" ? event.seq : 0;
      if (event.type === "turn/start") return emptyTurnState(data.turn);
      if (event.type === "tool/call") {
        const name = String(data.name || "");
        if (!["write", "edit", "present", "read_image", "bash", "shengcheng", "shengcheng_image", "shengcheng_video", "chrome_screenshot"].includes(name)) return state;
        const paths = name === "bash" ? extractWriteDestinations((parseArgs(data.arguments) || {}).command) : mediaFromToolCall(name, data.arguments);
        return { ...state, calls: { ...state.calls, [String(data.callId || "")]: { name, paths } } };
      }
      if (event.type === "deliverables/presented") return pushItems(state, mediaFromPresented(event), seq, "present");
      if (event.type === "tool/result") {
        const callId = String(data.message?.source?.callId || data.callId || "");
        if (!Object.prototype.hasOwnProperty.call(state.calls, callId)) return state;
        const call = state.calls[callId], calls = { ...state.calls };
        delete calls[callId]; state = { ...state, calls };
        if (!data.message || data.message.isError !== false || data.error != null) return state;
        if (["write", "edit", "present", "read_image"].includes(call.name)) return pushItems(state, call.paths, seq, call.name);
        const text = toolResultText(event);
        if (call.name === "bash") {
          if (/(?:^|\n)\[(?:exit code: (?:-?[1-9]\d*|null)|killed by signal:|timed out after|stopped:|still running after)/.test(text) || looksLikeSessionDump(text)) return state;
          return pushItems(state, extractSavedMediaPaths(text).concat(call.paths.filter(path => mentionsPath(text, path))), seq, call.name);
        }
        return pushItems(state, extractSavedMediaPaths(text), seq, call.name);
      }
      return state;
    }
    function turnId(event) { return event?.data?.turn != null ? String(event.data.turn) : null; }
    function itemsFromDeliverables(data) {
      const items = [];
      for (const source of ["presented", "produced"]) {
        for (const file of Array.isArray(data?.[source]) ? data[source] : []) {
          if (isMediaPath(file?.path)) items.push(mediaItem(file.path, file.seq, source === "presented" ? "present" : "produced"));
        }
      }
      return items;
    }
    function storeGet(turn, key) {
      const data = turn?.data;
      return !data ? undefined : typeof data.get === "function" ? data.get(key) : data[key];
    }
    function resolvePath(cwd, path) {
      if (!isMediaPath(path)) return "";
      const full = path.startsWith("/") ? path : typeof cwd === "string" && cwd.startsWith("/") ? cwd + "/" + path : "";
      if (!full) return "";
      const parts = [];
      for (const part of full.split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") parts.pop(); else parts.push(part);
      }
      const normalized = "/" + parts.join("/");
      return isMediaPath(normalized) ? normalized : "";
    }
    function selectZhanshi(owner, cwd) {
      const local = storeGet(owner?.turn, "zhanshi");
      const all = (Array.isArray(local?.items) ? local.items : []).concat(itemsFromDeliverables(storeGet(owner?.turn, "deliverables")));
      const byPath = new Map();
      for (const item of all) {
        const path = resolvePath(cwd, item?.path);
        if (!path) continue;
        const prev = byPath.get(path), presented = item.presented || item.source === "present" || !!prev?.presented;
        const next = !prev || (item.seq || 0) >= (prev.seq || 0) ? { ...item, path, kind: mediaKind(path), name: basename(path) } : prev;
        byPath.set(path, { ...next, presented });
      }
      const items = [...byPath.values()];
      // Keep ordinary small galleries in chronological order. When capped, select
      // explicit deliverables first and then newest generated media.
      if (items.length <= 16) return { items, overflow: 0 };
      const chosen = items.slice().sort((a, b) => Number(b.presented) - Number(a.presented) || (b.seq || 0) - (a.seq || 0)).slice(0, 16);
      return { items: chosen, overflow: items.length - chosen.length };
    }
    const zhanshiDefinition = {
      kind: "zhanshi",
      match(event) {
        const id = turnId(event);
        if (event?.type === "turn/start" && id) return { id, role: "start" };
        return id && ["tool/call", "tool/result", "deliverables/presented"].includes(event?.type) ? { id, role: "update" } : null;
      },
      start(_context, match) { return emptyTurnState(match.event.data.turn); },
      update(context, match) { return applyTurnEvent(context.state, match.event); },
      buildLocationData(context, scope, previous) {
        const state = context.state;
        if (scope !== "turn" || !state?.items?.length) return null;
        if (previous?.kind === "turn" && previous.key === "zhanshi" && previous.value?.items === state.items) return previous;
        return { kind: "turn", turn: state.turn, key: "zhanshi", value: { items: state.items } };
      },
    };
    function fileUrl(path, kind, rev) {
      if (!path || path[0] !== "/") return "";
      const url = (kind === "video" ? "/api/zhanshi/file" : "/api/file") + "?path=" + encodeURIComponent(path);
      return rev == null || String(rev) === "" ? url : url + "&rev=" + encodeURIComponent(String(rev));
    }
    function MediaCard({ item, openFile }) {
      const [failed, setFailed] = React.useState(false);
      const [attempt, setAttempt] = React.useState(0);
      const baseUrl = fileUrl(item.path, item.kind, item.seq);
      const url = baseUrl + (attempt ? "&retry=" + attempt : "");
      const open = () => { if (typeof openFile === "function") openFile(item.path); };
      const openAction = typeof openFile === "function"
        ? React.createElement("button", { type: "button", onClick: open }, "打开文件")
        : React.createElement("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, "打开文件");
      const mediaProps = { src: url, onError: () => setFailed(true) };
      const media = item.kind === "video"
        ? React.createElement("video", { ...mediaProps, controls: true, preload: "metadata", playsInline: true, onClick: event => event.stopPropagation() })
        : React.createElement("button", { type: "button", className: "zs-hit", title: item.path, onClick: open }, React.createElement("img", { ...mediaProps, alt: item.name }));
      return React.createElement("figure", { className: "zs-item", "data-path": item.path },
        failed ? React.createElement("div", { className: "zs-error", role: "alert" },
          React.createElement("p", null, "预览失败：文件可能已删除、超出预览大小限制或格式不受支持。"),
          React.createElement("p", null, item.path),
          React.createElement("button", { type: "button", onClick: () => { setFailed(false); setAttempt(attempt + 1); } }, "重试"), openAction) : media,
        React.createElement("figcaption", { className: "zs-cap", title: item.path },
          typeof openFile === "function" ? React.createElement("button", { type: "button", onClick: open }, item.name) : React.createElement("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, item.name)));
    }
    function Gallery(props) {
      ensureStyle();
      let cwd = props.cwd;
      if (typeof props.useSessions === "function" && props.sessionId) {
        cwd = props.useSessions(state => state?.byId?.[props.sessionId]?.cwd) || cwd;
      }
      const selection = selectZhanshi(props, cwd);
      if (!selection.items.length) return null;
      return React.createElement("div", { className: selection.items.length > 1 ? "zs-gallery zs-grid" : "zs-gallery", "data-zhanshi": "media" },
        selection.items.map(item => React.createElement(MediaCard, { key: item.path + ":" + String(item.seq ?? ""), item, openFile: props.openFile })),
        selection.overflow ? React.createElement("div", { className: "zs-overflow", role: "status" }, "另有 " + selection.overflow + " 项媒体未预览（最多显示 16 项，优先显示交付文件）。") : null);
    }
    function apply(ctx) {
      ensureStyle();
      ctx.uiConversation.events.register(zhanshiDefinition);
      ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({ name: "conversation.chat.turnTail", id: "zhanshi", priority: -20 }, Gallery));
    }
    return { apply, inject };
  },
});
