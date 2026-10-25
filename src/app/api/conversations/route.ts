import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { bad, body, notFound, ok, rateLimit, route } from "@/lib/server/http";
import { db, must, PUBLIC_PROFILE_FIELDS } from "@/lib/server/supabase";

export const GET = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  const mine = must(await db().from("conversation_members").select("conversation_id, last_read_at").eq("profile_id", c.profile.id)) as { conversation_id: string; last_read_at: string | null }[];
  if (!mine.length) return ok([]);
  const ids = mine.map((m) => m.conversation_id);
  const convs = must(await db().from("conversations").select("id, kind, job_id, last_message_at, jobs(title, status)").in("id", ids).order("last_message_at", { ascending: false })) as unknown as { id: string; kind: string; job_id: string | null; last_message_at: string; jobs: { title: string; status: string } | null }[];
  const members = must(await db().from("conversation_members").select(`conversation_id, profile:profiles(${PUBLIC_PROFILE_FIELDS})`).in("conversation_id", ids).neq("profile_id", c.profile.id)) as unknown as { conversation_id: string; profile: unknown }[];
  const last = await Promise.all(ids.map((id) => db().from("messages").select("body, kind, created_at").eq("conversation_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle()));
  return ok(
    convs.map((cv) => {
      const lr = mine.find((m) => m.conversation_id === cv.id)?.last_read_at;
      const lm = last[ids.indexOf(cv.id)]?.data;
      return { ...cv, others: members.filter((m) => m.conversation_id === cv.id).map((m) => m.profile), lastMessage: lm ?? null, unread: !!lm && (!lr || new Date(lm.created_at) > new Date(lr)) };
    }),
  );
});

/** Opens (or reuses) a direct conversation with another user. */
export const POST = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  await rateLimit(`dm:${c.profile.id}`, 20, 60);
  const b = await body(req, z.object({ username: z.string() }));
  const t = await db().from("profiles").select("id").eq("username", b.username.replace(/^@/, "").toLowerCase()).eq("is_banned", false).maybeSingle();
  if (!t.data) throw notFound("User not found");
  if (t.data.id === c.profile.id) throw bad("That's you.");
  const key = [c.profile.id, t.data.id].sort().join(":");
  const existing = await db().from("conversations").select("id").eq("dm_key", key).maybeSingle();
  if (existing.data) return ok({ id: existing.data.id });
  const conv = must(await db().from("conversations").insert({ kind: "dm", dm_key: key }).select("id").single()) as { id: string };
  must(await db().from("conversation_members").insert([{ conversation_id: conv.id, profile_id: c.profile.id }, { conversation_id: conv.id, profile_id: t.data.id }]));
  return ok({ id: conv.id });
});
