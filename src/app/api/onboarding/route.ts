import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { body, conflict, ok, rateLimit, route } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";

const RESERVED = new Set(["admin", "senda", "support", "help", "api", "settings", "wallet", "jobs", "explore", "home", "login", "earn", "messages", "mediator", "system", "root"]);
const Body = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,20}$/, "3 to 20 characters: a-z, 0-9 or underscore"),
  displayName: z.string().trim().min(1).max(50),
});

export const POST = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  await rateLimit(`onboarding:${c.profile.id}`, 20, 60);
  const b = await body(req, Body);
  if (RESERVED.has(b.username)) throw conflict("That username is reserved.");
  if (c.profile.username && c.profile.username !== b.username) throw conflict("Your username is already set.");
  const { error } = await db()
    .from("profiles")
    .update({ username: b.username, display_name: b.displayName, onboarded_at: c.profile.onboarded_at ?? new Date().toISOString() })
    .eq("id", c.profile.id);
  if (error?.code === "23505") throw conflict("That username is taken.");
  if (error) throw new Error(error.message);
  return ok({ username: b.username });
});
