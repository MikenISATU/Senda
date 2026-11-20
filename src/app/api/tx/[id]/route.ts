import { NextRequest } from "next/server";
import { requireUser } from "@/lib/server/auth";
import { bad, ok, route } from "@/lib/server/http";
import { loadIntent, publicIntent, refreshIntent } from "@/lib/server/intents";

/** Status of an intent. A submitted intent is re-checked against the network. */
export const GET = route(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw bad("Invalid id");
  const c = await requireUser(req);
  const intent = await loadIntent(id, c.profile.id);
  return ok(intent.status === "submitted" ? await refreshIntent(intent) : publicIntent(intent));
});
