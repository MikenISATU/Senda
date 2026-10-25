import "server-only";
import { db } from "./supabase";
import { paiflow, workflowId, WORKFLOW_KEYS } from "./paiflow";

/**
 * Pulls Paiflow events for every configured deployment, dedupes on eventId,
 * and marks an event verified only if Paiflow's transaction lookup reports the
 * original hash as SUCCESS. Events alone never trigger payouts in Senda.
 */
export async function ingestPaiflowEvents(maxPages = 5) {
  const pf = paiflow();
  if (!pf) return { skipped: "not configured" };
  const keys = WORKFLOW_KEYS;
  const out: Record<string, number> = {};
  for (const k of keys) {
    const dep = workflowId(k);
    if (!dep) continue;
    const ck = `paiflow:${dep}`;
    let cursor = (await db().from("sync_cursors").select("cursor").eq("key", ck).maybeSingle()).data?.cursor as string | undefined;
    let n = 0;
    for (let i = 0; i < maxPages; i++) {
      const page = await pf.events(dep, { cursor, limit: 100 });
      for (const ev of page.items) {
        let verified = false;
        try {
          verified = (await pf.lookupStatus(dep, ev.txHash)).status === "SUCCESS";
        } catch {
          verified = false;
        }
        const { error } = await db().from("ledger_events").insert({
          source: "paiflow", event_id: ev.eventId, contract_id: dep, tx_hash: ev.txHash, ledger: ev.ledger, topic: `${ev.kind}:${ev.topic}`,
          data: { ...ev.data, workflow: k, occurredAt: ev.occurredAt, verified },
        });
        if (!error) n++;
      }
      if (page.nextCursor) {
        cursor = page.nextCursor;
        await db().from("sync_cursors").upsert({ key: ck, cursor, updated_at: new Date().toISOString() });
      }
      if (!page.hasMore) break;
    }
    out[k] = n;
  }
  return out;
}
