"use client";

import { ImagePlus, Lock, X } from "lucide-react";
import { useRef, useState } from "react";
import { Notice } from "@/components/ui/bits";
import { useSession } from "@/lib/client/session";
import type { Post } from "@/lib/client/types";
import { uploadFile } from "@/lib/client/upload";

type Pending = { file: File; premium: boolean };

export function Composer({ onPosted }: { onPosted: (p: Post) => void }) {
  const { api, profile } = useSession();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<Pending[]>([]);
  const [premium, setPremium] = useState(false);
  const [price, setPrice] = useState("1");
  const [asset, setAsset] = useState<"USDC" | "XLM">("USDC");
  const [premiumBody, setPremiumBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const media = [];
      for (const f of files) {
        const isPremium = premium && f.premium;
        const s = await uploadFile(api, f.file, isPremium ? "premium" : "post").catch((e: Error) => {
          throw new Error(`Couldn't upload ${f.file.name}: ${e.message}. Photos must be JPG, PNG, WebP or GIF; videos MP4; up to 25 MB.`);
        });
        media.push({ path: s.path, bucket: s.bucket, mime: f.file.type, size: f.file.size });
      }
      const post = await api<Post>("/api/posts", { body: { body, media, ...(premium ? { premium: { price, asset, body: premiumBody } } : {}) } });
      onPosted(post);
      setBody(""); setFiles([]); setPremium(false); setPremiumBody("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form id="compose" onSubmit={submit} className="mx-4 mb-4 scroll-mt-24 rounded-3xl bg-white p-4 ring-1 ring-line md:mx-6 md:p-5" aria-label="New post">
      <label htmlFor="post-body" className="sr-only">What's happening</label>
      <textarea id="post-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={3}
        placeholder={`Share something, @${profile?.username}`} className="field min-h-24 resize-y border-transparent bg-cloud py-3 text-base" />
      {files.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-sm ring-1 ring-line">
              {premium && f.premium && <Lock size={13} aria-label="Premium" />}
              <span className="max-w-40 truncate">{f.file.name}</span>
              {premium && (
                <button type="button" className="text-xs text-cobalt-deep underline" onClick={() => setFiles(files.map((x, j) => (j === i ? { ...x, premium: !x.premium } : x)))}>
                  {f.premium ? "Make free" : "Make premium"}
                </button>
              )}
              <button type="button" aria-label={`Remove ${f.file.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      {premium && (
        <div className="mt-3 space-y-3 rounded-xl bg-white p-3 ring-1 ring-line">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-32">
              <label className="label" htmlFor="price">Price</label>
              <input id="price" className="field tabular" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="asset">Asset</label>
              <select id="asset" className="field" value={asset} onChange={(e) => setAsset(e.target.value as "USDC" | "XLM")}><option>USDC</option><option>XLM</option></select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="pbody">Unlocked content</label>
            <textarea id="pbody" className="field min-h-20 py-2.5" value={premiumBody} onChange={(e) => setPremiumBody(e.target.value)} placeholder="Only buyers see this" />
            <p className="hint">The text above stays public as a teaser. Buyers unlock this and any premium files.</p>
          </div>
        </div>
      )}
      {err && <div className="mt-2"><Notice tone="danger">{err}</Notice></div>}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,application/pdf,application/zip" multiple hidden
            onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? []).slice(0, 4 - files.length).map((file) => ({ file, premium: premium }))]); e.target.value = ""; }} />
          <button type="button" className="btn-ghost px-3" onClick={() => input.current?.click()} disabled={files.length >= 4}><ImagePlus size={18} aria-hidden /> <span className="hidden sm:inline">Media</span></button>
          <button type="button" className={`btn-ghost px-3 ${premium ? "bg-cobalt-soft" : ""}`} aria-pressed={premium} onClick={() => setPremium(!premium)}><Lock size={18} aria-hidden /> Premium</button>
        </div>
        <button className="btn-primary" disabled={busy || (!body.trim() && !files.length && !premium)}>{busy ? "Posting" : "Post"}</button>
      </div>
    </form>
  );
}
