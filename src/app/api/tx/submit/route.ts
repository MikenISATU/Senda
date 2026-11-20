import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { body, ok, rateLimit, route } from "@/lib/server/http";
import { submitIntent } from "@/lib/server/intents";

const Body = z.object({ intentId: z.string().uuid(), signature: z.string().regex(/^0x[0-9a-fA-F]{128}$/) });

export const POST = route(async (req: NextRequest) => {
  const c = await requireUser(req);
  await rateLimit(`submit:${c.profile.id}`, 30, 60);
  const b = await body(req, Body);
  return ok(await submitIntent(c, b.intentId, b.signature));
});
