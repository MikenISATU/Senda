import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { bad, body, forbidden, ok, rateLimit, route } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";

const IMAGE = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const RULES = {
  post: { bucket: "public-media", mimes: [...IMAGE, "video/mp4"], max: 25 * 1024 * 1024 },
  premium: { bucket: "premium-media", mimes: [...IMAGE, "video/mp4", "application/pdf", "application/zip"], max: 25 * 1024 * 1024 },
  avatar: { bucket: "avatars", mimes: ["image/png", "image/jpeg", "image/webp"], max: 2 * 1024 * 1024 },
  chat: { bucket: "chat-attachments", mimes: null, max: 25 * 1024 * 1024 },
} as const;

const Body = z.object({
  purpose: z.enum(["post", "premium", "avatar", "chat"]),
  fileName: z.string().min(1).max(120),
  mime: z.string().min(3).max(100),
  size: z.number().int().positive(),
  conversationId: z.string().uuid().optional(),
});

/** Issues a one-time signed upload URL for a server-chosen path. Clients never pick paths. */
export const POST = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  await rateLimit(`upload:${c.profile.id}`, 30, 300);
  const b = await body(req, Body);
  const rule = RULES[b.purpose];
  if (b.size > rule.max) throw bad(`File too large (max ${Math.round(rule.max / 1048576)} MB)`);
  if (rule.mimes && !(rule.mimes as readonly string[]).includes(b.mime)) throw bad("Unsupported file type");
  if (/^(text\/html|image\/svg|application\/(x-)?javascript)/i.test(b.mime)) throw bad("Unsupported file type");
  const safe = b.fileName.replace(/[^\w.-]/g, "_").slice(-80);
  let path: string;
  if (b.purpose === "chat") {
    if (!b.conversationId) throw bad("conversationId required");
    const m = await db().from("conversation_members").select("profile_id").eq("conversation_id", b.conversationId).eq("profile_id", c.profile.id).maybeSingle();
    if (!m.data) throw forbidden();
    path = `${b.conversationId}/${randomUUID()}-${safe}`;
  } else {
    path = `${c.profile.id}/${randomUUID()}-${safe}`;
  }
  const r = await db().storage.from(rule.bucket).createSignedUploadUrl(path);
  if (r.error) throw new Error(r.error.message);
  return ok({ bucket: rule.bucket, path, token: r.data.token, signedUrl: r.data.signedUrl, avatarPath: b.purpose === "avatar" ? `avatars/${path}` : undefined });
});
