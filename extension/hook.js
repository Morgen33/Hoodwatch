// Runs in the page (MAIN world) so it can see the Space's chat websocket.
// Read-only: it never sends anything into the Space. Events are handed to bridge.js via postMessage.
(function () {
  "use strict";
  if (window.__hoodwatch) return;

  const TAG = "__hoodwatch__";
  const SUB = "__tappedin_sub__";
  const plainFetch = window.fetch.bind(window); // untouched copy for polling X's chat history
  let IS_TOP = true; try { IS_TOP = window.top === window; } catch { IS_TOP = false; }
  const ALLOWED_SUB_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*(pscp\.tv|periscope\.tv|x\.com|twitter\.com)$/i;
  function toTop(msg) { try { window.top.postMessage({ [SUB]: true, ...msg }, "*"); } catch { /* ignore */ } }
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
  let lastMetaKey = null, joinedHint = null;
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
  const MEDIA = /\.(aac|m3u8|ts|mp4|m4s|jpe?g|png|webp|gif|svg|css|js|woff2?|ico)$/i;
  const httpSeen = [];
  function trackHttp(url, where) {
    try {
      const u = String(url).split("?")[0];
      if (MEDIA.test(u) || /\/(jot|1\.1\/jot|client_event|log)\b/i.test(u)) return;
      const tag = (where ? where + " " : "") + u;
      if (!httpSeen.includes(tag) && httpSeen.length < 90) httpSeen.push(tag);
    } catch { /* ignore */ }
  }

  // Describe a value without keeping secrets: URLs become host+path, other strings just their length.
  function shape(v) {
    if (v == null) return v;
    if (typeof v === "string") return /^(https?|wss?):\/\//i.test(v) ? v.split("?")[0].slice(0, 200) : `str(${v.length})`;
    if (typeof v !== "object") return v;
    if (Array.isArray(v)) return `array(${v.length})`;
    const o = {}; for (const [k, x] of Object.entries(v).slice(0, 20)) o[k] = typeof x === "object" && x ? (Array.isArray(x) ? `array(${x.length})` : "{" + Object.keys(x).slice(0, 12).join(",") + "}") : shape(x);
    return o;
  }

  // the moment you join: X's chat-access reply names the chat room (the Space id). Never keeps tokens.
  function onAccessChat(j) {
    try {
      const pick = {};
      for (const [k, v] of Object.entries(j || {})) if (!/token|key|signature/i.test(k)) pick[k] = shape(v);
      diag.chat = { keys: Object.keys(j || {}), ...pick };
      const rid = j && (j.room_id || j.roomId || j.room);
      joinedHint = (typeof rid === "string" && /^[A-Za-z0-9_-]{6,40}$/.test(rid)) ? rid : (spaceFromUrl() || lastMetaKey);
      joinRoom(joinedHint);
      if (IS_TOP && j && typeof j.access_token === "string" && typeof j.endpoint === "string") ownChat.start(j.endpoint, j.access_token, joinedHint);
    } catch { /* ignore */ }
  }

  // X's page no longer opens the Space chat itself: x.com's security rules now block the page from connecting to
  // X's chat servers. X still hands the browser a chat pass, so the extension's background process (which those
  // page rules don't cover) opens the same read-only chat connection X's app used to: it authenticates, joins the
  // room and only listens. Nothing is ever sent into the Space. Frames come back here for the normal parsing.
  const ownChat = {
    cfg: null, timer: null,
    start(endpoint, token, room) {
      if (!/^https:\/\/[a-z0-9.-]+\.pscp\.tv\/?$/i.test(endpoint) || !room) { diag.own.status = "skipped: unexpected endpoint"; return; }
      if (diag.hooked > 0) { diag.own.status = "not needed: X opened the chat itself"; return; }
      this.cfg = { endpoint, token, room };
      diag.own.status = "asking extension to connect"; diag.own.opens++;
      post("chatopen", this.cfg);
      // keep the background awake and let it reconnect if Chrome restarted it
      clearInterval(this.timer);
      this.timer = setInterval(() => { if (this.cfg) post("chatopen", this.cfg); }, 20000);
      // and, in parallel, ask X's chat server for new messages every few seconds over a normal web request
      this.joinedAt = Date.now(); this.cursor = ""; this.via = "page"; this.fails = 0; this.rounds = 0; this.sinceMode = "ms"; diag.poll.since = "ms";
      clearTimeout(this.pollTimer); this.pollTimer = setTimeout(() => this.poll(), 1500);
    },
    async poll() {
      const cfg = this.cfg;
      if (!cfg) return;
      if (diag.own.frames > 0 && /listening/.test(diag.own.status)) { diag.poll.status = "not needed: live connection works"; return; }
      const sinceMs = this.joinedAt - 30000;
      const since = this.sinceMode === "ns" ? sinceMs * 1e6 : this.sinceMode === "s" ? Math.floor(sinceMs / 1000) : sinceMs;
      const req = { access_token: cfg.token, cursor: this.cursor, limit: 1000, quick_get: true, since };
      if (this.via === "background") { post("chatpoll", { ...cfg, cursor: this.cursor, since }); this.pollTimer = setTimeout(() => this.poll(), 3000); return; }
      let delay = 3000;
      try {
        const r = await plainFetch(cfg.endpoint.replace(/\/$/, "") + "/chatapi/v1/history", {
          method: "POST", headers: { "content-type": "application/json" }, credentials: "omit", body: JSON.stringify(req),
        });
        diag.poll.http = r.status; diag.poll.via = "page";
        const j = await r.json().catch(() => null);
        if (!r.ok || !j) throw new Error("http " + r.status);
        this.fails = 0;
        delay = this.afterPage(j);
      } catch (e) {
        diag.poll.lastError = String(e && e.message || e).slice(0, 120);
        // a blocked cross-site read: let the extension background do the request instead
        if (++this.fails >= 2 && this.via === "page") { this.via = "background"; diag.poll.via = "background"; }
      }
      if (this.cfg === cfg) this.pollTimer = setTimeout(() => this.poll(), delay);
    },
    // returns how long to wait before the next check: fast while catching up to "now", 3s once caught up
    afterPage(j) {
      const info = takeHistory(j, "poll");
      const oldCursor = this.cursor;
      if (typeof j.cursor === "string") this.cursor = j.cursor;
      const behind = info.newest && info.newest < this.joinedAt - 60000;
      diag.poll.lagMin = info.newest ? Math.round((Date.now() - info.newest) / 60000) : diag.poll.lagMin;
      if (behind && this.rounds === 1 && this.sinceMode !== "none") {
        // the server ignored "since" in this unit: try the next unit, then give up on it and fast-forward
        this.sinceMode = this.sinceMode === "ms" ? "ns" : this.sinceMode === "ns" ? "s" : "none";
        diag.poll.since = this.sinceMode; this.rounds = 0; this.cursor = this.sinceMode === "none" ? this.cursor : "";
        return 100;
      }
      if (behind && this.cursor && this.cursor !== oldCursor && info.count > 0) { diag.poll.catchUpPages = (diag.poll.catchUpPages || 0) + 1; return 60; }
      return 3000;
    },
    stop(why) {
      clearInterval(this.timer); this.timer = null;
      clearTimeout(this.pollTimer); this.pollTimer = null;
      if (this.cfg) post("chatclose", { room: this.cfg.room });
      this.cfg = null;
      if (why) diag.own.status = "stopped: " + why;
    },
    get ws() { return this.cfg; }, // truthy while active (used by the "X opened it itself" check)
  };

  const seenMsgs = new Set();
  function msgKey(m) { try { return typeof m === "string" ? m : (typeof m.payload === "string" ? m.payload : JSON.stringify(m)); } catch { return null; } }
  function firstTime(k) {
    if (!k) return true;
    if (seenMsgs.has(k)) return false;
    seenMsgs.add(k); if (seenMsgs.size > 20000) seenMsgs.clear();
    return true;
  }
  function msgTime(m) { // ms, or null
    try {
      const p = safe(m.payload) || m; const b = safe(p && p.body) || {};
      const t = Number(b.timestamp || p.timestamp || m.timestamp || 0);
      return !t ? null : t > 1e14 ? Math.round(t / 1e6) : t > 1e11 ? t : t * 1000;
    } catch { return null; }
  }
  function describeMsg(m) {
    try {
      const p = safe(m.payload) || {}; const b = safe(p.body) || {};
      return { k: m.kind, pk: p.kind, bt: b.type, body: typeof b.body === "string" ? b.body.slice(0, 16) : undefined,
        who: (p.sender && p.sender.username) || b.username || undefined, ts: b.timestamp || p.timestamp || m.timestamp || undefined };
    } catch { return { raw: String(m).slice(0, 80) }; }
  }
  // Count only what happened after you joined; return how far along the history we are.
  function takeHistory(j, src) {
    const list = Array.isArray(j) ? j : (j.messages || j.Messages || j.events || []);
    if (!diag.poll.keys) diag.poll.keys = Array.isArray(j) ? ["(array)"] : Object.keys(j).slice(0, 12);
    diag.poll.total += list.length;
    ownChat.rounds = (ownChat.rounds || 0) + 1; diag.poll.rounds = (diag.poll.rounds || 0) + 1;
    const cutoff = (ownChat.joinedAt || 0) - 30000;
    let newest = 0;
    for (const m of list) {
      const t = msgTime(m);
      if (t && t > newest) newest = t;
      const k = msgKey(m);
      if (!firstTime(k)) continue;
      const old = t && t < cutoff;
      const d = describeMsg(m);
      if (d.bt === 2 && diag.poll.samples.length < 30) diag.poll.samples.push(Object.assign(d, { got: old ? "old" : "counted", ageMin: t ? Math.round((Date.now() - t) / 60000) : null }));
      if (old) { diag.poll.old = (diag.poll.old || 0) + 1; continue; }
      diag.poll.kept++;
      if (!state.connected) { state.connected = true; render(); }
      onFrame(typeof m === "string" ? m : JSON.stringify(m), src);
    }
    if (newest) diag.poll.newestAgeMin = Math.round((Date.now() - newest) / 60000);
    return { newest, count: list.length };
  }

  // Long-running responses (live event streams): read a copy as it arrives and look for reactions.
  const STREAMY = /live_pipeline|subscri|stream|events|pubsub|realtime|chat|livechat|LiveChat|broadcast|guest/i;
  function tapStream(resp, label) {
    try {
      if (!resp || !resp.ok || !resp.body) return;
      const ct = (resp.headers && resp.headers.get("content-type")) || "";
      if (/image|audio|video|octet-stream|javascript|css|font/i.test(ct)) return;
      const reader = resp.clone().body.getReader();
      const d = new TextDecoder();
      let buf = "", total = 0;
      diag.streams.push(label + " " + (ct.split(";")[0] || "?"));
      if (diag.streams.length > 30) diag.streams.shift();
      (function pump() {
        reader.read().then(({ done, value }) => {
          if (done) { if (buf.trim()) streamLine(buf, label); return; }
          total += value ? value.byteLength : 0;
          if (total > 50e6) { reader.cancel().catch(() => {}); return; }
          buf += d.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) { streamLine(buf.slice(0, i), label); buf = buf.slice(i + 1); }
          if (buf.length > 200000) { streamLine(buf, label); buf = ""; }
          pump();
        }).catch(() => {});
      })();
    } catch { /* ignore */ }
  }
  function streamLine(line, label) {
    let t = line.trim();
    if (!t) return;
    if (t.startsWith("data:")) t = t.slice(5).trim();
    if (!(t[0] === "{" || t[0] === "[")) return;
    sample(diag.streamSamples, "in:" + label, t, 40);
    onFrame(t, "http");
  }

  // Your own reactions now go out through an X request; read the emoji from it (never the auth).
  function outgoingFromRequest(url, body) {
    try {
      if (!/LiveChat|livechat|reaction|chat/i.test(url) || /accessChat|authorize|login|token/i.test(url) || body == null) return;
      const text = typeof body === "string" ? body : null;
      if (!text) return;
      const j = safe(text);
      const redacted = j ? JSON.stringify(j, (k, v) => (/token|key|signature|cookie|auth|secret|password/i.test(k) ? "[hidden]" : v)) : text.replace(/[A-Za-z0-9_\-]{32,}/g, "[hidden]");
      sample(diag.sentSamples, "out:" + String(url).split("?")[0].split("/").pop(), redacted, 8);
      const emoji = state.room && (outgoingReaction(text) || outgoingDeep(text) || shortEmoji(safe(text)));
      if (emoji) {
        const me = self();
        selfSent.push({ emoji, ts: Date.now() }); if (selfSent.length > 50) selfSent.shift();
        addReaction({ ts: Date.now(), emoji, username: me.username, displayName: me.displayName, userId: me.id });
        render();
      }
    } catch { /* ignore */ }
  }
  function shortEmoji(o) {
    let e = null, budget = 200;
    (function walk(x, depth) {
      if (e || depth > 6 || --budget < 0 || !x) return;
      if (typeof x === "string") { if (x.length > 1 && (x[0] === "{" || x[0] === "[")) walk(safe(x), depth + 1); return; }
      if (typeof x !== "object") return;
      for (const [k, v] of Object.entries(x)) {
        if (typeof v === "string" && /^(body|text|emoji|reaction|message|content)$/i.test(k) && v.length <= 16 && EMOJI_ISH.test(v)) { e = v; return; }
      }
      for (const k in x) walk(x[k], depth + 1);
    })(o, 0);
    return e;
  }

  function wrapFetch(win, where) {
    const nf = win.fetch;
    if (!nf || nf.__ti) return;
    const wrapped = function (input, init) {
      const p = nf.apply(this, arguments);
      try {
        const url = typeof input === "string" ? input : input && input.url;
        if (url) {
          trackHttp(url, where);
          if (/stopWatching/i.test(url) && IS_TOP) { ownChat.stop("left the Space"); state.connected = false; if (state.room) post("leave", { room: state.room }); render(); }
          if (init && init.body) outgoingFromRequest(url, init.body);
          if (/accessChat/i.test(url)) p.then((r) => r.clone().json()).then(onAccessChat).catch(() => {});
          if (VIEWER_URL.test(String(url).split("?")[0])) p.then((r) => r.clone().json()).then(onViewer).catch(() => {});
          else if (SPACE_API.test(url)) p.then((r) => r.clone().json()).then(learn).catch(() => {});
          if (/\.(aac|ts)(\?|$)/i.test(url)) p.then((r) => r.clone().arrayBuffer()).then((b) => audioChunk(new Uint8Array(b), "fetch")).catch(() => {});
          if (STREAMY.test(String(url).split("?")[0]) && !/accessChat|AudioSpaceById/i.test(url)) p.then((r) => tapStream(r, (where ? where + " " : "") + String(url).split("?")[0].split("/").slice(-2).join("/"))).catch(() => {});
        }
      } catch { /* never break the page */ }
      return p;
    };
    try { Object.defineProperty(wrapped, "__ti", { value: true }); } catch { /* ignore */ }
    looksNative(wrapped, "fetch");
    win.fetch = wrapped;
  }

  function wrapXhr(win, where) {
    const X = win.XMLHttpRequest;
    if (!X || X.prototype.open.__ti) return;
    const xo = X.prototype.open, xs = X.prototype.send;
    const open = function (method, url) {
      try {
        this.__tiUrl = String(url || "");
        if (url) trackHttp(url, where);
        if (url && /stopWatching/i.test(String(url)) && IS_TOP) { ownChat.stop("left the Space"); state.connected = false; if (state.room) post("leave", { room: state.room }); render(); }
        if (url && /\.(aac|ts)(\?|$)/i.test(String(url))) {
          this.addEventListener("load", () => {
            try { const r = this.response; const u8 = bytesOf(r); if (u8 && typeof u8.then !== "function") audioChunk(u8, "xhr"); else if (u8) u8.then((x) => audioChunk(x, "xhr")); } catch { /* ignore */ }
          });
        }
        if (url && VIEWER_URL.test(String(url).split("?")[0])) {
          this.addEventListener("load", () => { try { onViewer(this.responseType === "json" ? this.response : safe(this.responseText)); } catch { /* ignore */ } });
        }
        if (url && /accessChat/i.test(String(url))) {
          this.addEventListener("load", () => { try { onAccessChat(this.responseType === "json" ? this.response : safe(this.responseText)); } catch { /* ignore */ } });
        } else if (url && SPACE_API.test(String(url))) {
          this.addEventListener("load", () => {
            try {
              const body = this.responseType === "json" ? this.response : (this.responseType === "" || this.responseType === "text") ? safe(this.responseText) : null;
              if (body) learn(body);
            } catch { /* ignore */ }
          });
        } else if (url && STREAMY.test(String(url).split("?")[0])) {
          let seen = 0;
          const label = (where ? where + " " : "") + "xhr " + String(url).split("?")[0].split("/").slice(-2).join("/");
          const read = () => {
            try {
              if (!(this.responseType === "" || this.responseType === "text")) return;
              const t = this.responseText || "";
              const chunk = t.slice(seen); seen = t.length;
              for (const line of chunk.split("\n")) streamLine(line, label);
            } catch { /* ignore */ }
          };
          this.addEventListener("progress", read);
          this.addEventListener("load", read);
        }
      } catch { /* ignore */ }
      return xo.apply(this, arguments);
    };
    const send = function (body) {
      try { if (this.__tiUrl) outgoingFromRequest(this.__tiUrl, body); } catch { /* ignore */ }
      return xs.apply(this, arguments);
    };
    try { Object.defineProperty(open, "__ti", { value: true }); } catch { /* ignore */ }
    X.prototype.open = open; X.prototype.send = send;
  }

  wrapFetch(window, "");
  wrapXhr(window, "");

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
    if (!found) return occupancyDeep(raw);
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

  function occupancyDeep(raw) {
    let o = null, budget = 300;
    (function walk(x, depth) {
      if (o || depth > 7 || --budget < 0) return;
      if (typeof x === "string") { if (x.length > 1 && (x[0] === "{" || x[0] === "[")) walk(safe(x), depth + 1); return; }
      if (!x || typeof x !== "object") return;
      if (typeof x.occupancy === "number") { o = x; return; }
      for (const k in x) walk(x[k], depth + 1);
    })(raw, 0);
    return o ? { kind: "occupancy", o: { ts: Date.now(), listeners: o.occupancy, total: o.total_participants || null } } : null;
  }
  function outgoingDeep(d) {
    let e = null, budget = 200;
    (function walk(x, depth) {
      if (e || depth > 6 || --budget < 0) return;
      if (typeof x === "string") { if (x.length > 1 && (x[0] === "{" || x[0] === "[")) walk(safe(x), depth + 1); return; }
      if (!x || typeof x !== "object") return;
      if (x.type === 2 && typeof x.body === "string" && x.body.length <= 16 && EMOJI_ISH.test(x.body)) { e = x.body; return; }
      for (const k in x) walk(x[k], depth + 1);
    })(d, 0);
    return e;
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
  const diag = { sockets: [], hooked: 0, frames: 0, parsed: 0, recent: [], sse: [], workers: [], rtc: 0, channels: [], wmsgs: 0, wsamples: [], wout: [], chat: null, frames_: 0, streams: [], streamSamples: [], sentSamples: [], subframes: [], own: { status: "idle", opens: 0, frames: 0 }, binSamples: [], dcMsgs: 0, id3: { chunks: 0, frames: 0, samples: [] }, poll: { via: null, http: null, keys: null, total: 0, kept: 0, baseline: 0, rounds: 0, lastError: null, samples: [] } };
  function note(dir, text) {
    diag.recent.push(dir + " " + String(text).slice(0, 700));
    if (diag.recent.length > 60) diag.recent.shift();
  }
  const dec = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;
  function toText(d) { // string, Promise<string> (Blob) or null
    if (typeof d === "string") return d;
    try {
      // tag checks instead of instanceof: data from a hidden frame or worker comes from another realm
      const tag = Object.prototype.toString.call(d);
      if (dec && tag === "[object ArrayBuffer]") return dec.decode(new Uint8Array(d));
      if (dec && ArrayBuffer.isView(d)) return dec.decode(d);
      if (tag === "[object Blob]" && typeof d.text === "function") return d.text();
    } catch { /* unreadable frame */ }
    return null;
  }
  const spaceFromUrl = () => { const m = location.pathname.match(/\/i\/spaces\/([A-Za-z0-9]+)/); return m ? m[1] : null; };

  function looksNative(fn, name) {
    try {
      Object.defineProperty(fn, "name", { value: name });
      fn.toString = function () { return `function ${name}() { [native code] }`; };
    } catch { /* ignore */ }
  }
  function installWs(win, where) {
    const Native = win.WebSocket;
    if (!Native || Native.__ti) return;
    function Patched(url, protocols) {
      const ws = protocols !== undefined ? new Native(url, protocols) : new Native(url);
      try {
        const clean = String(url).split("?")[0];
        if (diag.sockets.length < 30) diag.sockets.push(where + " " + clean);
        if (!IS_TOP) toTop({ note: "socket " + clean });
        if (CHAT_WS.test(clean)) hook(ws);
      } catch { /* never break the page */ }
      return ws;
    }
    Patched.prototype = Native.prototype;
    ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach((k) => (Patched[k] = Native[k]));
    looksNative(Patched, "WebSocket");
    try { Object.defineProperty(Patched, "__ti", { value: true }); } catch { /* ignore */ }
    win.WebSocket = Patched;
  }
  installWs(window, "page");

  // X can open the chat from a hidden frame to get an untouched WebSocket. Follow it into same-origin frames.
  function patchFrame(w) {
    try {
      if (!w || w === window || w.__tiFrame) return;
      void w.document; // throws for cross-origin frames: leave those alone
      Object.defineProperty(w, "__tiFrame", { value: true });
      diag.frames_++;
      installWs(w, "frame");
      wrapFetch(w, "frame");
      wrapXhr(w, "frame");
    } catch { /* cross-origin or gone */ }
  }
  try {
    const cw = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
    if (cw && cw.get) {
      Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
        configurable: true, enumerable: cw.enumerable,
        get() { const w = cw.get.call(this); patchFrame(w); return w; },
      });
    }
    const cd = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentDocument");
    if (cd && cd.get) {
      Object.defineProperty(HTMLIFrameElement.prototype, "contentDocument", {
        configurable: true, enumerable: cd.enumerable,
        get() { const d = cd.get.call(this); try { patchFrame(d && d.defaultView); } catch { /* ignore */ } return d; },
      });
    }
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n && n.tagName === "IFRAME") patchFrame(cw.get.call(n));
        else if (n && n.querySelectorAll) for (const f of n.querySelectorAll("iframe")) patchFrame(cw.get.call(f));
      }
    }).observe(document, { childList: true, subtree: true });
  } catch { /* ignore */ }

  // ---------- other transports X could use for the chat ----------
  try {
    const NWT = window.WebTransport;
    if (NWT) {
      const T = function (url, opts) {
        try { const u = "webtransport " + String(url).split("?")[0]; diag.sockets.push(u); if (!IS_TOP) toTop({ note: u }); } catch { /* ignore */ }
        return opts !== undefined ? new NWT(url, opts) : new NWT(url);
      };
      T.prototype = NWT.prototype; Object.setPrototypeOf(T, NWT); looksNative(T, "WebTransport");
      window.WebTransport = T;
    }
  } catch { /* ignore */ }
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

  // ---------- binary / embedded data (X's side channels and the audio stream) ----------
  function bytesOf(d) { // Uint8Array, Promise<Uint8Array> (Blob) or null
    try {
      const tag = Object.prototype.toString.call(d);
      if (tag === "[object ArrayBuffer]") return new Uint8Array(d);
      if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
      if (tag === "[object Blob]" && typeof d.arrayBuffer === "function") return d.arrayBuffer().then((b) => new Uint8Array(b));
      if (typeof d === "string") return new TextEncoder().encode(d);
    } catch { /* ignore */ }
    return null;
  }
  function previewBytes(u8) {
    let printable = 0; const n = Math.min(u8.length, 400);
    for (let i = 0; i < n; i++) { const c = u8[i]; if ((c >= 32 && c < 127) || c === 10 || c === 13 || c >= 0xc2) printable++; }
    if (n && printable / n > 0.85) return "text " + new TextDecoder().decode(u8.subarray(0, 300));
    let hex = ""; for (let i = 0; i < Math.min(u8.length, 48); i++) hex += u8[i].toString(16).padStart(2, "0");
    const strs = (new TextDecoder("latin1").decode(u8.subarray(0, 2000)).match(/[\x20-\x7e]{6,}/g) || []).slice(0, 6).join(" | ");
    return "hex " + hex + (strs ? " strings: " + strs.slice(0, 250) : "");
  }
  // pull {...} JSON objects out of any text (e.g. JSON wrapped inside a binary message)
  function extractJsons(text, max) {
    const out = []; let i = 0; max = max || 20;
    while (out.length < max && (i = text.indexOf("{", i)) >= 0) {
      let depth = 0, inStr = false, esc = false, j = i;
      for (; j < text.length && j - i < 50000; j++) {
        const c = text[j];
        if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}") { if (--depth === 0) break; }
      }
      if (depth === 0 && j < text.length) { const o = safe(text.slice(i, j + 1)); if (o && typeof o === "object") { out.push(o); i = j + 1; continue; } }
      i++;
    }
    return out;
  }
  const binSeen = { n: 0 };
  function binaryFrame(u8, src, label) {
    try {
      binSeen.n++;
      const text = new TextDecoder().decode(u8);
      const trimmed = text.trim();
      const jsons = (trimmed[0] === "{" || trimmed[0] === "[") && safe(trimmed) ? [safe(trimmed)] : extractJsons(text);
      if (diag.binSamples.length < 25 && !/Hydra(Participants|AudioLevel)|JSONMetadata/.test(label + " " + text.slice(0, 40))) {
        const smp = src + " " + (label || "") + " " + u8.length + "B json:" + jsons.length + " " + previewBytes(u8).slice(0, 400);
        diag.binSamples.push(smp);
        if (!IS_TOP) toTop({ note: "sample " + smp.slice(0, 190) });
      }
      for (const o of jsons) {
        if (o && o.UserName && o.UserId) { remember(o.UserId, o.UserName); continue; }
        let ev = null; try { ev = parse(JSON.stringify(o)); } catch { ev = null; }
        if (ev) handle(ev, src);
      }
    } catch { /* ignore */ }
  }
  // HLS audio chunks can carry ID3 tags with timed data (captions, events). Read their text.
  function id3Texts(u8) {
    const out = [];
    try {
      let off = 0;
      while (off + 10 <= u8.length && u8[off] === 0x49 && u8[off + 1] === 0x44 && u8[off + 2] === 0x33) { // "ID3"
        const ver = u8[off + 3];
        const size = (u8[off + 6] << 21) | (u8[off + 7] << 14) | (u8[off + 8] << 7) | u8[off + 9];
        let p = off + 10; const end = Math.min(u8.length, off + 10 + size);
        while (p + 10 <= end) {
          const id = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
          if (!/^[A-Z0-9]{4}$/.test(id)) break;
          const fsz = ver >= 4 ? ((u8[p + 4] << 21) | (u8[p + 5] << 14) | (u8[p + 6] << 7) | u8[p + 7]) : ((u8[p + 4] << 24) | (u8[p + 5] << 16) | (u8[p + 6] << 8) | u8[p + 7]);
          const body = u8.subarray(p + 10, Math.min(end, p + 10 + fsz));
          out.push({ id, body });
          p += 10 + fsz;
        }
        off = end;
      }
    } catch { /* ignore */ }
    return out;
  }
  function audioChunk(u8, label) {
    const frames = id3Texts(u8);
    diag.id3.chunks++;
    for (const f of frames) {
      diag.id3.frames++;
      const text = new TextDecoder().decode(f.body).replace(/\u0000/g, " ");
      if (diag.id3.samples.length < 12 && !diag.id3.samples.some((x) => x.startsWith(f.id + " " + text.slice(0, 30)))) diag.id3.samples.push(f.id + " " + text.slice(0, 300));
      if (/[{]/.test(text)) binaryFrame(f.body, "id3", f.id);
    }
  }

  function watchChannel(ch) {
    try {
      if (diag.channels.length < 20) diag.channels.push(ch.label || "(no label)");
      if (!IS_TOP) toTop({ note: "datachannel " + (ch.label || "(no label)") });
      ch.addEventListener("message", (e) => {
        diag.dcMsgs++;
        const b = bytesOf(e.data);
        if (b && typeof b.then === "function") b.then((u8) => binaryFrame(u8, "dc", ch.label), () => {});
        else if (b) binaryFrame(b, "dc", ch.label);
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

  // X now runs the Space chat inside background workers. We can't reach inside them, but the reactions have to
  // come back to the page to be shown, so we listen to what workers send the page. Passive: nothing is changed.
  function sample(list, dir, d, cap) {
    if (list.length >= cap) return;
    let t;
    try {
      t = typeof d === "string" ? d : JSON.stringify(d, (k, v) =>
        (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) ? `[bin ${v.byteLength}]` :
        (typeof v === "string" && v.length > 300) ? v.slice(0, 300) + "…" :
        (Array.isArray(v) && v.length > 20) ? v.slice(0, 20).concat(["…" + v.length]) : v);
    } catch { t = Object.prototype.toString.call(d); }
    t = dir + " " + String(t).slice(0, 700);
    const sig = t.slice(0, 90);
    if (!list.some((x) => x.slice(0, 90) === sig)) list.push(t);
  }
  function fromWorker(d, label) {
    diag.wmsgs++;
    try {
      if (Object.prototype.toString.call(d) === "[object ArrayBuffer]" || ArrayBuffer.isView(d)) {
        if ((d.byteLength || 0) > 65536) return; // audio and other bulk data
        const t = toText(d); if (typeof t === "string") onFrame(t, label);
        return;
      }
      if (typeof d === "string") { onFrame(d, label); return; }
      if (!d || typeof d !== "object") return;
      sample(diag.wsamples, "in:" + label, d, 40);
      handle(parseDeep(d), label);
    } catch { /* never break the page */ }
  }
  function toWorker(d, label) {
    try {
      sample(diag.wout, "out:" + label, d, 15);
      const t = typeof d === "string" ? d : null;
      const emoji = state.room && (t ? outgoingReaction(t) : outgoingDeep(d));
      if (emoji) {
        const me = self();
        selfSent.push({ emoji, ts: Date.now() }); if (selfSent.length > 50) selfSent.shift();
        addReaction({ ts: Date.now(), emoji, username: me.username, displayName: me.displayName, userId: me.id });
        render();
      }
    } catch { /* ignore */ }
  }
  for (const k of ["Worker", "SharedWorker"]) {
    try {
      const N = window[k];
      if (!N) continue;
      const Wk = function (url, opts) {
        const w = opts !== undefined ? new N(url, opts) : new N(url);
        try {
          const n = diag.workers.length;
          const label = (k === "Worker" ? "w" : "sw") + n;
          if (n < 20) diag.workers.push(label + " " + String(url).split("?")[0].slice(0, 200));
          const target = k === "SharedWorker" ? w.port : w;
          target.addEventListener("message", (e) => fromWorker(e.data, label)); // fires once X starts the port
          const op = target.postMessage;
          target.postMessage = function (msg) { toWorker(msg, label); return op.apply(this, arguments); };
        } catch { /* ignore */ }
        return w;
      };
      Wk.prototype = N.prototype;
      Object.setPrototypeOf(Wk, N);
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
    // anything that arrived a moment before we knew which Space this is
    const held = pendingEvents.splice(0); for (const [ev, src] of held) handle(ev, src);
  }
  const pendingEvents = [];

  function hook(ws) {
    diag.hooked++;
    if (IS_TOP && ownChat.ws) ownChat.stop("X opened the chat itself");
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
    handle(ev, src);
  }

  function handle(ev, src) {
    if (!ev) return;
    if (!IS_TOP) { toTop({ ev, src: "subframe" }); return; }
    diag.parsed++;
    if (src && !state.connected) { state.connected = true; ui(); }
    if (!state.room) joinRoom(spaceFromUrl() || joinedHint || lastMetaKey); // X didn't announce the room: use the Space we're on
    if (!state.room) { if (pendingEvents.length < 500) pendingEvents.push([ev, src]); return; } // hold until we know the Space
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
  let viewerMe = null;
  const VIEWER_URL = /\/graphql\/[^/]+\/(Viewer|ViewerUser|useViewer)\b|viewer_context\.json|account\/settings\.json|useSubscriptionsPaymentFailureQuery|useFetchProductSubscriptionsQuery/i;
  function onViewer(j) {
    try {
      const d = j && (j.data || j);
      const v = d && (d.viewer || d.viewer_v2 || d.viewer_context);
      const r = v && v.user_results && v.user_results.result;
      let id = r && r.rest_id ? String(r.rest_id) : null;
      if (!id && r && typeof r.id === "string") { try { const m = atob(r.id).match(/^User:(\d+)$/); if (m) id = m[1]; } catch { /* ignore */ } }
      const handle = r && ((r.core && r.core.screen_name) || (r.legacy && r.legacy.screen_name)) || (j && j.screen_name) || null;
      const name = r && ((r.core && r.core.name) || (r.legacy && r.legacy.name)) || null;
      if (handle && id) remember(id, handle, name);
      const keep = viewerMe && !viewerMe.id ? viewerMe : null; // a handle we learned before we knew the id
      if (id && (!viewerMe || viewerMe.id !== id || (handle && !viewerMe.username))) viewerMe = { id, username: handle || (keep && keep.username) || (ids.get(id) || {}).username || null, displayName: name || (keep && keep.displayName) || (ids.get(id) || {}).displayName || null };
      else if (!id && handle && (!viewerMe || !viewerMe.username)) viewerMe = Object.assign(viewerMe || { id: null }, { username: handle });
    } catch { /* ignore */ }
  }
  function self() {
    if (viewerMe && (viewerMe.id || viewerMe.username)) {
      const k = viewerMe.id && ids.get(viewerMe.id);
      return { id: viewerMe.id, username: viewerMe.username || (k && k.username) || null, displayName: viewerMe.displayName || (k && k.displayName) || null };
    }
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

  if (IS_TOP) window.addEventListener("message", (e) => {
    try {
      if (!e.data || !e.data[SUB] || e.source === window || !ALLOWED_SUB_ORIGIN.test(e.origin)) return;
      if (e.data.note) { if (diag.subframes.length < 60) diag.subframes.push(e.origin + " " + String(e.data.note).slice(0, 200)); return; }
      if (e.data.ev && (e.data.ev.kind === "reaction" || e.data.ev.kind === "occupancy")) handle(e.data.ev, "subframe");
    } catch { /* ignore */ }
  });
  if (!IS_TOP) toTop({ note: "loaded " + location.origin + location.pathname });

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || !e.data[TAG] || e.data.dir !== "in") return;
    if (e.data.type === "chatframe" && ownChat.cfg) {
      const t = String(e.data.data || ""); const m = safe(t);
      if (!firstTime(m ? msgKey(m) : t)) return;
      diag.own.frames++; if (!state.connected) { state.connected = true; render(); }
      onFrame(t, "own"); return;
    }
    if (e.data.type === "chathistory" && ownChat.cfg) {
      const d = e.data.data || {};
      diag.poll.http = d.status; if (d.error) diag.poll.lastError = String(d.error).slice(0, 120);
      if (d.json) { const wait = ownChat.afterPage(d.json); if (wait < 3000) { clearTimeout(ownChat.pollTimer); ownChat.pollTimer = setTimeout(() => ownChat.poll(), wait); } }
      return;
    }
    if (e.data.type === "chatstatus") { diag.own.status = String(e.data.data || "").slice(0, 160); if (/^closed|^gave up/.test(diag.own.status) && state.connected && !diag.hooked && !ownChat.cfg) { state.connected = false; render(); } return; }
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
    if (root || !IS_TOP) return;
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
      v: "tappedin-1.20", page: location.pathname, room: state.room, connected: state.connected, count: state.count,
      sockets: diag.sockets, hooked: diag.hooked, frames: diag.frames, parsed: diag.parsed,
      http: httpSeen, streams: diag.streams, fromStreams: diag.streamSamples, sent: diag.sentSamples, sse: diag.sse, workers: diag.workers, rtc: diag.rtc, channels: diag.channels,
      chat: diag.chat, ownChat: diag.own, poll: { ...diag.poll, samples: diag.poll.samples.filter((x) => x.bt !== 40 && x.bt !== 45).slice(0, 15) }, dcMsgs: diag.dcMsgs, binSamples: diag.binSamples, audio: diag.id3, me: (() => { const m = self(); return m.username ? "@" + m.username : (m.id ? "id " + m.id : null); })(), meFrom: viewerMe ? "x viewer" : "cookie", joinedHint, hiddenFrames: diag.frames_, subframes: diag.subframes,
      iframes: [...document.querySelectorAll("iframe")].slice(0, 20).map((f) => (f.getAttribute("src") || "(no src)").split("?")[0].slice(0, 150) + (f.getAttribute("sandbox") != null ? " [sandbox]" : "")), wmsgs: diag.wmsgs, fromWorkers: diag.wsamples, toWorkers: diag.wout,
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
    statusEl.textContent = (!diag.hooked && !state.connected && !state.room)
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
