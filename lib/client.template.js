window.__ModuleLoader__.load({
  id: "zhanshi",
  factory: (require) => {
    const React = require("react");
    const inject = ["slots", "uiConversation"];
    const STYLE_ID = "zhanshi-style";
    const cssText = [
      ".zs-gallery { display: flex; flex-direction: column; gap: 10px; margin: 10px 0 6px; max-width: min(100%, 420px); }",
      ".zs-gallery.zs-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: min(100%, 720px); }",
      ".zs-item { margin: 0; min-width: 0; border-radius: 12px; overflow: hidden; background: var(--dsw-alias-bg-layer-1, #f4f4f5); border: 1px solid var(--dsw-alias-border-l3, rgba(0,0,0,0.06)); }",
      ".zs-hit { display: block; width: 100%; padding: 0; border: 0; background: transparent; cursor: pointer; }",
      ".zs-hit:hover { filter: brightness(.96); } .zs-hit:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #0a84ff); outline-offset: -3px; border-radius: 11px; }",
      ".zs-item img, .zs-item video { display: block; width: 100%; height: auto; max-height: min(52vh, 480px); object-fit: contain; background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1)); }",
      ".zs-grid .zs-item img, .zs-grid .zs-item video { max-height: min(36vh, 280px); }",
      ".zs-cap { font-size: 12px; line-height: 1.4; font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", sans-serif); color: var(--dsw-alias-label-secondary, #868e96); padding: 6px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
      ".zs-cap button { border: 0; padding: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }",
      ".zs-cap button:hover { color: var(--dsw-alias-state-business-primary, #0a84ff); } .zs-cap button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #0a84ff); outline-offset: 2px; border-radius: 3px; }",
      ".zs-error { padding: 10px; font-size: 12px; line-height: 1.5; font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", sans-serif); overflow-wrap: anywhere; color: var(--dsw-alias-label-primary, #1f2937); }",
      ".zs-error p { margin: 0 0 8px; } .zs-error button, .zs-error a { display: inline-flex; align-items: center; margin-right: 8px; padding: 5px 10px; border: 1px solid var(--dsw-alias-border-l4, #c6c6c8); border-radius: 7px; background: var(--dsw-alias-bg-layer-1, #f4f4f5); color: var(--dsw-alias-label-primary, #1f2937); font: inherit; text-decoration: none; cursor: pointer; }",
      ".zs-error button:hover, .zs-error a:hover { border-color: var(--dsw-alias-state-business-primary, #0a84ff); color: var(--dsw-alias-state-business-primary, #0a84ff); } .zs-error button:focus-visible, .zs-error a:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #0a84ff); outline-offset: 2px; }",
      ".zs-overflow { grid-column: 1 / -1; font-size: 12px; font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"Segoe UI\", sans-serif); color: var(--dsw-alias-label-secondary, #868e96); }"
    ].join(" ");

    /*__ZHANSHI_CORE__*/

    function ensureStyle() {
      let style = document.getElementById(STYLE_ID);
      if (!style) { style = document.createElement("style"); style.id = STYLE_ID; document.head.appendChild(style); }
      style.textContent = cssText;
    }
    function itemsFromDeliverables(data) {
      const produced = (Array.isArray(data?.produced) ? data.produced : [])
        .filter(file => isMediaPath(file?.path))
        .map(file => ({ ...mediaItem(file.path, file.seq, "produced"), official: true, ...file.argumentPath ? { argumentPath: file.argumentPath } : {} }));
      const presented = (Array.isArray(data?.presented) ? data.presented : [])
        .filter(file => isMediaPath(file?.path))
        .map(file => ({ ...mediaItem(file.path, file.seq, "present"), official: true }));
      return produced.concat(presented);
    }
    function storeGet(turn, key) {
      const data = turn?.data;
      return !data ? undefined : typeof data.get === "function" ? data.get(key) : data[key];
    }
    function pathKey(path) { return WINDOWS_DRIVE.test(path) ? path.toLowerCase() : path; }
    function selectZhanshi(owner, cwd) {
      const local = storeGet(owner?.turn, "zhanshi"), deliverables = storeGet(owner?.turn, "deliverables");
      const all = (Array.isArray(local?.items) ? local.items : []).concat(itemsFromDeliverables(deliverables));
      const aliases = new Map();
      for (const item of all) {
        const canonical = resolveMediaPath(cwd, item?.path), argument = resolveMediaPath(cwd, item?.argumentPath);
        if (canonical && argument) aliases.set(pathKey(argument), canonical);
      }
      const byPath = new Map();
      for (const item of all) {
        const resolved = resolveMediaPath(cwd, item?.path), path = aliases.get(pathKey(resolved)) || resolved;
        if (!path || item.source === "read_image") continue;
        const key = pathKey(path), prev = byPath.get(key), presented = item.presented || item.source === "present" || !!prev?.presented;
        const next = !prev || (item.seq || 0) >= (prev.seq || 0) ? { ...item, path, kind: mediaKind(path), name: basename(path) } : prev;
        byPath.set(key, { ...next, presented });
      }
      const items = [...byPath.values()];
      if (items.length <= 16) return { items, overflow: 0 };
      const chosen = items.slice().sort((a, b) => Number(b.presented) - Number(a.presented) || (b.seq || 0) - (a.seq || 0)).slice(0, 16);
      return { items: chosen, overflow: items.length - chosen.length };
    }
    const zhanshiDefinition = {
      kind: "zhanshi",
      match(event) {
        const id = turnId(event);
        if (event?.type === "turn/start" && id) return { id, role: "start" };
        if (event?.type === "tool/result" && event.surfaceOp !== undefined && event.surfaceOp !== "append") return id ? { id, role: "update" } : null;
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
    function fileUrl(path) {
      if (!isAbsoluteMediaPath(path)) return "";
      return "/api/zhanshi/file?path=" + encodeURIComponent(path);
    }
    function MediaCard({ item, openFile }) {
      const [failed, setFailed] = React.useState(false);
      const [attempt, setAttempt] = React.useState(0);
      const [large, setLarge] = React.useState(null);
      const url = fileUrl(item.path) + (attempt ? "&retry=" + attempt : "");
      React.useEffect(() => {
        const cancellation = new AbortController();
        fetch(url, { method: "HEAD", signal: cancellation.signal }).then(response => {
          if (cancellation.signal.aborted) return;
          if (response.status === 413 && response.headers.get("x-zhanshi-preview") === "open-file") {
            setLarge({ bytes: Number(response.headers.get("x-zhanshi-file-size")) || 0, limit: Number(response.headers.get("x-zhanshi-preview-limit")) || 64 * 1048576 });
          } else if (response.status === 413) setFailed("预览检查失败：文件超过预览上限（HTTP 413）");
          else if (!response.ok) setFailed("预览检查失败：HTTP " + response.status);
        }).catch(() => { if (!cancellation.signal.aborted) setFailed("预览检查失败：无法读取文件服务"); });
        return () => cancellation.abort();
      }, [url]);
      const open = () => { if (typeof openFile === "function") openFile(item.path); };
      const openAction = typeof openFile === "function"
        ? React.createElement("button", { type: "button", onClick: open }, "打开文件")
        : React.createElement("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, "打开文件");
      const mediaProps = { src: url, onError: () => setFailed(true), referrerPolicy: "no-referrer" };
      const image = React.createElement("img", { ...mediaProps, alt: item.name, loading: "lazy", decoding: "async" });
      const media = item.kind === "video"
        ? React.createElement("video", { ...mediaProps, controls: true, preload: "metadata", playsInline: true, onClick: event => event.stopPropagation() })
        : typeof openFile === "function"
          ? React.createElement("button", { type: "button", className: "zs-hit", title: item.path, onClick: open }, image)
          : React.createElement("a", { className: "zs-hit", href: url, target: "_blank", rel: "noopener noreferrer", title: item.path }, image);
      return React.createElement("figure", { className: "zs-item", "data-path": item.path },
        large ? React.createElement("div", { className: "zs-error", role: "status" },
          React.createElement("p", null, (item.kind === "video" ? "视频" : "图片") + "已保存（" + Math.ceil(large.bytes / 1048576) + " MiB），超过 " + Math.ceil(large.limit / 1048576) + " MiB 预览上限，请打开文件查看。"),
          React.createElement("p", null, item.path),
          React.createElement("button", { type: "button", onClick: () => { setLarge(null); setFailed(false); setAttempt(attempt + 1); } }, "重试"), openAction)
        : failed ? React.createElement("div", { className: "zs-error", role: "alert" },
          React.createElement("p", null, typeof failed === "string" ? failed : "预览失败：文件可能已删除或格式不受支持。"),
          React.createElement("p", null, item.path),
          React.createElement("button", { type: "button", onClick: () => { setFailed(false); setLarge(null); setAttempt(attempt + 1); } }, "重试"), openAction) : media,
        React.createElement("figcaption", { className: "zs-cap", title: item.path },
          typeof openFile === "function" ? React.createElement("button", { type: "button", onClick: open }, item.name) : React.createElement("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, item.name)));
    }
    function Gallery(props) {
      let cwd = props.cwd;
      if (typeof props.useSessions === "function" && props.sessionId) cwd = props.useSessions(state => state?.byId?.[props.sessionId]?.cwd) || cwd;
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
