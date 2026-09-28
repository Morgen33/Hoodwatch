// Public values — safe to ship to the browser. Access is enforced by RLS in Postgres.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://gyspxodpxmpzxwskrbia.supabase.co";
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_KNOxGoWipYH1TY31lGw9gA_76OQ3t5S";
