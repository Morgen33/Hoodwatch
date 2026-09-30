const keyEl = document.getElementById("key");
const statusEl = document.getElementById("status");

const setStatus = (text, good) => { statusEl.textContent = text; statusEl.style.color = good ? "#c6ff3d" : "#ff4d6d"; };

chrome.storage.local.get("hwKey").then(({ hwKey }) => {
  if (hwKey) { keyEl.value = hwKey; setStatus("✓ Key saved. Open a Space to start tracking.", true); }
});

document.getElementById("save").addEventListener("click", async () => {
  const key = keyEl.value.trim();
  if (!/^hw_[0-9a-f]{48}$/.test(key)) return setStatus("That doesn't look like a Tapped In key (starts with hw_).");
  setStatus("Checking…", true);
  const res = await chrome.runtime.sendMessage({ hwPopup: "test", key });
  if (res && res.invalid) return setStatus("Key not recognized — generate a new one on your dashboard.");
  await chrome.storage.local.set({ hwKey: key });
  setStatus(res && res.ok ? "✓ Connected! Open a Space to start tracking." : "Saved, but couldn't reach Tapped In right now.", !!(res && res.ok));
});
