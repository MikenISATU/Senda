import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { bad, body, forbidden, ok, route } from "@/lib/server/http";
import { db, must } from "@/lib/server/supabase";

/**
 * Registers a file the client uploaded via a signed URL. The server downloads
 * it and computes the SHA-256 itself (evidence integrity never trusts the client).
 */
export const POST = route(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const c = await requireUser(req);
  const m = await db().from("conversation_members").select("profile_id").eq("conversation_id", id).eq("profile_id", c.profile.id).maybeSingle();
  if (!m.data) throw forbidden();
  const b = await body(req, z.object({ path: z.string(), fileName: z.string().max(120), mime: z.string().max(100) }));
  if (!b.path.startsWith(`${id}/`)) throw bad("Invalid path");
  const dl = await db().storage.from("chat-attachments").download(b.path);
  if (dl.error || !dl.data) throw bad("Upload not found");
  const buf = Buffer.from(await dl.data.arrayBuffer());
  if (buf.length === 0 || buf.length > 26214400) throw bad("Invalid file size");
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const row = must(await db().from("attachments").insert({ conversation_id: id, uploader_id: c.profile.id, storage_path: b.path, file_name: b.fileName, mime: b.mime, size_bytes: buf.length, sha256 }).select("id, file_name, mime, size_bytes, sha256").single());
  return ok(row);
});
