"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseOrigin } from "../supabaseUrl";

let anon: SupabaseClient | null = null;

/** Anon client. Used only for signed uploads and (with a Senda-minted JWT) RLS-protected realtime reads. */
export function supabaseBrowser(): SupabaseClient | null {
  const url = supabaseOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!anon) anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return anon;
}
