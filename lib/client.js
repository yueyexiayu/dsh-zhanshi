window.__ModuleLoader__.load({
  id: "zhanshi",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");

    var inject = ["slots", "uiConversation"];
    var STYLE_ID = "zhanshi-style";

    var MEDIA_EXT = {
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
    var ABS_MEDIA_RE = /(^|[\s"'=\`:,])(\/[^\s"'<>]+?\.(?:png|jpe?g|webp|gif|mp4|webm|mov|m4v))\b/gi;
    var SAVE_LINE_RE = /^(?:saved|wrote|written|downloaded|output|已保存|写入)\s+(\/[^\s"'<>]+?\.(?:png|jpe?g|webp|gif|mp4|webm|mov|m4v))\b/i;
    var SKIP_PATH = /(?:^|\/)(?:node_modules|\.git)(?:\/|$)/;
    var SESSION_DUMP_MARKERS = [
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
    var WRITE_REDIR_RE = /(?:>>?)\s*(\/[^\s"'<>]+?\.(?:png|jpe?g|webp|gif|mp4|webm|mov|m4v))\b/gi;
    var WRITE_DASH_O_RE = /(?:^|[\s])(?:-o|--output|--out|--outfile)\s+(\/[^\s"'<>]+?\.(?:png|jpe?g|webp|gif|mp4|webm|mov|m4v))\b/gi;
    var COPY_MOVE_RE = /(?:^|[;&|\n]\s*)(?:cp|mv|install|ln|ffmpeg|magick|convert)\b/;

    var cssText = [
      ".zs-gallery { display: flex; flex-direction: column; gap: 10px; margin: 10px 0 6px; max-width: min(100%, 420px); }",
      ".zs-gallery.zs-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: min(100%, 720px); }",
      ".zs-item { margin: 0; border-radius: 12px; overflow: hidden; background: var(--dsw-alias-bg-layer-1, #f4f4f5); border: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.06)); }",
      ".zs-hit { display: block; width: 100%; padding: 0; border: 0; background: transparent; cursor: pointer; }",
      ".zs-item img, .zs-item video { display: block; width: 100%; height: auto; max-height: min(52vh, 480px); object-fit: contain; background: #111; }",
      ".zs-grid .zs-item img, .zs-grid .zs-item video { max-height: min(36vh, 280px); }",
      ".zs-cap { font-size: 11px; line-height: 1.4; color: var(--dsw-alias-label-secondary, #868e96); padding: 6px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }",
    ].join(" ");

    function ensureStyle() {
      var existing = document.getElementById(STYLE_ID);
      if (existing) {
        existing.textContent = cssText;
        return;
      }
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = cssText;
      document.head.appendChild(style);
    }

    function mediaKind(path) {
      if (typeof path !== "string") return null;
      var match = /\.([a-z0-9]+)$/i.exec(path.trim());
      if (!match) return null;
      return MEDIA_EXT[match[1].toLowerCase()] || null;
    }

    function basename(path) {
      if (typeof path !== "string") return "";
      var trimmed = path.replace(/\/+$/, "");
      var index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
      return index >= 0 ? trimmed.slice(index + 1) : trimmed;
    }

    function isMediaPath(path) {
      if (typeof path !== "string") return false;
      var trimmed = path.trim();
      if (!trimmed) return false;
      if (trimmed.indexOf("\0") >= 0 || trimmed.indexOf("://") >= 0) return false;
      if (trimmed.slice(0, 2) === "//") return false;
      if (/[*?\[\]{}]/.test(trimmed)) return false;
      if (SKIP_PATH.test(trimmed)) return false;
      if (trimmed.split(/[/\\]/).indexOf("..") >= 0) return false;
      return mediaKind(trimmed) !== null;
    }

    function isUsablePath(path) {
      return isMediaPath(path) && path.trim().charAt(0) === "/";
    }

    function collect(regex, text, group) {
      if (typeof text !== "string" || !text) return [];
      var found = [];
      var seen = {};
      regex.lastIndex = 0;
      var match;
      while ((match = regex.exec(text)) !== null) {
        var path = match[group];
        if (!isUsablePath(path) || seen[path]) continue;
        seen[path] = true;
        found.push(path);
      }
      return found;
    }

    function looksLikeSessionDump(text) {
      if (typeof text !== "string" || !text) return false;
      for (var m = 0; m < SESSION_DUMP_MARKERS.length; m++) {
        if (text.indexOf(SESSION_DUMP_MARKERS[m]) >= 0) return true;
      }
      var jsonl = 0;
      var lines = text.split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        var trimmed = lines[i].trim();
        if (trimmed.indexOf('{"type":') === 0 || trimmed.indexOf('{ "type":') === 0) {
          jsonl += 1;
          if (jsonl >= 2) return true;
        }
      }
      return false;
    }

    function isCleanSaveLine(trimmed) {
      if (!trimmed) return false;
      var first = trimmed.charAt(0);
      if (first === "{" || first === "[" || first === '"') return false;
      if (trimmed.indexOf('"type":') >= 0 || trimmed.indexOf('"text":') >= 0 || trimmed.indexOf("'type':") >= 0) {
        return false;
      }
      if (trimmed.indexOf("\\n") >= 0 && /(?:saved|wrote|written|downloaded|output|已保存|写入)\s+\//i.test(trimmed)) {
        return false;
      }
      return SAVE_LINE_RE.test(trimmed);
    }

    function extractSavedMediaPaths(text) {
      if (typeof text !== "string" || !text) return [];
      var found = [];
      var seen = {};
      var lines = text.split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        var trimmed = lines[i].trim();
        if (!isCleanSaveLine(trimmed)) continue;
        var match = SAVE_LINE_RE.exec(trimmed);
        if (!match) continue;
        var path = match[1];
        if (!isUsablePath(path) || seen[path]) continue;
        seen[path] = true;
        found.push(path);
      }
      return found;
    }

    function extractWriteDestinations(command) {
      if (typeof command !== "string" || !command) return [];
      var found = [];
      var seen = {};
      function add(path) {
        if (!isUsablePath(path) || seen[path]) return;
        seen[path] = true;
        found.push(path);
      }
      var regexes = [WRITE_REDIR_RE, WRITE_DASH_O_RE];
      for (var r = 0; r < regexes.length; r++) {
        regexes[r].lastIndex = 0;
        var match;
        while ((match = regexes[r].exec(command)) !== null) add(match[1]);
      }
      if (COPY_MOVE_RE.test(command)) {
        var paths = extractMediaPaths(command);
        if (paths.length) add(paths[paths.length - 1]);
      }
      return found;
    }

    function extractMediaPaths(text) {
      return collect(ABS_MEDIA_RE, text, 2);
    }

    function toolResultText(event) {
      var content = event && event.data && event.data.message && event.data.message.content;
      var parts = [];
      function walk(nodes) {
        if (!Array.isArray(nodes)) return;
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i];
          if (!node || typeof node !== "object") continue;
          if (typeof node.text === "string") parts.push(node.text);
          if (Array.isArray(node.content)) walk(node.content);
        }
      }
      walk(content);
      return parts.join("\n");
    }

    function parseArgs(raw) {
      if (typeof raw !== "string" || !raw) return null;
      try {
        var value = JSON.parse(raw);
        return value && typeof value === "object" && !Array.isArray(value) ? value : null;
      } catch (error) {
        return null;
      }
    }

    function pathField(value) {
      return typeof value === "string" && value.trim() ? value.trim() : null;
    }

    function mediaFromToolCall(name, argsRaw) {
      var args = parseArgs(argsRaw);
      var paths = [];
      if (name === "write" || name === "edit") {
        var path = args ? pathField(args.file_path) : null;
        if (path) paths.push(path);
      } else if (name === "present" && args && Array.isArray(args.files)) {
        for (var i = 0; i < args.files.length; i++) {
          var filePath = args.files[i] && pathField(args.files[i].path);
          if (filePath) paths.push(filePath);
        }
      } else if (name === "read_image") {
        var readPath = args ? pathField(args.file_path) : null;
        if (readPath) paths.push(readPath);
      } else if (name === "bash") {
        var command = args ? pathField(args.command) : null;
        if (command) paths = paths.concat(extractMediaPaths(command));
      }
      return paths.filter(name === "bash" ? isUsablePath : isMediaPath);
    }

    function mediaFromPresented(event) {
      var files = event && event.data && event.data.files;
      if (!Array.isArray(files)) return [];
      var paths = [];
      for (var i = 0; i < files.length; i++) {
        var path = files[i] && pathField(files[i].path);
        if (path && isMediaPath(path)) paths.push(path);
      }
      return paths;
    }

    function bashMediaPaths(argsRaw, resultText) {
      if (looksLikeSessionDump(resultText)) return [];
      var command = String((parseArgs(argsRaw) || {}).command || "");
      var fromSaved = extractSavedMediaPaths(resultText);
      var dest = extractWriteDestinations(command);
      var fromDest = [];
      for (var d = 0; d < dest.length; d++) {
        if (resultText.indexOf(dest[d]) >= 0) fromDest.push(dest[d]);
      }
      var seen = {};
      var paths = [];
      var all = fromSaved.concat(fromDest);
      for (var i = 0; i < all.length; i++) {
        var path = all[i];
        if (!isUsablePath(path) || seen[path]) continue;
        seen[path] = true;
        paths.push(path);
      }
      return paths;
    }

    function emptyTurnState(turn) {
      return { turn: turn || 0, calls: {}, items: [] };
    }

    function pushItems(state, paths, seq, source) {
      if (!paths.length) return state;
      var changed = false;
      var items = state.items.slice();
      var seen = {};
      for (var i = 0; i < items.length; i++) seen[items[i].path] = true;
      for (var j = 0; j < paths.length; j++) {
        var path = paths[j];
        if (!isMediaPath(path) || seen[path] || items.length >= 16) continue;
        seen[path] = true;
        items.push({
          path: path,
          kind: mediaKind(path),
          seq: seq,
          source: source,
          name: basename(path),
        });
        changed = true;
      }
      if (!changed) return state;
      return { turn: state.turn, calls: state.calls, items: items };
    }

    function applyTurnEvent(state, event) {
      if (!event || typeof event !== "object") return state;
      var type = event.type;
      var data = event.data || {};
      var seq = typeof event.seq === "number" ? event.seq : 0;
      if (type === "turn/start") return emptyTurnState(data.turn);
      if (type === "tool/call") {
        var callId = String(data.callId || "");
        var calls = {};
        for (var key in state.calls) {
          if (Object.prototype.hasOwnProperty.call(state.calls, key)) calls[key] = state.calls[key];
        }
        calls[callId] = { name: String(data.name || ""), argsRaw: String(data.arguments || "") };
        return { turn: state.turn, calls: calls, items: state.items };
      }
      if (type === "deliverables/presented") {
        return pushItems(state, mediaFromPresented(event), seq, "present");
      }
      if (type === "tool/result") {
        var block = Array.isArray(data.message && data.message.content) ? data.message.content[0] : null;
        if (block && block.isError === true) return state;
        var resultCallId = String((data.message && data.message.source && data.message.source.callId) || "");
        var call = state.calls[resultCallId];
        if (!call) return state;
        if (call.name === "write" || call.name === "edit" || call.name === "present" || call.name === "read_image") {
          return pushItems(state, mediaFromToolCall(call.name, call.argsRaw), seq, call.name);
        }
        if (call.name === "bash") {
          return pushItems(state, bashMediaPaths(call.argsRaw, toolResultText(event)), seq, "bash");
        }
      }
      return state;
    }

    function lastTextAssistantSeq(matches) {
      var seq;
      if (!Array.isArray(matches)) return seq;
      for (var i = 0; i < matches.length; i++) {
        var event = matches[i] && matches[i].event;
        if (!event || event.type !== "assistant/message") continue;
        var content = event.data && event.data.message && event.data.message.content;
        if (!Array.isArray(content)) continue;
        var hasText = false;
        for (var j = 0; j < content.length; j++) {
          var block = content[j];
          if (block && block.type === "text" && String(block.text || "").trim()) hasText = true;
        }
        if (hasText && typeof event.seq === "number") seq = event.seq;
      }
      return seq;
    }

    function galleryAnchorSeq(state, matches) {
      var items = state && Array.isArray(state.items) ? state.items : [];
      var last = items[items.length - 1];
      var anchor = last ? last.seq + 0.02 : 0;
      var assistantSeq = lastTextAssistantSeq(matches);
      if (typeof assistantSeq === "number") anchor = assistantSeq + 0.02;
      return anchor;
    }

    function turnId(event) {
      return event && event.data && event.data.turn != null ? String(event.data.turn) : null;
    }

    function itemsFromDeliverables(data) {
      var items = [];
      var seen = {};
      function add(path, seq, source) {
        if (!isMediaPath(path) || seen[path] || items.length >= 16) return;
        seen[path] = true;
        items.push({
          path: path,
          kind: mediaKind(path),
          seq: typeof seq === "number" ? seq : 0,
          source: source,
          name: basename(path),
        });
      }
      var presented = data && Array.isArray(data.presented) ? data.presented : [];
      var produced = data && Array.isArray(data.produced) ? data.produced : [];
      for (var i = 0; i < presented.length; i++) add(presented[i] && presented[i].path, presented[i] && presented[i].seq, "present");
      for (var j = 0; j < produced.length; j++) add(produced[j] && produced[j].path, produced[j] && produced[j].seq, "produced");
      return items;
    }

    function mergeMediaItems(primary, secondary) {
      var items = [];
      var seen = {};
      var all = (primary || []).concat(secondary || []);
      for (var i = 0; i < all.length; i++) {
        var item = all[i];
        if (!item || !isMediaPath(item.path) || seen[item.path] || items.length >= 16) continue;
        seen[item.path] = true;
        items.push(item);
      }
      return items;
    }

    function uniquePreviewItems(items) {
      var list = [];
      if (!Array.isArray(items)) return list;
      for (var i = 0; i < items.length; i++) {
        if (items[i] && isMediaPath(items[i].path)) list.push(items[i]);
      }
      var presented = list.filter(function (item) { return item.source === "present"; });
      var pool = presented.length ? presented : list;
      var videos = pool.filter(function (item) { return mediaKind(item.path) === "video"; });
      var chosen = videos.length ? videos : pool;
      var out = [];
      var seen = {};
      for (var j = 0; j < chosen.length; j++) {
        var key = basename(chosen[j].path).toLowerCase();
        if (!key || seen[key]) continue;
        seen[key] = true;
        out.push(chosen[j]);
        if (out.length >= 16) break;
      }
      return out;
    }

    function storeGet(turn, key) {
      var data = turn && turn.data;
      if (!data) return undefined;
      if (typeof data.get === "function") return data.get(key);
      return data[key];
    }

    function selectZhanshi(owner) {
      try {
        var fromPlugin = storeGet(owner && owner.turn, "zhanshi");
        var fromDeliverables = itemsFromDeliverables(storeGet(owner && owner.turn, "deliverables") || {});
        var items = uniquePreviewItems(mergeMediaItems(fromPlugin && fromPlugin.items, fromDeliverables));
        return items.length ? items : null;
      } catch (error) {
        return null;
      }
    }

    var zhanshiDefinition = {
      kind: "zhanshi",
      match: function (event) {
        if (!event) return null;
        var id = turnId(event);
        if (event.type === "turn/start" && id) return { id: id, role: "start" };
        if (
          (event.type === "tool/call" ||
            event.type === "tool/result" ||
            event.type === "deliverables/presented") &&
          id
        ) {
          return { id: id, role: "update" };
        }
        return null;
      },
      start: function (_context, match) {
        return emptyTurnState(match.event.data.turn);
      },
      update: function (context, match) {
        return applyTurnEvent(context.state, match.event);
      },
      buildLocationData: function (context, scope, previous) {
        var state = context.state;
        if (scope !== "turn" || !state || !state.items || !state.items.length) return null;
        if (
          previous &&
          previous.kind === "turn" &&
          previous.key === "zhanshi" &&
          previous.value &&
          previous.value.items === state.items
        ) {
          return previous;
        }
        return {
          kind: "turn",
          turn: state.turn,
          key: "zhanshi",
          value: { items: state.items },
        };
      },
    };

    function fileUrl(path, kind) {
      if (!path || path.charAt(0) !== "/") return "";
      var api = kind === "video" ? "/api/zhanshi/file" : "/api/file";
      return api + "?path=" + encodeURIComponent(path);
    }

    function resolvePath(cwd, path) {
      if (!path) return "";
      if (path.charAt(0) === "/") return path;
      if (!cwd) return "";
      return String(cwd).replace(/\/+$/, "") + "/" + String(path).replace(/^\/+/, "");
    }

    function Gallery(props) {
      ensureStyle();
      var cwd = props.cwd;
      if (typeof props.useSessions === "function" && props.sessionId) {
        cwd = props.useSessions(function (state) {
          var row = state && state.byId && state.byId[props.sessionId];
          return row && row.cwd;
        }) || cwd;
      }
      var rawItems = Array.isArray(props.matched)
        ? props.matched
        : ((props.node && props.node.data && props.node.data.items) || []);
      var items = uniquePreviewItems(rawItems);
      var resolved = [];
      for (var i = 0; i < items.length; i++) {
        var item = items[i] || {};
        var path = resolvePath(cwd, item.path);
        if (!path || path.charAt(0) !== "/") continue;
        resolved.push({
          path: path,
          kind: item.kind || mediaKind(path),
          name: item.name || basename(path),
        });
      }
      if (!resolved.length) return null;
      var many = resolved.length > 1;
      var openFile = props.openFile;
      return React.createElement(
        "div",
        { className: many ? "zs-gallery zs-grid" : "zs-gallery", "data-zhanshi": "media" },
        resolved.map(function (item) {
          var url = fileUrl(item.path, item.kind);
          var open = function () {
            if (typeof openFile === "function") openFile(item.path);
          };
          var media =
            item.kind === "video"
              ? React.createElement("video", {
                  src: url || undefined,
                  controls: true,
                  preload: "auto",
                  playsInline: true,
                  onClick: function (event) {
                    event.stopPropagation();
                  },
                })
              : React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "zs-hit",
                    title: item.path,
                    onClick: open,
                  },
                  React.createElement("img", {
                    src: url || undefined,
                    alt: item.name,
                    onError: function (event) {
                      var el = event && event.currentTarget;
                      var card = el && el.closest && el.closest(".zs-item");
                      if (card) card.style.display = "none";
                      else if (el) el.style.display = "none";
                    },
                  }),
                );
          return React.createElement(
            "figure",
            { key: item.path, className: "zs-item" },
            media,
            React.createElement(
              "figcaption",
              { className: "zs-cap", title: item.path, onClick: open },
              item.name,
            ),
          );
        }),
      );
    }

    function apply(ctx) {
      ensureStyle();
      ctx.uiConversation.events.register(zhanshiDefinition);
      ctx.slots.inject("conversation.chat.turnTail", function () {
        return ctx.slots.register(
          {
            name: "conversation.chat.turnTail",
            select: selectZhanshi,
            priority: -20,
          },
          Gallery,
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
