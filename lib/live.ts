// A Space counts as live if it hasn't been marked ended and something happened in the last 10 minutes.
// (Closing a tab doesn't always send the "ended" signal, so quiet Spaces time out on their own.)
export const LIVE_WINDOW_MS = 10 * 60 * 1000;

export function isLive(endedAt: string | null, lastActivityAt: string | null) {
  if (endedAt) return false;
  if (!lastActivityAt) return false;
  return Date.now() - new Date(lastActivityAt).getTime() < LIVE_WINDOW_MS;
}
