// Buffers events per Space and flushes them to Tapped In every few seconds.
const SUPABASE_URL = "https://gyspxodpxmpzxwskrbia.supabase.co";
const SUPABASE_KEY = "sb_publishable_KNOxGoWipYH1TY31lGw9gA_76OQ3t5S"; // public key; the per-host token is what authorizes writes
const FLUSH_MS = 4000;

// room -> { title, reactions: [], occupancy: [], ended: false, tabId }
const buffers = new Map();
let timer = null;

function buf(room) {
  if (!buffers.has(room)) buffers.set(room, { title: null, reactions: [], occupancy: [], names: new Map(), ended: false, tabs: new Set() });
  return buffers.get(room);
}

// ---------- read-only Space chat connection ----------
// x.com's page is no longer allowed to connect to X's chat servers, so the extension does it here with the chat
// pass X issued to the signed-in user. It authenticates, joins the room and only listens; frames go to the tab.
const chats = new Map(); // tabId -> { ws, room, endpoint, token, tries, timer, stopped }
const CHAT_HOST = /^https:\/\/[a-z0-9.-]+\.pscp\.tv\/?$/i;

function chatStatus(tabId, text) { chrome.tabs.sendMessage(tabId, { hw: true, type: "chatstatus", data: text }).catch(() => {}); }

function chatOpen(tabId, { endpoint, token, room }) {
  if (!CHAT_HOST.test(endpoint || "") || !token || !room) return;
  const cur = chats.get(tabId);
  if (cur && !cur.stopped && cur.room === room) { cur.token = token; return; } // already on it
  chatClose(tabId);
  const c = { room, endpoint, token, tries: 0, timer: null, stopped: false, ws: null };
  chats.set(tabId, c);
  chatConnect(tabId, c);
}

function chatConnect(tabId, c) {
  if (c.stopped) return;
  const url = c.endpoint.replace(/^https:/i, "wss:").replace(/\/$/, "") + "/chatapi/v1/chatnow";
  let ws;
  try { ws = new WebSocket(url); } catch (e) { chatStatus(tabId, "blocked: " + String(e && e.message || e).slice(0, 120)); return; }
  c.ws = ws;
  chatStatus(tabId, "connecting");
  ws.onopen = () => {
    ws.send(JSON.stringify({ payload: JSON.stringify({ access_token: c.token }), kind: 3 }));
    ws.send(JSON.stringify({ payload: JSON.stringify({ body: JSON.stringify({ room: c.room }), kind: 1 }), kind: 2 }));
    c.tries = 0;
    chatStatus(tabId, "listening");
  };
  ws.onmessage = async (e) => {
    let t = e.data;
    if (typeof t !== "string") { try { t = typeof t.text === "function" ? await t.text() : new TextDecoder().decode(t); } catch { return; } }
    chrome.tabs.sendMessage(tabId, { hw: true, type: "chatframe", data: t }).catch(() => chatClose(tabId));
  };
  ws.onclose = (e) => {
    if (c.ws === ws) c.ws = null;
    if (c.stopped) return;
    c.codes = (c.codes || []).concat(e.code + (e.reason ? ":" + String(e.reason).slice(0, 60) : "")).slice(-6);
    chatStatus(tabId, "closed " + e.code + (e.reason ? " " + String(e.reason).slice(0, 80) : ""));
    if (c.tries < 2) { const wait = 2000 * Math.pow(2, c.tries++); c.timer = setTimeout(() => chatConnect(tabId, c), wait); }
    else chatStatus(tabId, "gave up (close codes: " + c.codes.join(", ") + ")");
  };
}

function chatClose(tabId) {
  const c = chats.get(tabId);
  if (!c) return;
  c.stopped = true; clearTimeout(c.timer);
  if (c.ws) { try { c.ws.close(1000, "done"); } catch { /* ignore */ } }
  chats.delete(tabId);
}
chrome.tabs.onRemoved.addListener((tabId) => chatClose(tabId));

