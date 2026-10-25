import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireWallet } from "@/lib/server/auth";
import { buildActionTx, syncEscrow } from "@/lib/server/escrow";
import { bad, body, forbidden, ok, rateLimit, route } from "@/lib/server/http";
import { createIntent } from "@/lib/server/intents";
import { ensureJobConversation, loadJob } from "@/lib/server/jobs";
import { db, must } from "@/lib/server/supabase";

/**
 * Freelancer submits proof of work. The evidence snapshot (attachment SHA-256s +
 * note) is hashed; the hash is recorded on-chain via submit_proof, and the
 * snapshot is posted to the job chat. Neither step pays anyone.
 */
export const POST = route(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const c = await requireUser(req);
  const signer = requireWallet(c);
  await rateLimit(`proof:${c.profile.id}`, 10, 60);
  const b = await body(req, z.object({ note: z.string().trim().min(1).max(2000), attachmentIds: z.array(z.string().uuid()).max(10).default([]) }));
  const job = await loadJob(id);
  if (job.freelancer_id !== c.profile.id) throw forbidden();
  const onchain = await syncEscrow(id);
  if (!onchain || !["Funded", "RevisionRequested"].includes(onchain.status)) throw bad("Proof can be submitted once the escrow is funded (or after a revision request).");
  const convId = await ensureJobConversation(job);
  const atts = b.attachmentIds.length
    ? (must(await db().from("attachments").select("id, file_name, sha256, conversation_id, uploader_id").in("id", b.attachmentIds)) as { id: string; file_name: string; sha256: string | null; conversation_id: string; uploader_id: string }[])
    : [];
  if (atts.length !== b.attachmentIds.length || atts.some((a) => a.conversation_id !== convId || !a.sha256 || a.uploader_id !== c.profile.id)) {
    throw bad("Evidence must be files you uploaded to this job's chat.");
  }
  const snapshot = { jobId: id, note: b.note, files: atts.map((a) => ({ name: a.file_name, sha256: a.sha256 })).sort((x, y) => x.sha256!.localeCompare(y.sha256!)) };
  const proofHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  const esc = must(await db().from("escrows").select("escrow_key").eq("job_id", id).single()) as { escrow_key: string };
  const tx = await buildActionTx(signer, esc.escrow_key, { action: "submit_proof", proofHash });
  return ok(
    await createIntent({
      caller: c, kind: "escrow_action", provider: "soroban", tx,
      // The proof message is posted to chat only after the hash is confirmed on-chain.
      payload: { jobId: id, action: "submit_proof", proofHash, note: b.note, attachmentIds: atts.map((a) => a.id), freelancerId: c.profile.id, conversationId: convId },
      summary: { title: "Record proof of work on-chain", lines: [{ label: "Evidence hash", value: `${proofHash.slice(0, 16)}...` }, { label: "Files", value: String(atts.length) }, { label: "Payment", value: "Not released by this step" }] },
    }),
  );
});
