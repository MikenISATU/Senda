"use client";

import { CheckCircle2, FileCheck2, HandCoins, Paperclip, Send, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Notice, Spinner, timeAgo } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";
import { supabaseBrowser } from "@/lib/client/supabase";
import type { PreparedIntent, PublicProfile } from "@/lib/client/types";
import { useTx } from "@/lib/client/useTx";
import { uploadFile } from "@/lib/client/upload";

type Att = { id: string; file_name: string; mime: string; size_bytes: number; sha256: string | null; is_evidence: boolean };
type PayReq = { id: string; requester_id: string; payer_id: string; asset: "XLM" | "USDC"; amount: string; note: string; status: "open" | "paid" | "declined" | "cancelled"; tx_hash: string | null };
type M = { id: string; sender_id: string | null; kind: "text" | "proof" | "system" | "request"; body: string; created_at: string; attachments: Att[]; request?: PayReq | null };
type R = { conversation: { id: string; kind: string; job_id: string | null; jobs: { title: string; status: string } | null }; members: PublicProfile[]; messages: M[] };

/** Per-conversation chat. Realtime via Supabase (RLS-scoped JWT) when configured, else 4s polling. */
export function Chat({ id, onAttachmentsReady }: { id: string; onAttachmentsReady?: (atts: Att[]) => void }) {
  const { api, profile, supabaseToken } = useSession();
  const [data, setData] = useState<R | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Att[]>([]);
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const { run } = useTx();
  const [asking, setAsking] = useState(false);
  const [reqAmount, setReqAmount] = useState("");
  const [reqAsset, setReqAsset] = useState<"USDC" | "XLM">("USDC");
  const [reqNote, setReqNote] = useState("");

  const load = useCallback(async () => {
    try { setData(await api<R>(`/api/conversations/${id}/messages`)); } catch (e) { setErr((e as Error).message); }
  }, [api, id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [data?.messages.length]);

  useEffect(() => {
    const sb = supabaseBrowser();
    if (sb && supabaseToken) {
      sb.realtime.setAuth(supabaseToken);
      const ch = sb.channel(`conv:${id}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${id}` }, () => load()).subscribe();
      return () => { sb.removeChannel(ch); };
    }
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [id, load, supabaseToken]);

  useEffect(() => { onAttachmentsReady?.(pending); }, [pending, onAttachmentsReady]);

  async function attach(files: FileList | null) {
    if (!files) return;
    setBusy(true); setErr(null);
    try {
      for (const f of Array.from(files).slice(0, 5)) {
        const s = await uploadFile(api, f, "chat", id);
        const a = await api<Att>(`/api/conversations/${id}/attachments`, { body: { path: s.path, fileName: f.name, mime: f.type || "application/octet-stream" } });
        setPending((p) => [...p, a]);
      }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() && !pending.length) return;
    setBusy(true);
    try {
      await api(`/api/conversations/${id}/messages`, { body: { body: text, attachmentIds: pending.map((p) => p.id) } });
      setText(""); setPending([]); load();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  async function requestMoney(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api(`/api/conversations/${id}/requests`, { body: { amount: reqAmount, asset: reqAsset, note: reqNote } });
      setAsking(false); setReqAmount(""); setReqNote(""); load();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  async function act(r: PayReq, action: "pay" | "decline" | "cancel") {
    setErr(null);
    if (action === "pay") {
      run(() => api<PreparedIntent>(`/api/requests/${r.id}`, { body: { action, idempotencyKey: crypto.randomUUID() } }), { onConfirmed: () => setTimeout(load, 600) });
      return;
    }
    try { await api(`/api/requests/${r.id}`, { body: { action } }); load(); } catch (x) { setErr((x as Error).message); }
  }

  async function open(a: Att) {
    const r = await api<{ url: string }>(`/api/attachments/${a.id}`);
    window.open(r.url, "_blank", "noopener");
  }

  if (!data) return err ? <Notice tone="danger">{err}</Notice> : <div className="p-6"><Spinner label="Loading messages" /></div>;
  const name = (sid: string | null) => data.members.find((m) => m.id === sid)?.username;

  return (
    <div className="flex min-h-[60dvh] flex-col">
      {data.conversation.jobs && (
        <Link href={`/jobs/${data.conversation.job_id}`} className="block border-b border-line bg-white px-4 py-2 text-sm hover:underline md:px-6">
          Job: <b>{data.conversation.jobs.title}</b> <span className="text-slate">({data.conversation.jobs.status.replaceAll("_", " ").toLowerCase()})</span>
        </Link>
      )}
      <ol className="flex-1 space-y-3 px-4 py-4 md:px-6" aria-live="polite">
        {data.messages.length === 0 && <li className="text-center text-slate">Say hello.</li>}
        {data.messages.map((m) => {
          const mine = m.sender_id === profile?.id;
          if (m.kind === "system") return <li key={m.id} className="text-center text-sm text-slate">{m.body}</li>;
          if (m.kind === "request" && m.request) {
            const q = m.request;
            const iPay = q.payer_id === profile?.id;
            return (
              <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className="w-full max-w-[320px] rounded-3xl bg-white p-4 ring-1 ring-line">
                  <p className="flex items-center gap-1.5 text-sm text-slate"><HandCoins size={15} aria-hidden /> {mine ? "You requested" : `@${name(m.sender_id)} requested`}</p>
                  <p className="tabular mt-1 font-display text-3xl font-bold">{Number(q.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 7 })} <span className="text-base font-semibold text-slate">{q.asset}</span></p>
                  {q.note && <p className="mt-1 break-words text-sm text-ink">{q.note}</p>}
                  <div className="mt-3">
                    {q.status === "paid" ? (
                      <p className="inline-flex items-center gap-1.5 rounded-full bg-mint-soft px-3 py-1 text-sm font-semibold text-mint-deep"><CheckCircle2 size={15} aria-hidden /> Paid</p>
                    ) : q.status !== "open" ? (
                      <p className="inline-flex rounded-full bg-cloud px-3 py-1 text-sm font-semibold text-slate">{q.status === "declined" ? "Declined" : "Cancelled"}</p>
                    ) : iPay ? (
                      <div className="flex gap-2">
                        <button type="button" className="btn-primary flex-1" onClick={() => act(q, "pay")}>Pay</button>
                        <button type="button" className="btn-outline" onClick={() => act(q, "decline")}>Decline</button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-slate">Waiting for payment</span>
                        <button type="button" className="btn-ghost px-3 text-sm" onClick={() => act(q, "cancel")}>Cancel</button>
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-slate">{timeAgo(m.created_at)} ago</p>
                </div>
              </li>
            );
          }
          return (
            <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 ${m.kind === "proof" ? "bg-mint-soft ring-1 ring-mint" : mine ? "bg-cobalt text-white" : "bg-white ring-1 ring-line"}`}>
                {m.kind === "proof" && <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-mint-deep"><FileCheck2 size={15} aria-hidden /> Proof of work</p>}
                {m.body && <p className="whitespace-pre-wrap break-words">{m.kind === "proof" ? m.body.replace(/^Proof of work\n/, "") : m.body}</p>}
                {m.attachments.map((a) => (
                  <button key={a.id} onClick={() => open(a)} className={`mt-1 block text-left text-sm underline ${mine && m.kind !== "proof" ? "text-white" : "text-cobalt-deep"}`}>
                    {a.file_name} <span className="opacity-75">({Math.ceil(a.size_bytes / 1024)} KB{a.sha256 ? `, sha256 ${a.sha256.slice(0, 8)}` : ""})</span>
                  </button>
                ))}
                <p className={`mt-0.5 text-[11px] ${mine && m.kind !== "proof" ? "text-white/75" : "text-slate"}`}>{mine ? "You" : `@${name(m.sender_id)}`}, {timeAgo(m.created_at)} ago</p>
              </div>
            </li>
          );
        })}
        <div ref={bottom} />
      </ol>
      {err && <div className="px-4"><Notice tone="danger">{err}</Notice></div>}
      <form onSubmit={send} className="sticky bottom-16 border-t border-line bg-cloud px-4 py-3 md:bottom-0 md:px-6">
        {pending.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-2">
            {pending.map((a) => <li key={a.id} className="flex items-center gap-1 rounded-full bg-white px-3 py-1 text-sm ring-1 ring-line">{a.file_name}<button type="button" aria-label={`Remove ${a.file_name}`} onClick={() => setPending(pending.filter((x) => x.id !== a.id))}><X size={14} /></button></li>)}
          </ul>
        )}
        {asking && (
          <div className="mb-3 rounded-2xl bg-white p-3 ring-1 ring-line">
            <p className="mb-2 text-sm font-semibold">Request money</p>
            <div className="grid gap-2 sm:grid-cols-[8rem_6.5rem_1fr]">
              <label htmlFor="req-amt" className="sr-only">Amount</label>
              <input id="req-amt" className="field tabular" inputMode="decimal" placeholder="0.00" value={reqAmount} onChange={(e) => setReqAmount(e.target.value)} />
              <label htmlFor="req-asset" className="sr-only">Currency</label>
              <select id="req-asset" className="field" value={reqAsset} onChange={(e) => setReqAsset(e.target.value as "USDC" | "XLM")}><option>USDC</option><option>XLM</option></select>
              <label htmlFor="req-note" className="sr-only">What it's for</label>
              <input id="req-note" className="field" placeholder="What's it for? (optional)" maxLength={140} value={reqNote} onChange={(e) => setReqNote(e.target.value)} />
            </div>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-primary" disabled={busy || !reqAmount} onClick={requestMoney}>Send request</button>
              <button type="button" className="btn-ghost" onClick={() => setAsking(false)}>Cancel</button>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          {data.members.length === 2 && (
            <button type="button" className="btn-outline px-3" aria-label="Request money" aria-expanded={asking} onClick={() => setAsking((v) => !v)}><HandCoins size={18} /></button>
          )}
          <label className="btn-outline cursor-pointer px-3" aria-label="Attach files"><Paperclip size={18} /><input type="file" multiple className="sr-only" onChange={(e) => { attach(e.target.files); e.target.value = ""; }} /></label>
          <label htmlFor="msg" className="sr-only">Message</label>
          <input id="msg" className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message" maxLength={4000} autoComplete="off" />
          <button className="btn-primary px-4" disabled={busy} aria-label="Send"><Send size={18} /></button>
        </div>
      </form>
    </div>
  );
}
