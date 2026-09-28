// Runs in the page (MAIN world) so it can see the Space's chat websocket.
// Read-only: it never sends anything into the Space. Events are handed to bridge.js via postMessage.
(function () {
  "use strict";
  if (window.__hoodwatch) return;

  const TAG = "__hoodwatch__";
  const state = { room: null, connected: false, count: 0, listeners: null, feed: [], board: new Map(), sync: "idle", min: false, tab: "feed" };

  const safe = (t) => { if (t && typeof t === "object") return t; try { return JSON.parse(t); } catch { return null; } };

  function parse(raw) {
    const msg = safe(raw);
    if (!msg || !msg.payload) return null;
    const payload = safe(msg.payload);
    if (!payload || !payload.body) return null;
    const body = safe(payload.body);
    if (!body) return null;
    if (body.type === 2 && body.body) {
      const s = payload.sender || {};
      return { kind: "reaction", r: {
        ts: Date.now(),
        emoji: String(body.body).slice(0, 32),
        username: s.username || body.username || null,
        displayName: s.display_name || body.displayName || null,
        userId: s.twitter_id || s.user_id || body.remoteID || null,
      } };
    }
    if (typeof body.occupancy === "number") {
      return { kind: "occupancy", o: { ts: Date.now(), listeners: body.occupancy, total: body.total_participants || null } };
    }
    return null;
  }

  function roomFrom(data) {
    const m = safe(data); const p = m && safe(m.payload); const b = p && safe(p.body);
    return (b && b.room) || null;
  }

  function spaceTitle() {
    const t = document.title || "";
    const m = t.match(/^(?:\(\d+\)\s*)?(.+?)\s*(?:\/\s*X|on X)?$/);
    const guess = m ? m[1].trim() : "";
    return guess && !/^(X|Home|Twitter)$/i.test(guess) ? guess.slice(0, 200) : null;
  }

  const post = (type, data) => window.postMessage({ [TAG]: true, dir: "out", type, data }, "*");

  // --- websocket hook ---
  const Native = window.WebSocket;
  function Patched(url, protocols) {
    const ws = protocols !== undefined ? new Native(url, protocols) : new Native(url);
    if (String(url).includes("/chatapi/v1/chatnow")) hook(ws);
    return ws;
  }
  Patched.prototype = Native.prototype;
  ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach((k) => (Patched[k] = Native[k]));
  window.WebSocket = Patched;

  function hook(ws) {
    const origSend = ws.send;
    ws.send = function (data) {
      const r = typeof data === "string" && roomFrom(data);
      if (r && r !== state.room) {
        state.room = r; state.count = 0; state.feed = []; state.board = new Map(); state.listeners = null;
        post("join", { room: r, title: spaceTitle() });
        render();
      }
      return origSend.apply(this, arguments);
    };
    ws.addEventListener("open", () => { state.connected = true; ui(); render(); });
    ws.addEventListener("close", () => {
      state.connected = false;
      if (state.room) post("leave", { room: state.room });
      render();
    });
    ws.addEventListener("message", (e) => {
      if (typeof e.data !== "string" || !state.room) return;
      const ev = parse(e.data);
      if (!ev) return;
      if (ev.kind === "reaction") {
        post("reaction", { room: state.room, ...ev.r });
        state.count++;
        state.feed.unshift(ev.r); if (state.feed.length > 150) state.feed.pop();
        const key = ev.r.username || ev.r.userId || ev.r.displayName || "unknown";
        const b = state.board.get(key) || { ...ev.r, total: 0 }; b.total++; state.board.set(key, b);
      } else {
        post("occupancy", { room: state.room, ...ev.o });
        state.listeners = ev.o.listeners;
      }
      render();
    });
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || !e.data[TAG] || e.data.dir !== "in") return;
    if (e.data.type === "sync") { state.sync = e.data.data; render(); }
  });

  // --- panel (plain DOM; x.com enforces Trusted Types so no innerHTML) ---
  let root, bodyEl, statusEl, syncEl;
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (k === "style") Object.assign(el.style, v);
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  }
  const btn = (label, onclick, active) => h("button", { onclick, style: {
    background: active ? "#c6ff3d" : "#1b1b21", color: active ? "#0b0b0d" : "#ededf0", border: "1px solid #26262e",
    borderRadius: "7px", padding: "3px 9px", fontSize: "11px", fontWeight: "600", cursor: "pointer", marginRight: "4px",
  } }, label);

  function ui() {
    if (root) return;
    if (!document.body) { document.addEventListener("DOMContentLoaded", ui, { once: true }); return; }
    statusEl = h("span", { style: { color: "#8b8b96", fontSize: "11px" } });
    syncEl = h("div", { style: { fontSize: "11px", marginTop: "6px" } });
    bodyEl = h("div", { style: { maxHeight: "300px", overflowY: "auto", marginTop: "6px" } });
    root = h("div", { style: {
      position: "fixed", left: "12px", bottom: "12px", zIndex: 2147483647, width: "310px",
      background: "rgba(11,11,13,.96)", color: "#ededf0", font: "12px/1.4 system-ui, sans-serif",
      border: "1px solid #26262e", borderRadius: "12px", padding: "10px 12px", boxShadow: "0 10px 40px rgba(0,0,0,.6)",
    } });
    render();
    document.body.appendChild(root);
  }

  function render() {
    if (!root) return;
    root.replaceChildren(
      h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
        h("strong", { style: { fontSize: "13px" } }, "hood", h("span", { style: { color: "#c6ff3d" } }, "watch")),
        statusEl,
        h("span", { style: { marginLeft: "auto" } }, btn(state.min ? "+" : "–", () => { state.min = !state.min; render(); }))),
      syncEl,
    );
    statusEl.textContent = `${state.connected ? "● live" : "○ idle"} · ${state.count} reactions${state.listeners != null ? ` · ${state.listeners} listening` : ""}`;
    statusEl.style.color = state.connected ? "#c6ff3d" : "#8b8b96";

    const s = state.sync;
    syncEl.textContent =
      s === "ok" ? "✓ syncing to your dashboard" :
      s === "nokey" ? "⚠ add your Hoodwatch key — click the extension icon" :
      s === "badkey" ? "⚠ key rejected — generate a new one in your dashboard" :
      s === "error" ? "⚠ sync hiccup — retrying" : "";
    syncEl.style.color = s === "ok" ? "#8b8b96" : "#ff4d6d";

    if (state.min) return;
    root.append(h("div", { style: { marginTop: "8px" } },
      btn("Feed", () => { state.tab = "feed"; render(); }, state.tab === "feed"),
      btn("Top", () => { state.tab = "top"; render(); }, state.tab === "top")), bodyEl);
    bodyEl.replaceChildren();
    const row = (kids) => h("div", { style: { padding: "3px 0", borderBottom: "1px solid #1b1b21", display: "flex", gap: "6px", alignItems: "center" } }, kids);
    const who = (u) => u.username
      ? h("a", { href: `https://x.com/${u.username}`, target: "_blank", style: { color: "#ededf0", textDecoration: "none" } },
          u.displayName || u.username, h("span", { style: { color: "#8b8b96" } }, ` @${u.username}`))
      : h("span", null, u.displayName || u.userId || "unknown");
    if (state.tab === "feed") {
      if (!state.feed.length) bodyEl.append(h("div", { style: { color: "#8b8b96" } }, state.room ? "Waiting for reactions…" : "Join a Space to start."));
      state.feed.forEach((r) => bodyEl.append(row([h("span", { style: { fontSize: "15px" } }, r.emoji), who(r)])));
    } else {
      [...state.board.values()].sort((a, b) => b.total - a.total).slice(0, 50).forEach((u, i) =>
        bodyEl.append(row([h("span", { style: { color: "#8b8b96", width: "22px" } }, `#${i + 1}`), who(u),
          h("span", { style: { marginLeft: "auto", fontWeight: "700" } }, u.total)])));
    }
  }

  window.__hoodwatch = { _parse: parse };
  if (document.readyState !== "loading") ui(); else document.addEventListener("DOMContentLoaded", ui, { once: true });
})();