// Ask X's chat server for messages since the last cursor (used when the page can't read the reply itself).
async function chatPoll(tabId, { endpoint, token, cursor, since }) {
  if (!CHAT_HOST.test(endpoint || "") || !token) return;
  let out;
  try {
    const r = await fetch(endpoint.replace(/\/$/, "") + "/chatapi/v1/history", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_token: token, cursor: cursor || "", limit: 1000, quick_get: true, since }),
    });
    const json = await r.json().catch(() => null);
    out = { status: r.status, json: r.ok ? json : null, error: r.ok ? null : "http " + r.status };
  } catch (e) { out = { status: 0, error: String(e && e.message || e) }; }
  chrome.tabs.sendMessage(tabId, { hw: true, type: "chathistory", data: out }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !msg.hw || !msg.data || !msg.data.room) return;
  if (msg.type === "chatpoll") {
    if (sender.tab && sender.frameId === 0) chatPoll(sender.tab.id, msg.data);
    return;
  }
  if (msg.type === "chatopen" || msg.type === "chatclose") {
    if (sender.tab && sender.frameId === 0) msg.type === "chatopen" ? chatOpen(sender.tab.id, msg.data) : chatClose(sender.tab.id);
    return;
  }
  const b = buf(msg.data.room);
  if (sender.tab) b.tabs.add(sender.tab.id);
  const { room: _room, ...d } = msg.data;
  if (msg.type === "join") { b.title = d.title || b.title; b.ended = false; b.dirty = true; }
  if (msg.type === "reaction") b.reactions.push(d);
  if (msg.type === "occupancy") {
    // keep at most one sample every 15s
    const last = b.occupancy[b.occupancy.length - 1] || b.lastOcc;
    if (!last || d.ts - last.ts > 15000) b.occupancy.push(d);
  }
  if (msg.type === "leave") b.ended = true;
  if (msg.type === "name") b.names.set(d.userId, d);
  if (msg.type === "meta" && d.meta) { b.meta = d.meta; b.metaDirty = true; if (d.meta.title) b.title = d.meta.title; }
  if (msg.type === "names" && Array.isArray(d.names)) for (const n of d.names.slice(0, 2000)) b.names.set(n.userId, n);
  schedule();
});

function schedule() {
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

function tell(tabs, status) {
  for (const id of tabs) chrome.tabs.sendMessage(id, { hw: true, type: "sync", status }).catch(() => {});
}

async function flush() {
  timer = null;
  const { hwKey } = await chrome.storage.local.get("hwKey");
  for (const [room, b] of buffers) {
    const hasWork = b.reactions.length || b.occupancy.length || b.names.size || b.ended || b.dirty || b.metaDirty;
    if (!hasWork) continue;
    if (!hwKey) { tell(b.tabs, "nokey"); continue; }

    const reactions = b.reactions.splice(0, 1000);
    const occupancy = b.occupancy.splice(0, 200);
    const names = [...b.names.values()].slice(0, 2000);
    for (const n of names) b.names.delete(n.userId);
    const ended = b.ended;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ingest_events`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({
          p_token: hwKey, p_space_id: room, p_title: b.title,
          p_reactions: reactions, p_occupancy: occupancy, p_ended: ended, p_names: names, p_meta: b.metaDirty ? b.meta : null,
        }),
      });
      if (res.ok) {
        b.dirty = false;
        b.metaDirty = false;
        if (occupancy.length) b.lastOcc = occupancy[occupancy.length - 1];
        if (ended) { tell(b.tabs, "ok"); buffers.delete(room); continue; }
        tell(b.tabs, "ok");
      } else {
        const text = await res.text();
        if (/invalid token|bad token/.test(text)) {
          tell(b.tabs, "badkey"); b.reactions.unshift(...reactions); b.occupancy.unshift(...occupancy);
          for (const n of names) b.names.set(n.userId, n);
          continue;
        }
        throw new Error(text);
      }
    } catch {
      // put them back and retry next round
      b.reactions.unshift(...reactions);
      b.occupancy.unshift(...occupancy);
      for (const n of names) if (!b.names.has(n.userId)) b.names.set(n.userId, n);
      tell(b.tabs, "error");
    }
    if (b.reactions.length || b.occupancy.length || b.names.size) schedule();
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.hwPopup === "test") {
    fetch(`${SUPABASE_URL}/rest/v1/rpc/ingest_events`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}` },
      // a bad space id makes the function stop right after checking the key, so nothing is written
      body: JSON.stringify({ p_token: msg.key, p_space_id: "!" }),
    })
      .then((r) => r.text())
      .then((t) => reply({ ok: /bad space id/.test(t), invalid: /invalid token|bad token/.test(t) }))
      .catch(() => reply({ ok: false }));
    return true;
  }
});
