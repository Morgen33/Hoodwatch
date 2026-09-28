"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { fmtTime } from "@/lib/format";

type Pt = { t: string; n: number };

// Validated for the dark surface (#141418): lightness band, chroma, CVD & contrast all pass.
const REACTIONS = "#6f9a1c";
const LISTENERS = "#5f86e6";
const H = 120;
const PAD = { l: 36, r: 12, t: 10, b: 22 };

export function Timeline({ timeline, occupancy, bucketSecs }: { timeline: Pt[]; occupancy: Pt[]; bucketSecs: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [hover, setHover] = useState<number | null>(null); // x in ms

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => {
    const step = bucketSecs * 1000;
    const tl = timeline.map((p) => ({ t: +new Date(p.t), n: p.n }));
    const oc = occupancy.map((p) => ({ t: +new Date(p.t), n: p.n }));
    const all = [...tl.map((p) => p.t), ...oc.map((p) => p.t)];
    if (!all.length) return null;
    const t0 = Math.min(...all);
    const t1 = Math.max(...all, t0 + step) + step;
    // fill empty buckets so quiet stretches show as gaps, not missing bars
    const byT = new Map(tl.map((p) => [p.t, p.n]));
    const bars: { t: number; n: number }[] = [];
    if (tl.length) for (let t = tl[0].t; t <= tl[tl.length - 1].t; t += step) bars.push({ t, n: byT.get(t) ?? 0 });
    return { t0, t1, step, bars, oc, maxR: Math.max(1, ...bars.map((b) => b.n)), maxL: Math.max(1, ...oc.map((o) => o.n)) };
  }, [timeline, occupancy, bucketSecs]);

  if (!data) {
    return <div className="card muted text-sm">The timeline fills in once reactions start coming in.</div>;
  }

  const iw = w - PAD.l - PAD.r;
  const x = (t: number) => PAD.l + ((t - data.t0) / (data.t1 - data.t0)) * iw;
  const barW = Math.max(1, (data.step / (data.t1 - data.t0)) * iw - 2); // 2px surface gap between bars
  const ticks = Array.from({ length: 5 }, (_, i) => data.t0 + ((data.t1 - data.t0) * i) / 4);

  const hoverBar = hover == null ? null : data.bars.find((b) => hover >= b.t && hover < b.t + data.step) ?? null;
  const hoverOcc = hover == null || !data.oc.length ? null
    : data.oc.reduce((best, o) => (Math.abs(o.t - hover) < Math.abs(best.t - hover) ? o : best), data.oc[0]);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    if (px < PAD.l || px > w - PAD.r) return setHover(null);
    setHover(data!.t0 + ((px - PAD.l) / iw) * (data!.t1 - data!.t0));
  }

  const axis = (max: number) => (
    <>
      {[0, 0.5, 1].map((f) => {
        const y = PAD.t + (H - PAD.t - PAD.b) * (1 - f);
        return (
          <g key={f}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y} y2={y} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y + 4} textAnchor="end" fontSize={10} fill="var(--muted)">{Math.round(max * f)}</text>
          </g>
        );
      })}
      {ticks.map((t) => (
        <text key={t} x={x(t)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--muted)">{fmtTime(new Date(t).toISOString())}</text>
      ))}
    </>
  );
  const crosshair = hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeDasharray="3 3" />;
  const yR = (n: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - n / data.maxR);
  const yL = (n: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - n / data.maxL);

  return (
    <div className="card" ref={wrap}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-bold">When it popped off</div>
        <div className="text-sm muted h-5">
          {hover != null && (
            <>
              {fmtTime(new Date(hover).toISOString())} · <b style={{ color: "var(--text)" }}>{hoverBar?.n ?? 0}</b> reactions
              {hoverOcc && <> · <b style={{ color: "var(--text)" }}>{hoverOcc.n}</b> listening</>}
            </>
          )}
        </div>
      </div>

      <div className="mt-3 text-xs muted">Reactions per {bucketSecs >= 120 ? `${Math.round(bucketSecs / 60)} min` : "minute"}</div>
      <svg width={w} height={H} className="block" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label="Reactions over time">
        {axis(data.maxR)}
        {data.bars.map((b) => {
          const y = yR(b.n);
          const h = H - PAD.b - y;
          return h > 0 ? (
            <path key={b.t} fill={REACTIONS} opacity={hoverBar && hoverBar.t !== b.t ? 0.55 : 1}
              d={`M${x(b.t) + 1},${H - PAD.b} v${-(h - Math.min(4, h))} q0,-${Math.min(4, h)} ${Math.min(4, barW / 2)},-${Math.min(4, h)} h${barW - 2 * Math.min(4, barW / 2)} q${Math.min(4, barW / 2)},0 ${Math.min(4, barW / 2)},${Math.min(4, h)} v${h - Math.min(4, h)} z`} />
          ) : null;
        })}
        {crosshair}
      </svg>

      {data.oc.length > 0 && (
        <>
          <div className="mt-4 text-xs muted">Listeners</div>
          <svg width={w} height={H} className="block" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label="Listeners over time">
            {axis(data.maxL)}
            <polyline fill="none" stroke={LISTENERS} strokeWidth={2} strokeLinejoin="round"
              points={data.oc.map((o) => `${x(o.t)},${yL(o.n)}`).join(" ")} />
            {crosshair}
            {hoverOcc && <circle cx={x(hoverOcc.t)} cy={yL(hoverOcc.n)} r={4} fill={LISTENERS} stroke="var(--panel)" strokeWidth={2} />}
          </svg>
        </>
      )}

      <details className="mt-3 text-sm">
        <summary className="muted cursor-pointer">Show as table</summary>
        <table className="tbl mt-2">
          <thead><tr><th>Time</th><th>Reactions</th></tr></thead>
          <tbody>
            {data.bars.filter((b) => b.n > 0).map((b) => (
              <tr key={b.t}><td>{fmtTime(new Date(b.t).toISOString())}</td><td>{b.n}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
