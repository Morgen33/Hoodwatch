export type Summary = {
  total: number;
  unique: number;
  bucket_secs: number;
  leaderboard: { username: string; display_name: string | null; total: number; emojis: Record<string, number> }[];
  emojis: { emoji: string; n: number }[];
  timeline: { t: string; n: number }[];
  occupancy: { t: string; n: number }[];
};

export type Giveaway = {
  id: string;
  emoji_filter: string | null;
  min_reactions: number;
  entrants: string[];
  winner_username: string | null;
  seed: string;
  drawn_at: string;
};
