import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { body, ok, route } from "@/lib/server/http";
import { db, must } from "@/lib/server/supabase";

const Body = z.object({
  displayName: z.string().trim().min(1).max(50).optional(),
  bio: z.string().trim().max(280).optional(),
  avatarPath: z.string().regex(/^avatars\/[0-9a-f-]{36}\/[\w.-]+$/).optional(),
});

export const PATCH = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  const b = await body(req, Body);
  const patch: Record<string, string> = {};
  if (b.displayName !== undefined) patch.display_name = b.displayName;
  if (b.bio !== undefined) patch.bio = b.bio;
  if (b.avatarPath) {
    if (!b.avatarPath.startsWith(`avatars/${c.profile.id}/`)) throw new Error("bad path");
    patch.avatar_url = db().storage.from("avatars").getPublicUrl(b.avatarPath.replace(/^avatars\//, "")).data.publicUrl;
  }
  const p = must(await db().from("profiles").update(patch).eq("id", c.profile.id).select("*").single());
  return ok(p);
});
