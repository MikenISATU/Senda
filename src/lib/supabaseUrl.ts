/**
 * Normalises the Supabase project URL to its origin, so a value copied with a
 * path (e.g. ".../rest/v1/") or a trailing slash still works everywhere.
 */
export function supabaseOrigin(raw: string | undefined | null): string {
  if (!raw) return "";
  try {
    return new URL(raw.trim()).origin;
  } catch {
    return raw.trim().replace(/\/+$/, "");
  }
}
