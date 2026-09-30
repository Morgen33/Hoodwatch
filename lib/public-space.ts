import { createClient } from "@supabase/supabase-js";
import { cache } from "react";
import { SUPABASE_KEY, SUPABASE_URL } from "./supabase/env";

export type PublicSpace = {
  found: true;
  title: string | null;
  space_id: string;
  started_at: string;
  ended_at: string | null;
  last_activity: string;
  live: boolean;
  peak_listeners: number;
  host: { handle: string | null; name: string | null; avatar: string | null };
  total: number;
  unique: number;
  emojis: { emoji: string; n: number; people: number }[];
  leaderboard: { username: string; display_name: string | null; total: number; emojis: Record<string, number> }[];
};

// Anonymous read: the public page never depends on who's looking at it.
export const getPublicSpace = cache(async (slug: string): Promise<PublicSpace | null> => {
  if (!/^[a-f0-9]{6,32}$/.test(slug)) return null;
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const { data } = await sb.rpc("public_space", { p_slug: slug });
  return data && (data as { found: boolean }).found ? (data as PublicSpace) : null;
});
