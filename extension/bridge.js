// Isolated-world relay: page (hook.js) <-> background service worker.
const TAG = "__hoodwatch__";

window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || !e.data[TAG] || e.data.dir !== "out") return;
  try {
    chrome.runtime.sendMessage({ hw: true, type: e.data.type, data: e.data.data });
  } catch {
    // extension was reloaded; page needs a refresh
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.hw && msg.type === "sync") {
    window.postMessage({ [TAG]: true, dir: "in", type: "sync", data: msg.status }, "*");
  }
  if (msg && msg.hw && (msg.type === "chatframe" || msg.type === "chatstatus" || msg.type === "chathistory")) {
    window.postMessage({ [TAG]: true, dir: "in", type: msg.type, data: msg.data }, window.location.origin);
  }
});
