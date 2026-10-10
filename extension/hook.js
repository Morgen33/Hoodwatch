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
      if (o.metadata && typeof o.metadata === "object" && o.metadata.rest_id && typeof o.metadata.title === "string") spaceMeta(o);
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

  // X's Space info (AudioSpaceById): the real title, who's hosting, and whether it has ended.
  const metas = new Map();
  let lastMetaKey = null;
  function spaceMeta(space) {
    const m = space.metadata;
    const person = (x) => {
      if (!x) return null;
      const r = x.user_results && x.user_results.result;
      const handle = x.twitter_screen_name || (r && ((r.core && r.core.screen_name) || (r.legacy && r.legacy.screen_name))) || null;
      if (!handle) return null;
      return {
        handle,
        name: x.display_name || (r && ((r.core && r.core.name) || (r.legacy && r.legacy.name))) || null,
        avatar: x.avatar_url || (r && ((r.avatar && r.avatar.image_url) || (r.legacy && r.legacy.profile_image_url_https))) || null,
      };
    };
    const c = m.creator_results && m.creator_results.result;
    const creator = c ? person({ user_results: { result: c } }) : null;
    const parts = space.participants || {};
    const admins = (parts.admins || []).map(person).filter(Boolean);
    const speakers = (parts.speakers || []).map(person).filter(Boolean);
    const host = creator || admins[0] || null;
    const cohosts = admins.filter((a) => !host || a.handle.toLowerCase() !== host.handle.toLowerCase());
    const num = (v) => (typeof v === "number" ? v : v != null && /^\d+$/.test(String(v)) ? Number(v) : null);
    const meta = {
      title: String(m.title || "").slice(0, 200) || null,
      host_handle: host && host.handle, host_name: host && host.name, host_avatar: host && host.avatar,
      state: m.state || null,
      cohosts: cohosts.slice(0, 20),
      speakers: speakers.slice(0, 40),
      total_live_listeners: num(m.total_live_listeners),
      total_replay_watched: num(m.total_replay_watched),
      replay_available: m.is_space_available_for_replay ?? null,
      x_started_at: num(m.started_at),
      x_ended_at: num(m.ended_at),
      participants_total: num(parts.total),
    };
    const key = String(m.rest_id);
    const prev = metas.get(key);
    // keep the richest speaker/co-host lists we've seen (people drop off stage over time)
    if (prev) {
      const merge = (a, b) => { const seen = new Map(); for (const x of [...(a || []), ...(b || [])]) seen.set(x.handle.toLowerCase(), x); return [...seen.values()].slice(0, 60); };
      meta.cohosts = merge(prev.cohosts, meta.cohosts).filter((x) => !meta.host_handle || x.handle.toLowerCase() !== meta.host_handle.toLowerCase());
      meta.speakers = merge(prev.speakers, meta.speakers);
      for (const k of Object.keys(meta)) if (meta[k] == null && prev[k] != null) meta[k] = prev[k];
    }
    if (prev && JSON.stringify(prev) === JSON.stringify(meta)) return;
    metas.set(key, meta);
    lastMetaKey = key;
    // only the Space you're actually in goes to the dashboard (X loads info for every Space card on the timeline)
    if (key === state.room) { post("meta", { room: key, meta }); state.title = meta.title; state.host = meta.host_handle; render(); }
  }

  const SPACE_API = /AudioSpace|audiospace|live_video_stream|\/spaces?\b|chatnow|Participants/i;
  const CHATTY = /pscp|periscope|chat|broadcast|live_video|audiospace|janus|guest|spaces?\b/i;
  const httpSeen = [];
  function trackHttp(url) {
    try {
      const u = String(url).split("?")[0];
      if (CHATTY.test(u) && !httpSeen.includes(u) && httpSeen.length < 40) httpSeen.push(u);
    } catch { /* ignore */ }
  }

  const nativeFetch = window.fetch;
  window.fetch = function (input) {
    const p = nativeFetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : input && input.url;
      if (url) trackHttp(url);
      if (url && SPACE_API.test(url)) p.then((r) => r.clone().json()).then(learn).catch(() => {});
    } catch { /* never break the page */ }
    return p;
  };

  const xOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      if (url) trackHttp(url);
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
  function parse(raw) { return parseStd(raw) || parseDeep(raw); }

  function parseStd(raw) {
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

  // Fallback: dig through nested JSON (strings inside strings) for a reaction-shaped object.
  const EMOJI_ISH = /[^\x00-\x7F]/;
  function parseDeep(raw) {
    let found = null, sender = null, budget = 400;
    (function walk(o, depth, from) {
      if (found || depth > 7 || --budget < 0) return;
      if (typeof o === "string") { if (o.length > 1 && (o[0] === "{" || o[0] === "[")) walk(safe(o), depth + 1, from); return; }
      if (!o || typeof o !== "object") return;
      const snd = (o.sender && typeof o.sender === "object") ? o.sender : from;
      if (o.type === 2 && typeof o.body === "string" && o.body.length <= 16 && EMOJI_ISH.test(o.body)) { found = o; sender = snd; return; }
      for (const k in o) walk(o[k], depth + 1, snd);
    })(raw, 0, null);
    if (!found) return null;
    const s = sender || {};
    const known = lookup(s.twitter_id, s.user_id, found.remoteID, found.twitter_id, found.user_id);
    return { kind: "reaction", r: {
      ts: Date.now(),
      emoji: found.body.slice(0, 32),
      username: s.username || found.username || (known && known.username) || null,
      displayName: s.display_name || found.displayName || (known && known.displayName) || null,
      userId: String(s.twitter_id || s.user_id || found.remoteID || found.twitter_id || found.user_id || "") || null,
    } };
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
  // X has moved the chat around before, so match the socket loosely and read text or binary frames.
  const CHAT_WS = /chatapi|chatnow|chatman|pscp\.tv|periscope/i;
  const diag = { sockets: [], hooked: 0, frames: 0, parsed: 0, recent: [], sse: [], workers: [], rtc: 0, channels: [] };
  function note(dir, text) {
    diag.recent.push(dir + " " + String(text).slice(0, 700));
    if (diag.recent.length > 60) diag.recent.shift();
  }
  const dec = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;
  function toText(d) { // string, Promise<string> (Blob) or null
    if (typeof d === "string") return d;
    try {
      if (dec && d instanceof ArrayBuffer) return dec.decode(new Uint8Array(d));
      if (dec && ArrayBuffer.isView(d)) return dec.decode(d);
      if (typeof Blob !== "undefined" && d instanceof Blob) return d.text();
    } catch { /* unreadable frame */ }
    return null;
  }
  const spaceFromUrl = () => { const m = location.pathname.match(/\/i\/spaces\/([A-Za-z0-9]+)/); return m ? m[1] : null; };

  const Native = window.WebSocket;
  function Patched(url, protocols) {
    const ws = protocols !== undefined ? new Native(url, protocols) : new Native(url);
    try {
      const clean = String(url).split("?")[0];
      if (diag.sockets.length < 30) diag.sockets.push(clean);
      if (CHAT_WS.test(clean)) hook(ws);
    } catch { /* never break the page */ }
    return ws;
  }
  Patched.prototype = Native.prototype;
  ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach((k) => (Patched[k] = Native[k]));
  window.WebSocket = Patched;

  // ---------- other transports X could use for the chat ----------
  try {
    const NES = window.EventSource;
    if (NES) {
      const E = function (url, cfg) {
        const es = new NES(url, cfg);
        try {
          const clean = String(url).split("?")[0];
          if (diag.sse.length < 20) diag.sse.push(clean);
          es.addEventListener("message", (e) => onFrame(String(e.data), "sse"));
        } catch { /* ignore */ }
        return es;
      };
      E.prototype = NES.prototype; ["CONNECTING", "OPEN", "CLOSED"].forEach((k) => (E[k] = NES[k]));
      window.EventSource = E;
    }
  } catch { /* ignore */ }

  function watchChannel(ch) {
    try {
      if (diag.channels.length < 20) diag.channels.push(ch.label || "(no label)");
      ch.addEventListener("message", (e) => {
        const t = toText(e.data);
        if (typeof t === "string") onFrame(t, "dc"); else if (t) t.then((x) => onFrame(x, "dc"), () => {});
      });
    } catch { /* ignore */ }
  }
  try {
    const NRTC = window.RTCPeerConnection;
    if (NRTC) {
      const R = function (...args) {
        const pc = new NRTC(...args);
        try {
          diag.rtc++;
          pc.addEventListener("datachannel", (e) => watchChannel(e.channel));
          const oc = pc.createDataChannel;
          pc.createDataChannel = function () { const ch = oc.apply(this, arguments); watchChannel(ch); return ch; };
        } catch { /* ignore */ }
        return pc;
      };
      R.prototype = NRTC.prototype;
      Object.setPrototypeOf(R, NRTC);
      window.RTCPeerConnection = R;
    }
  } catch { /* ignore */ }

  for (const k of ["Worker", "SharedWorker"]) {
    try {
      const N = window[k];
      if (!N) continue;
      const Wk = function (url, opts) {
        try { if (diag.workers.length < 20) diag.workers.push(k + ": " + String(url).split("?")[0].slice(0, 200)); } catch { /* ignore */ }
        return opts !== undefined ? new N(url, opts) : new N(url);
      };
      Wk.prototype = N.prototype;
      window[k] = Wk;
    } catch { /* ignore */ }
  }

  function joinRoom(r) {
    if (!r || r === state.room) return;
    state.room = r; state.count = 0; state.feed = []; state.board = new Map(); state.emojiTotals = new Map(); state.listeners = null;
    post("join", { room: r, title: spaceTitle() });
    const known = metas.get(r);
    if (known) { post("meta", { room: r, meta: known }); state.title = known.title; state.host = known.host_handle; }
    // hand over everything we learned before the chat connected
    const names = [...ids].map(([userId, v]) => ({ userId, username: v.username, displayName: v.displayName }));
    if (names.length) post("names", { room: r, names: names.slice(-2000) });
    render();
  }

  function hook(ws) {
    diag.hooked++;
    const origSend = ws.send;
    ws.send = function (data) {
      try {
        const t = toText(data);
        if (typeof t === "string") {
          note("out", t);
          joinRoom(roomFrom(t));
          const emoji = state.room && outgoingReaction(t);
          if (emoji) {
            const me = self();
            selfSent.push({ emoji, ts: Date.now() }); if (selfSent.length > 50) selfSent.shift();
            addReaction({ ts: Date.now(), emoji, username: me.username, displayName: me.displayName, userId: me.id });
            render();
          }
        }
      } catch { /* never break sending */ }
      return origSend.apply(this, arguments);
    };
    ws.addEventListener("open", () => { state.connected = true; ui(); render(); });
    ws.addEventListener("close", () => {
      state.connected = false;
      if (state.room) post("leave", { room: state.room });
      render();
    });
    ws.addEventListener("message", (e) => {
      const t = toText(e.data);
      if (t == null) return;
      if (typeof t === "string") onFrame(t); else t.then(onFrame, () => {});
    });
  }

  function onFrame(t, src) {
    diag.frames++;
    note("in" + (src ? ":" + src : ""), t);
    let ev = null;
    try { ev = parse(t); } catch { ev = null; }
    if (!ev) return;
    diag.parsed++;
    if (src && !state.connected) { state.connected = true; ui(); }
    if (!state.room) joinRoom(spaceFromUrl() || lastMetaKey); // X didn't announce the room: use the Space we're on
    if (!state.room) return;
    if (ev.kind === "reaction") {
      // if X ever echoes our own reaction back, don't count it twice
      const me = self();
      if (me.id && (ev.r.userId === me.id || (me.username && ev.r.username && ev.r.username.toLowerCase() === me.username.toLowerCase()))) {
        const i = selfSent.findIndex((x) => x.emoji === ev.r.emoji && Date.now() - x.ts < 8000);
        if (i >= 0) { selfSent.splice(i, 1); return; }
      }
      addReaction(ev.r);
    } else {
      post("occupancy", { room: state.room, ...ev.o });
      state.listeners = ev.o.listeners;
    }
    render();
  }

  function addReaction(r) {
    {
      {
        post("reaction", { room: state.room, ...r });
        const ev = { r };
        state.count++;
        state.feed.unshift(ev.r); if (state.feed.length > 150) state.feed.pop();
        const key = ev.r.username ? ev.r.username.toLowerCase() : ev.r.userId ? "id:" + ev.r.userId : "unknown";
        const b = state.board.get(key) || { ...ev.r, total: 0, emojis: {} }; b.total++; b.emojis[ev.r.emoji] = (b.emojis[ev.r.emoji] || 0) + 1; state.board.set(key, b);
        state.emojiTotals.set(ev.r.emoji, (state.emojiTotals.get(ev.r.emoji) || 0) + 1);
      }
    }
  }

  // ---------- the host's own reactions ----------
  // X doesn't echo your own reactions back over the socket, so catch them on the way out.
  const selfSent = [];
  function self() {
    let cookie = "";
    try { cookie = document.cookie || ""; } catch { /* no cookie access: treat as unknown */ }
    const m = cookie.match(/(?:^|;\s*)twid=("?)u(?:%3D|=)(\d+)\1/);
    const id = m ? m[2] : null;
    const known = id ? ids.get(id) : null;
    return { id, username: known ? known.username : null, displayName: known ? known.displayName : null };
  }
  function outgoingReaction(data) {
    const m = safe(data);
    if (!m) return null;
    for (const cand of [m.payload, m.body]) {
      const p = safe(cand);
      if (!p) continue;
      const b = safe(p.body);
      if (b && b.type === 2 && b.body) return String(b.body).slice(0, 32);
      if (p.type === 2 && p.body && typeof p.body === "string" && p.body.length <= 32 && !safe(p.body)) return p.body;
    }
    return null;
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
    makeDraggable();
  }

  // ---------- drag the panel by its header; remembers the spot ----------
  const POS_KEY = "tappedin-panel-pos";
  let pos = null; // {x, y} = top-left in px, or null for the default corner
  try { pos = JSON.parse(localStorage.getItem(POS_KEY) || "null"); } catch { pos = null; }
  function savePos() { try { pos ? localStorage.setItem(POS_KEY, JSON.stringify(pos)) : localStorage.removeItem(POS_KEY); } catch { /* storage blocked: just don't remember */ } }
  function applyPos() {
    if (!root) return;
    if (!pos) { Object.assign(root.style, { left: "12px", bottom: "12px", top: "auto", right: "auto" }); return; }
    const w = root.offsetWidth || 310, hgt = root.offsetHeight || 60;
    pos.x = Math.min(Math.max(0, pos.x), Math.max(0, window.innerWidth - w));
    pos.y = Math.min(Math.max(0, pos.y), Math.max(0, window.innerHeight - hgt));
    Object.assign(root.style, { left: pos.x + "px", top: pos.y + "px", bottom: "auto", right: "auto" });
  }
  function makeDraggable() {
    applyPos();
    let drag = null, lastDown = 0;
    root.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !e.target.closest("[data-tidrag]") || e.target.closest("button,a,input")) return;
      const now = Date.now();
      if (now - lastDown < 350) { lastDown = 0; pos = null; savePos(); applyPos(); e.preventDefault(); return; } // double-click: back to the corner
      lastDown = now;
      const r = root.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
      root.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    root.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      lastDown = 0; // it's a drag, not half of a double-click
      pos = { x: e.clientX - drag.dx, y: e.clientY - drag.dy };
      applyPos();
    });
    const end = (e) => { if (drag && e.pointerId === drag.id) { drag = null; savePos(); } };
    root.addEventListener("pointerup", end);
    root.addEventListener("pointercancel", end);
    window.addEventListener("resize", applyPos);
  }

  function copyDebug() {
    const text = JSON.stringify({
      v: "tappedin-1.9", page: location.pathname, room: state.room, connected: state.connected, count: state.count,
      sockets: diag.sockets, hooked: diag.hooked, frames: diag.frames, parsed: diag.parsed,
      http: httpSeen, sse: diag.sse, workers: diag.workers, rtc: diag.rtc, channels: diag.channels,
      spaceOnPage: !!document.querySelector('[data-testid*="pace" i], [aria-label*="Space" i]'),
      knownIds: ids.size, unnamed: unresolvedSamples, recent: diag.recent.slice(-40),
    }, null, 1);
    const done = () => alert("Debug info copied — paste it to Claude.");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => prompt("Copy this:", text));
    else prompt("Copy this:", text);
  }

  // Wipes the panel only. Anything already synced stays on the dashboard.
  function clearPanel() {
    if (state.count && !confirm("Clear the panel and start counting from zero?\n\nYour dashboard keeps everything already synced.")) return;
    state.count = 0; state.feed = []; state.board = new Map(); state.emojiTotals = new Map();
    unresolvedSamples.length = 0;
    render();
  }

  function render() {
    if (!root) return;
    if (pos) requestAnimationFrame(applyPos); // panel may have grown: keep it on screen
    root.replaceChildren(...[
      h("div", { "data-tidrag": "1", title: "Drag to move · double-click to reset", style: { display: "flex", alignItems: "center", gap: "8px", cursor: "move", userSelect: "none", touchAction: "none" } },
        h("strong", { style: { fontSize: "13px" } }, "⠿ tapped", h("span", { style: { color: "#c6ff3d" } }, "in")),
        statusEl,
        h("span", { style: { marginLeft: "auto", display: "flex" } },
          btn("Clear", clearPanel),
          btn(state.min ? "+" : "–", () => { state.min = !state.min; render(); }))),
      state.title ? h("div", { style: { marginTop: "4px", fontSize: "12px", fontWeight: "700", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } },
        state.title, state.host ? h("span", { style: { color: "#8b8b96", fontWeight: "400" } }, ` · @${state.host}`) : null) : null,
      syncEl,
    ].filter(Boolean));
    statusEl.textContent = !diag.hooked
      ? (spaceFromUrl() ? "○ waiting for the Space chat — hit Start listening" : "○ open a Space to start")
      : `${state.connected ? "● live" : "○ idle"} · ${state.count} reactions${state.listeners != null ? ` · ${state.listeners} listening` : ""}`;
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
      btn("Leaderboard", () => { state.tab = "top"; render(); }, state.tab === "top"),
      btn("Emojis", () => { state.tab = "emojis"; render(); }, state.tab === "emojis"),
      h("span", { style: { marginLeft: "auto" } }, btn(unnamed ? `${unnamed} unnamed · debug` : "debug", copyDebug))), bodyEl);
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
      // one line per person: #rank  name ........ total  🔥12 💯3 😂1  (wraps if long)
      [...state.board.values()].sort((a, b) => b.total - a.total).slice(0, 100).forEach((u, i) =>
        bodyEl.append(h("div", { style: { padding: "5px 0", borderBottom: "1px solid #1b1b21", display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: "6px", rowGap: "2px" } },
          h("span", { style: { color: "#8b8b96", minWidth: "24px" } }, `#${i + 1}`),
          h("span", { style: { flex: "1 1 auto", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "150px" } }, who(u)),
          h("span", { style: { marginLeft: "auto", display: "flex", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "baseline", gap: "6px" } },
            h("span", { style: { fontWeight: "800" } }, u.total),
            Object.entries(u.emojis || {}).sort((a, b) => b[1] - a[1]).map(([e, n]) =>
              h("span", { style: { whiteSpace: "nowrap" } }, e, h("span", { style: { fontSize: "11px", color: "#bdbdc6", marginLeft: "1px" } }, n)))))));
    }
  }

  window.__hoodwatch = { _parse: parse, _learn: learn, _ids: ids };
  if (document.readyState !== "loading") ui(); else document.addEventListener("DOMContentLoaded", ui, { once: true });
})();
