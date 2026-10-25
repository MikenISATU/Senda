import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { bad, body, forbidden, ok, rateLimit, route } from "@/lib/server/http";
import { db, must, PUBLIC_PROFILE_FIELDS } from "@/lib/server/supabase";

type Ctx = { params: Promise<{ id: string }> };

async function member(convId: string, profileId: string) {
  const m = await db().from("conversation_members").select("profile_id").eq("conversation_id", convId).eq("profile_id", profileId).maybeSingle();
  if (!m.data) throw forbidden();
}

export const GET = route(async (req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const c = await requireUser(req);
  await member(id, c.profile.id);
  const after = req.nextUrl.searchParams.get("after");
  let q = db().from("messages").select("id, sender_id, kind, body, created_at").eq("conversation_id", id).order("created_at", { ascending: true }).limit(200);
  if (after) q = q.gt("created_at", after);
  const msgs = must(await q) as { id: string }[];
  const atts = msgs.length ? (must(await db().from("attachments").select("id, message_id, file_name, mime, size_bytes, sha256, is_evidence").in("message_id", msgs.map((m) => m.id))) as { message_id: string }[]) : [];
  const reqs = msgs.length ? (must(await db().from("payment_requests").select("id, message_id, requester_id, payer_id, asset, amount, note, status, tx_hash").in("message_id", msgs.map((m) => m.id))) as { message_id: string }[]) : [];
  const conv = must(await db().from("conversations").select("id, kind, job_id, jobs(title, status)").eq("id", id).single());
  const people = must(await db().from("conversation_members").select(`profile:profiles(${PUBLIC_PROFILE_FIELDS})`).eq("conversation_id", id)) as unknown as { profile: unknown }[];
  await db().from("conversation_members").update({ last_read_at: new Date().toISOString() }).eq("conversation_id", id).eq("profile_id", c.profile.id);
  return ok({ conversation: conv, members: people.map((p) => p.profile), messages: msgs.map((m) => ({ ...m, attachments: atts.filter((a) => a.message_id === m.id), request: reqs.find((r) => r.message_id === m.id) ?? null })) });
});

export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  const { id } = await params;
  const c = await requireUser(req);
  await member(id, c.profile.id);
  await rateLimit(`msg:${c.profile.id}`, 40, 60);
  const b = await body(req, z.object({ body: z.string().trim().max(4000).default(""), attachmentIds: z.array(z.string().uuid()).max(5).default([]) }));
  if (!b.body && !b.attachmentIds.length) throw bad("Empty message");
  const msg = must(await db().from("messages").insert({ conversation_id: id, sender_id: c.profile.id, body: b.body }).select("id, sender_id, kind, body, created_at").single()) as { id: string };
  if (b.attachmentIds.length) {
    await db().from("attachments").update({ message_id: msg.id }).in("id", b.attachmentIds).eq("conversation_id", id).eq("uploader_id", c.profile.id).is("message_id", null);
  }
  const others = must(await db().from("conversation_members").select("profile_id").eq("conversation_id", id).neq("profile_id", c.profile.id)) as { profile_id: string }[];
  if (others.length) await db().from("notifications").insert(others.map((o) => ({ profile_id: o.profile_id, type: "message", actor_id: c.profile.id, entity_type: "conversation", entity_id: id, body: "sent you a message" })));
  return ok(msg);
});
