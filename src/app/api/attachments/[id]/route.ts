import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { forbidden, notFound, ok, route } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";

/** Short-lived signed download URL, only for conversation members (and mediators on job chats). */
export const GET = route(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const c = await requireUser(req);
  const a = await db().from("attachments").select("storage_path, conversation_id, file_name").eq("id", id).maybeSingle();
  if (!a.data) throw notFound();
  const m = await db().from("conversation_members").select("profile_id").eq("conversation_id", a.data.conversation_id).eq("profile_id", c.profile.id).maybeSingle();
  if (!m.data) {
    // Mediators may open evidence only in job chats whose job is in dispute. Never DMs.
    if (!["mediator", "admin"].includes(c.profile.role)) throw forbidden();
    const conv = await db().from("conversations").select("kind, jobs(status)").eq("id", a.data.conversation_id).maybeSingle();
    const job = (conv.data as unknown as { kind: string; jobs: { status: string } | null } | null);
    if (job?.kind !== "job" || job.jobs?.status !== "DISPUTED") throw forbidden();
  }
  const s = await db().storage.from("chat-attachments").createSignedUrl(a.data.storage_path, 300, { download: a.data.file_name });
  if (s.error) throw new Error(s.error.message);
  return ok({ url: s.data.signedUrl, expiresIn: 300 });
});
