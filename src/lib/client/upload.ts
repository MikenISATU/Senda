"use client";

import { supabaseBrowser } from "./supabase";

type Signed = { bucket: string; path: string; token: string; avatarPath?: string };

/** Server picks the path and issues a one-time signed upload; the browser uploads straight to storage. */
export async function uploadFile(api: <T>(p: string, i?: { body?: unknown }) => Promise<T>, file: File, purpose: "post" | "premium" | "avatar" | "chat", conversationId?: string) {
  const signed = await api<Signed>("/api/uploads", { body: { purpose, fileName: file.name, mime: file.type || "application/octet-stream", size: file.size, conversationId } });
  const sb = supabaseBrowser();
  if (!sb) throw new Error("Storage is not configured");
  const { error } = await sb.storage.from(signed.bucket).uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type || "application/octet-stream" });
  if (error) throw new Error(error.message);
  return signed;
}
