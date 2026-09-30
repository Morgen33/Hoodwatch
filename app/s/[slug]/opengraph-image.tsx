import { ImageResponse } from "next/og";
import { getPublicSpace } from "@/lib/public-space";

export const alt = "Space leaderboard on Tapped In";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The preview card X shows when someone posts the leaderboard link.
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = await getPublicSpace(slug);
  const top = s?.leaderboard.slice(0, 5) ?? [];
  const emojis = s?.emojis.slice(0, 6) ?? [];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#0b0b0d", color: "#ededf0", padding: 52, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 26 }}>
          <div style={{ display: "flex", fontWeight: 900 }}>tapped<span style={{ color: "#c6ff3d" }}>in</span></div>
          <div style={{ display: "flex", color: s?.live ? "#c6ff3d" : "#8b8b96" }}>{s?.live ? "● LIVE" : "FINAL RESULTS"}</div>
        </div>
        <div style={{ display: "flex", marginTop: 18, fontSize: 50, fontWeight: 900, lineHeight: 1.05 }}>{(s?.title || "X Space").slice(0, 60)}</div>
        <div style={{ display: "flex", marginTop: 10, fontSize: 24, color: "#8b8b96", gap: 24 }}>
          <span>{(s?.total ?? 0).toLocaleString()} reactions</span>
          <span>{(s?.unique ?? 0).toLocaleString()} reactors</span>
          {s?.host.handle && <span>hosted by @{s.host.handle}</span>}
        </div>
        <div style={{ display: "flex", gap: 22, marginTop: 20, fontSize: 30 }}>
          {emojis.map((e) => (
            <div key={e.emoji} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span>{e.emoji}</span><span style={{ fontSize: 22, color: "#8b8b96" }}>{e.n.toLocaleString()}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 22, gap: 8 }}>
          {top.map((u, i) => (
            <div key={u.username} style={{ display: "flex", alignItems: "center", background: "#141418", border: "1px solid #26262e", borderRadius: 12, padding: "8px 18px", fontSize: 26 }}>
              <span style={{ color: "#8b8b96", width: 50 }}>#{i + 1}</span>
              <span style={{ fontWeight: 800 }}>@{u.username}</span>
              <span style={{ marginLeft: "auto", fontWeight: 800 }}>{u.total.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
