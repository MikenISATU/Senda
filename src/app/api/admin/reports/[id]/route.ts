import { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole, requireUser } from "@/lib/server/auth";
import { audit, body, notFound, ok, route } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";

export const POST = route(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const c = await requireUser(req);
  requireRole(c, "admin");
  const b = await body(req, z.object({ action: z.enum(["dismiss", "hide", "ban"]) }));
  const r = await db().from("moderation_reports").select("*").eq("id", id).maybeSingle();
  if (!r.data) throw notFound();
  if (b.action === "hide") {
    if (r.data.entity_type === "post") await db().from("posts").update({ status: "hidden" }).eq("id", r.data.entity_id);
    if (r.data.entity_type === "comment") await db().from("comments").update({ status: "removed" }).eq("id", r.data.entity_id);
  }
  if (b.action === "ban" && r.data.entity_type === "profile") await db().from("profiles").update({ is_banned: true }).eq("id", r.data.entity_id);
  await db().from("moderation_reports").update({ status: b.action === "dismiss" ? "dismissed" : "actioned", resolved_by: c.profile.id, resolved_at: new Date().toISOString() }).eq("id", id);
  await audit(c.profile.id, `moderation.${b.action}`, r.data.entity_type, r.data.entity_id, { reportId: id });
  return ok({ done: true });
});
