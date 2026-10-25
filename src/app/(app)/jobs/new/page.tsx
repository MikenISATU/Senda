"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/app/AppShell";
import { Notice } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";

export default function NewJob() {
  const { api } = useSession();
  const router = useRouter();
  const [f, setF] = useState({ title: "", role: "", description: "", budget: "", asset: "USDC", deadline: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="mx-auto w-full max-w-[780px] px-4 md:px-6">
      <PageHeader flush title="Post a job" />
      <form className="sheet space-y-4 p-5" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(null);
        try {
          const j = await api<{ id: string }>("/api/jobs", { body: { ...f, role: f.role || undefined, deadline: new Date(f.deadline).toISOString() } });
          router.push(`/jobs/${j.id}`);
        } catch (x) { setErr((x as Error).message); setBusy(false); }
      }}>
        <div><label className="label" htmlFor="t">Title</label><input id="t" className="field" value={f.title} onChange={set("title")} minLength={4} maxLength={120} required /></div>
        <div><label className="label" htmlFor="r">Role</label><input id="r" className="field" value={f.role} onChange={set("role")} maxLength={60} placeholder="e.g. Illustrator, Rust developer" /></div>
        <div><label className="label" htmlFor="d">What needs doing</label><textarea id="d" className="field min-h-32 py-2.5" value={f.description} onChange={set("description")} minLength={10} maxLength={5000} required /><p className="hint">Be specific about deliverables. The freelancer's proof is checked against this.</p></div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <div><label className="label" htmlFor="b">Budget</label><input id="b" className="field tabular" inputMode="decimal" value={f.budget} onChange={set("budget")} required /></div>
          <div><label className="label" htmlFor="a">Asset</label><select id="a" className="field" value={f.asset} onChange={set("asset")}><option>USDC</option><option>XLM</option></select></div>
        </div>
        <div><label className="label" htmlFor="dl">Deadline</label><input id="dl" type="datetime-local" className="field" value={f.deadline} onChange={set("deadline")} required /><p className="hint">If no proof arrives by the deadline, you can reclaim the escrow in full.</p></div>
        {err && <Notice tone="danger">{err}</Notice>}
        <button className="btn-primary" disabled={busy}>{busy ? "Posting" : "Post job"}</button>
      </form>
    </div>
  );
}
