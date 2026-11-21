"use client";

import { ActionError } from "@/components/ui/Dialogs";
import { Gem, ImagePlus, X } from "lucide-react";
import { useRef, useState } from "react";
import { useSession } from "@/lib/client/session";
import type { Post } from "@/lib/client/types";
import { uploadFile } from "@/lib/client/upload";


export function Composer({ onPosted }: { onPosted: (p: Post) => void }) {
  const { api, profile } = useSession();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [premium, setPremium] = useState(false);
  const [price, setPrice] = useState("2");
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
        const s = await uploadFile(api, f, "post").catch((e: Error) => {
          throw new Error(`Couldn't upload ${f.name}: ${e.message}. Photos must be JPG, PNG, WebP or GIF; videos MP4; up to 25 MB.`);
        });
        media.push({ path: s.path, bucket: s.bucket, mime: f.type, size: f.size });
      }
      const post = await api<Post>("/api/posts", { body: { body, media, ...(premium ? { premium: { price } } : {}) } });
      onPosted(post);
      setBody(""); setFiles([]); setPremium(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form id="compose" onSubmit={submit} className="mx-4 mb-4 scroll-mt-24 rounded-[1.75rem] bg-white p-4 ring-1 ring-line md:mx-6 md:p-5" aria-label="New post">
      <label htmlFor="post-body" className="sr-only">What's happening</label>
      <textarea id="post-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={2}
        placeholder="What's new?" className="field min-h-16 resize-y border-transparent bg-cloud py-3 text-base" />
      {files.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-sm ring-1 ring-line">
              <span className="max-w-40 truncate">{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      {premium && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl bg-cloud p-3 ring-1 ring-line">
          <span className="grad grid size-8 shrink-0 place-items-center rounded-xl"><Gem size={16} aria-hidden /></span>
          <label htmlFor="price" className="text-sm font-semibold">Your price</label>
          <span className="relative w-28">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate">$</span>
            <input id="price" className="field tabular" style={{ paddingLeft: "1.6rem" }} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} aria-describedby="price-hint" />
          </span>
          <p id="price-hint" className="w-full text-sm text-slate sm:w-auto sm:flex-1">Everyone can see the post. People can buy it to own it.</p>
        </div>
      )}
      <ActionError error={err} onClose={() => setErr(null)} />
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,application/pdf,application/zip" multiple hidden
            onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? []).slice(0, 4 - files.length)]); e.target.value = ""; }} />
          <button type="button" className="btn-ghost px-3" onClick={() => input.current?.click()} disabled={files.length >= 4}><ImagePlus size={18} aria-hidden /> <span className="hidden sm:inline">Photo</span></button>
          <button type="button" className={`btn-ghost px-3 ${premium ? "bg-cobalt-soft" : ""}`} aria-pressed={premium} onClick={() => setPremium(!premium)}><Gem size={18} aria-hidden /> Sell</button>
        </div>
        <button className="btn-primary" disabled={busy || (!body.trim() && !files.length) || (premium && !(Number(price) > 0))}>{busy ? "Posting" : "Post"}</button>
      </div>
    </form>
  );
}
