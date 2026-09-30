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

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !msg.hw || !msg.data || !msg.data.room) return;
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
    const hasWork = b.reactions.length || b.occupancy.length || b.names.size || b.ended || b.dirty;
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
          p_reactions: reactions, p_occupancy: occupancy, p_ended: ended, p_names: names,
        }),
      });
      if (res.ok) {
        b.dirty = false;
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
