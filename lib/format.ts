export const fmtNum = (n: number) => new Intl.NumberFormat("en-US").format(n);

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  // guard against spreadsheet formula injection from user-controlled names
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCSV(rows: unknown[][]) {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}
