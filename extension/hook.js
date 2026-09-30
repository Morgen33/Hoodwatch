// Runs in the page (MAIN world) so it can see the Space's chat websocket.
// Read-only: it never sends anything into the Space. Events are handed to bridge.js via postMessage.
(function () {
  "use strict";
  if (window.__hoodwatch) return;

  const TAG = "__hoodwatch__";
  const state = { room: null, connected: false, count: 0, listeners: null, feed: [], board: new Map(), emojiTotals: new Map(), sync: "idle", min: false, tab: "feed" };

  const safe = (t) => { if (t && typeof t === "object") return t; try { return JSON.parse(t); } catch { return null; } };
  const post = (type, data) => window.postMessage({ [TAG]: true, dir: "out", type, data }, "*");

  // ---------- id -> @handle directory ----------
  // Some reactions arrive with only an account id. We learn id->handle pairs from chat frames that do carry a
  // handle and from the Space participant list X loads on the page, then fill the gaps (here and on the dashboard).
  const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
  const ids = new Map();
  const unresolvedSamples = []; // raw frames for reactions we couldn't name (for the debug button)

  function remember(id, username, displayName) {
    if (id == null || !username || !HANDLE.test(username)) return;
    const k = String(id);
    const prev = ids.get(k);
    if (prev && prev.username === username) return;
    if (ids.size > 20000) ids.clear();
    ids.set(k, { username, displayName: displayName || null });
    if (state.room) post("name", { room: state.room, userId: k, username, displayName: displayName || null });
    backfillLocal(k, username, displayName);
  }

  function lookup(...keys) {
    for (const k of keys) if (k != null && ids.has(String(k))) return ids.get(String(k));
    return null;
  }

  function backfillLocal(id, username, displayName) {
    let changed = false;
    for (const r of state.feed) {
      if (!r.username && r.userId === id) { r.username = username; r.displayName = r.displayName || displayName || null; changed = true; }
    }
    const old = state.board.get("id:" + id);
    if (old) {
      state.board.delete("id:" + id);
      const cur = state.board.get(username.toLowerCase());
      if (cur) { cur.total += old.total; for (const [e, n] of Object.entries(old.emojis || {})) cur.emojis[e] = (cur.emojis[e] || 0) + n; }
      else state.board.set(username.toLowerCase(), { ...old, username, displayName: old.displayName || displayName || null });
      changed = true;
    }
    if (changed) render();
  }

  // Walk JSON the page fetched about the Space and pick out every participant we can.
  function learn(json) {
    let budget = 20000;
    (function walk(o, depth) {
      if (!o || typeof o !== "object" || depth > 14 || --budget < 0) return;
      if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
      if (o.twitter_screen_name) {
        const rest = o.user_results && o.user_results.rest_id;
        remember(rest, o.twitter_screen_name, o.display_name);
        remember(o.periscope_user_id, o.twitter_screen_name, o.display_name);
        remember(o.user_id, o.twitter_screen_name, o.display_name);
      }
      if (o.rest_id) {
        const sn = (o.core && o.core.screen_name) || (o.legacy && o.legacy.screen_name);
        const nm = (o.core && o.core.name) || (o.legacy && o.legacy.name);
        if (sn) remember(o.rest_id, sn, nm);
      }
      if (o.twitter_id && o.username) remember(o.twitter_id, o.username, o.display_name || o.displayName);
      for (const k in o) walk(o[k], depth + 1);
    })(json, 0);
  }

  const SPACE_API = /AudioSpace|audiospace|live_video_stream|\/spaces?\b|chatnow|Participants/i;

  const nativeFetch = window.fetch;
  window.fetch = function (input) {
    const p = nativeFetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : input && input.url;
      if (url && SPACE_API.test(url)) p.then((r) => r.clone().json()).then(learn).catch(() => {});
    } catch { /* never break the page */ }
    return p;
  };

  const xOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      if (url && SPACE_API.test(String(url))) {
        this.addEventListener("load", () => {
          try {
            const body = this.responseType === "json" ? this.response : (this.responseType === "" || this.responseType === "text") ? safe(this.responseText) : null;
            if (body) learn(body);
          } catch { /* ignore */ }
        });
      }
    } catch { /* ignore */ }
    return xOpen.apply(this, arguments);
  };

  // ---------- chat frame parsing ----------
  function parse(raw) {
    const msg = safe(raw);
    if (!msg || !msg.payload) return null;
    const payload = safe(msg.payload);
    if (!payload) return null;
    const s = payload.sender || {};
    // every frame that carries a handle teaches us its ids
    if (s.username) { remember(s.twitter_id, s.username, s.display_name); remember(s.user_id, s.username, s.display_name); }
    if (!payload.body) return null;
    const body = safe(payload.body);
    if (!body) return null;
    if (body.username && body.remoteID) remember(body.remoteID, body.username, body.displayName);
    if (body.guestUsername && body.guestRemoteID) remember(body.guestRemoteID, body.guestUsername);

    if (body.type === 2 && body.body) {
      const known = lookup(s.twitter_id, s.user_id, body.remoteID, body.twitter_id, body.user_id);
      const username = s.username || body.username || (known && known.username) || null;
      const r = {
        ts: Date.now(),
        emoji: String(body.body).slice(0, 32),
        username,
        displayName: s.display_name || body.displayName || (known && known.displayName) || null,
        userId: String(s.twitter_id || s.user_id || body.remoteID || body.twitter_id || body.user_id || "") || null,
      };
      if (!r.username && unresolvedSamples.length < 5) unresolvedSamples.push(raw.slice(0, 2000));
      return { kind: "reaction", r };
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

  // ---------- websocket hook ----------
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
        state.room = r; state.count = 0; state.feed = []; state.board = new Map(); state.emojiTotals = new Map(); state.listeners = null;
        post("join", { room: r, title: spaceTitle() });
        // hand over everything we learned before the chat connected
        const names = [...ids].map(([userId, v]) => ({ userId, username: v.username, displayName: v.displayName }));
        if (names.length) post("names", { room: r, names: names.slice(-2000) });
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
        const key = ev.r.username ? ev.r.username.toLowerCase() : ev.r.userId ? "id:" + ev.r.userId : "unknown";
        const b = state.board.get(key) || { ...ev.r, total: 0, emojis: {} }; b.total++; b.emojis[ev.r.emoji] = (b.emojis[ev.r.emoji] || 0) + 1; state.board.set(key, b);
        state.emojiTotals.set(ev.r.emoji, (state.emojiTotals.get(ev.r.emoji) || 0) + 1);
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

  // ---------- panel (plain DOM; x.com enforces Trusted Types so no innerHTML) ----------
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

  function copyDebug() {
    const text = JSON.stringify({ v: "tappedin-1.2", knownIds: ids.size, samples: unresolvedSamples }, null, 1);
    navigator.clipboard.writeText(text).then(() => alert("Debug info copied — paste it to whoever's helping you fix this."), () => prompt("Copy this:", text));
  }

  function render() {
    if (!root) return;
    root.replaceChildren(
      h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
        h("strong", { style: { fontSize: "13px" } }, "tapped", h("span", { style: { color: "#c6ff3d" } }, "in")),
        statusEl,
        h("span", { style: { marginLeft: "auto" } }, btn(state.min ? "+" : "–", () => { state.min = !state.min; render(); }))),
      syncEl,
    );
    statusEl.textContent = `${state.connected ? "● live" : "○ idle"} · ${state.count} reactions${state.listeners != null ? ` · ${state.listeners} listening` : ""}`;
    statusEl.style.color = state.connected ? "#c6ff3d" : "#8b8b96";

    const s = state.sync;
    syncEl.textContent =
      s === "ok" ? "✓ syncing to your dashboard" :
      s === "nokey" ? "⚠ add your Tapped In key — click the extension icon" :
      s === "badkey" ? "⚠ key rejected — generate a new one in your dashboard" :
      s === "error" ? "⚠ sync hiccup — retrying" : "";
    syncEl.style.color = s === "ok" ? "#8b8b96" : "#ff4d6d";

    const topE = [...state.emojiTotals].sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (topE.length) root.append(h("div", { style: { marginTop: "6px", display: "flex", flexWrap: "wrap", gap: "8px", fontSize: "13px" } },
      topE.map(([e, n]) => h("span", null, e, h("span", { style: { color: "#8b8b96", fontSize: "11px", marginLeft: "2px" } }, n)))));
    if (state.min) return;
    const unnamed = state.feed.filter((r) => !r.username).length;
    root.append(h("div", { style: { marginTop: "8px", display: "flex", alignItems: "center" } },
      btn("Feed", () => { state.tab = "feed"; render(); }, state.tab === "feed"),
      btn("Top", () => { state.tab = "top"; render(); }, state.tab === "top"),
      btn("Emojis", () => { state.tab = "emojis"; render(); }, state.tab === "emojis"),
      unnamed ? h("span", { style: { marginLeft: "auto" } }, btn(`${unnamed} unnamed · copy debug`, copyDebug)) : null), bodyEl);
    bodyEl.replaceChildren();
    const row = (kids) => h("div", { style: { padding: "3px 0", borderBottom: "1px solid #1b1b21", display: "flex", gap: "6px", alignItems: "center" } }, kids);
    const who = (u) => u.username
      ? h("a", { href: `https://x.com/${u.username}`, target: "_blank", style: { color: "#ededf0", textDecoration: "none" } },
          u.displayName || u.username, h("span", { style: { color: "#8b8b96" } }, ` @${u.username}`))
      : u.userId && /^\d+$/.test(u.userId)
        ? h("a", { href: `https://x.com/i/user/${u.userId}`, target: "_blank", title: "Name not sent by X yet — click to open their profile", style: { color: "#8b8b96", textDecoration: "none" } },
            u.displayName || "unknown", ` · #${u.userId.slice(-5)} ↗`)
        : h("span", { style: { color: "#8b8b96" } }, u.displayName || "unknown");
    if (state.tab === "feed") {
      if (!state.feed.length) bodyEl.append(h("div", { style: { color: "#8b8b96" } }, state.room ? "Waiting for reactions…" : "Join a Space to start."));
      state.feed.forEach((r) => bodyEl.append(row([h("span", { style: { fontSize: "15px" } }, r.emoji), who(r)])));
    } else if (state.tab === "emojis") {
      const all = [...state.emojiTotals].sort((a, b) => b[1] - a[1]);
      if (!all.length) bodyEl.append(h("div", { style: { color: "#8b8b96" } }, "No reactions yet."));
      const max = all.length ? all[0][1] : 1;
      const people = (e) => [...state.board.values()].filter((u) => u.emojis && u.emojis[e]).length;
      all.forEach(([e, n]) => bodyEl.append(row([
        h("span", { style: { fontSize: "16px", width: "22px" } }, e),
        h("div", { style: { flex: "1", height: "8px", background: "#1b1b21", borderRadius: "4px", overflow: "hidden" } },
          h("div", { style: { width: `${Math.max(4, (n / max) * 100)}%`, height: "100%", background: "#c6ff3d", borderRadius: "4px" } })),
        h("span", { style: { fontWeight: "700", minWidth: "28px", textAlign: "right" } }, n),
        h("span", { style: { color: "#8b8b96", fontSize: "11px", minWidth: "54px", textAlign: "right" } }, `${people(e)} ppl`),
      ])));
    } else {
      [...state.board.values()].sort((a, b) => b.total - a.total).slice(0, 50).forEach((u, i) =>
        bodyEl.append(h("div", { style: { padding: "4px 0", borderBottom: "1px solid #1b1b21" } },
          h("div", { style: { display: "flex", gap: "6px", alignItems: "center" } },
            h("span", { style: { color: "#8b8b96", width: "22px" } }, `#${i + 1}`), who(u),
            h("span", { style: { marginLeft: "auto", fontWeight: "700" } }, u.total)),
          h("div", { style: { paddingLeft: "28px", fontSize: "12px", display: "flex", flexWrap: "wrap", gap: "6px" } },
            Object.entries(u.emojis || {}).sort((a, b) => b[1] - a[1]).map(([e, n]) =>
              h("span", null, e, h("span", { style: { color: "#8b8b96", fontSize: "11px", marginLeft: "1px" } }, n)))))));
    }
  }

  window.__hoodwatch = { _parse: parse, _learn: learn, _ids: ids };
  if (document.readyState !== "loading") ui(); else document.addEventListener("DOMContentLoaded", ui, { once: true });
})();
