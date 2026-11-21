"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, Copy, HelpCircle, Trash2, WifiOff } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { friendlyError, logError, type Friendly } from "@/lib/client/errors";
import { Modal } from "./Modal";

/**
 * Senda's own pop-ups, replacing the browser's grey "this site says" boxes.
 *
 *   const dialog = useDialog();
 *   if (await dialog.confirm({ title: "Delete this post?", tone: "danger" })) ...
 *   const reason = await dialog.ask({ title: "Report this post", options: [...] });
 *   await dialog.error(e);            // centred, plain-language problem
 *   await dialog.notify({ title: "Report sent" });
 *
 * One dialog shows at a time; extra ones wait their turn.
 */
type Tone = "default" | "danger";
type ConfirmOpts = { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; tone?: Tone };
type AskOpts = ConfirmOpts & { label?: string; placeholder?: string; options?: string[]; minLength?: number; maxLength?: number };
type NotifyOpts = { title: string; message?: string; closeLabel?: string };
type ErrorOpts = { onRetry?: () => void };

type Item =
  | { kind: "confirm"; opts: ConfirmOpts; done: (v: boolean) => void }
  | { kind: "ask"; opts: AskOpts; done: (v: string | null) => void }
  | { kind: "notify"; opts: NotifyOpts; done: () => void }
  | { kind: "error"; fr: Friendly; opts: ErrorOpts; done: () => void };

type Api = {
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  ask: (o: AskOpts) => Promise<string | null>;
  notify: (o: NotifyOpts) => Promise<void>;
  error: (e: unknown, o?: ErrorOpts) => Promise<void>;
};
const Ctx = createContext<Api | null>(null);

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<Item[]>([]);
  const push = useCallback((i: Item) => setQueue((q) => [...q, i]), []);
  const shift = useCallback(() => setQueue((q) => q.slice(1)), []);
  const api = useRef<Api>({
    confirm: (opts) => new Promise((done) => push({ kind: "confirm", opts, done })),
    ask: (opts) => new Promise((done) => push({ kind: "ask", opts, done })),
    notify: (opts) => new Promise((done) => push({ kind: "notify", opts, done })),
    error: (e, opts = {}) => new Promise((done) => {
      // A plain string here was already written for a person (it came from our server or the screen).
      const fr = typeof e === "string" ? friendlyError(new Error(e), { fromServer: true }) : friendlyError(e);
      if (fr.code === "REQ" || fr.code.startsWith("REQ-")) fr.title = "That didn't work";
      if (typeof e !== "string") logError("dialog", fr);
      push({ kind: "error", fr, opts, done });
    }),
  }).current;
  const current = queue[0];
  return (
    <Ctx.Provider value={api}>
      {children}
      {current && <DialogCard key={queue.length + current.kind} item={current} close={shift} />}
    </Ctx.Provider>
  );
}

export function useDialog(): Api {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDialog outside DialogProvider");
  return v;
}

/**
 * Drop-in for screens that keep an error in state: shows it as a centred
 * pop-up instead of a red strip, then clears it.
 */
export function ActionError({ error, onClose, onRetry }: { error: string | null | undefined; onClose: () => void; onRetry?: () => void }) {
  const dialog = useDialog();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!error) return;
    let live = true;
    dialog.error(error, { onRetry }).then(() => { if (live) closeRef.current(); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, dialog]);
  return null;
}

function Badge({ tone, children }: { tone: "brand" | "danger" | "calm" | "good"; children: React.ReactNode }) {
  const cls = { brand: "grad text-night", danger: "bg-danger-soft text-danger", calm: "bg-cloud text-slate ring-1 ring-line", good: "bg-mint-soft text-mint-deep" }[tone];
  return <span className={`mx-auto grid size-14 place-items-center rounded-2xl ${cls}`}>{children}</span>;
}

function DialogCard({ item, close }: { item: Item; close: () => void }) {
  const titleId = useId();
  const [text, setText] = useState("");
  const [details, setDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (item.kind === "ask" && !item.opts.options?.length) input.current?.focus(); }, [item]);

  const finish = (fn: () => void) => { fn(); close(); };
  const cancel = () => finish(() => {
    if (item.kind === "confirm") item.done(false);
    else if (item.kind === "ask") item.done(null);
    else item.done();
  });

  const btnRow = "mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center";
  const wide = "w-full sm:w-auto sm:min-w-32";

  if (item.kind === "error") {
    const fr = item.fr;
    const calm = fr.code === "WALLET-CANCELLED";
    const Icon = fr.code.startsWith("NET") ? WifiOff : AlertTriangle;
    const main =
      fr.action === "signin" ? { label: "Sign in", run: () => { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; } }
      : fr.action === "reload" ? { label: "Reload Senda", run: () => location.reload() }
      : fr.action === "retry" && item.opts.onRetry ? { label: "Try again", run: item.opts.onRetry }
      : null;
    const report = `Senda error ${fr.code}\n${fr.title}\n${fr.detail}\n${location.pathname} at ${new Date().toISOString()}`;
    return (
      <Modal open onClose={cancel} title={fr.title} bare labelledBy={titleId}>
        <div role="alert" className="text-center">
          <Badge tone={calm ? "calm" : "danger"}><Icon size={26} aria-hidden /></Badge>
          <h2 id={titleId} className="mt-4 text-xl font-semibold">{fr.title}</h2>
          <p className="mt-2 break-words text-slate">{fr.message}</p>
          {fr.safe && !calm && <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-mint-soft px-3 py-1 text-sm font-semibold text-mint-deep"><CheckCircle2 size={15} aria-hidden /> No money was moved</p>}
          <div className={btnRow}>
            {main ? (
              <>
                <button type="button" className={`btn-ghost ${wide}`} onClick={cancel}>Close</button>
                <button type="button" className={`btn-primary ${wide}`} onClick={() => finish(() => { item.done(); main.run(); })}>{main.label}</button>
              </>
            ) : (
              <button type="button" autoFocus className={`btn-primary ${wide}`} onClick={cancel}>OK</button>
            )}
          </div>
          {!calm && (
            <div className="mt-3">
              <button type="button" onClick={() => setDetails(!details)} aria-expanded={details} className="tap inline-flex items-center gap-1 text-sm text-slate hover:text-ink">
                Details <ChevronDown size={14} aria-hidden className={details ? "rotate-180 transition-transform" : "transition-transform"} />
              </button>
              {details && (
                <div className="mt-1 rounded-2xl bg-cloud p-3 text-left text-xs text-slate ring-1 ring-line">
                  <p>Code <b className="tabular text-ink">{fr.code}</b></p>
                  <p className="mt-1 max-h-24 overflow-auto break-words">{fr.detail}</p>
                  <button type="button" className="tap mt-1 inline-flex items-center gap-1 font-semibold text-ink"
                    onClick={() => { navigator.clipboard?.writeText(report).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}>
                    <Copy size={13} aria-hidden /> {copied ? "Copied" : "Copy for support"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    );
  }

  if (item.kind === "notify") {
    const o = item.opts;
    return (
      <Modal open onClose={cancel} title={o.title} bare labelledBy={titleId}>
        <div className="text-center">
          <Badge tone="good"><CheckCircle2 size={28} aria-hidden /></Badge>
          <h2 id={titleId} className="mt-4 text-xl font-semibold">{o.title}</h2>
          {o.message && <p className="mt-2 text-slate">{o.message}</p>}
          <div className={btnRow}><button type="button" autoFocus className={`btn-primary ${wide}`} onClick={cancel}>{o.closeLabel ?? "Done"}</button></div>
        </div>
      </Modal>
    );
  }

  const o = item.opts;
  const danger = o.tone === "danger";
  const min = item.kind === "ask" ? item.opts.minLength ?? 1 : 0;
  const ok = item.kind === "confirm" || text.trim().length >= min;
  const submit = () => {
    if (!ok) return;
    finish(() => { if (item.kind === "confirm") item.done(true); else if (item.kind === "ask") item.done(text.trim()); });
  };
  return (
    <Modal open onClose={cancel} title={o.title} bare labelledBy={titleId}>
      <form className="text-center" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Badge tone={danger ? "danger" : "brand"}>{danger ? <Trash2 size={26} aria-hidden /> : <HelpCircle size={26} aria-hidden />}</Badge>
        <h2 id={titleId} className="mt-4 text-xl font-semibold">{o.title}</h2>
        {o.message && <p className="mt-2 text-slate">{o.message}</p>}
        {item.kind === "ask" && (
          <div className="mt-4 text-left">
            {!!item.opts.options?.length && (
              <div role="group" aria-label="Quick choices" className="mb-3 flex flex-wrap justify-center gap-2">
                {item.opts.options.map((opt) => {
                  const on = text === opt;
                  return (
                    <button key={opt} type="button" aria-pressed={on} onClick={() => setText(on ? "" : opt)}
                      className={`tap rounded-full px-4 text-sm font-semibold ring-1 transition-colors ${on ? "bg-cobalt-soft text-ink ring-cobalt" : "bg-cloud text-slate ring-line hover:text-ink"}`}>{opt}</button>
                  );
                })}
              </div>
            )}
            <label className="label" htmlFor={`${titleId}-in`}>{item.opts.label ?? "Your answer"}</label>
            <textarea ref={input} id={`${titleId}-in`} className="field min-h-24" rows={3} maxLength={item.opts.maxLength ?? 500} placeholder={item.opts.placeholder} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        )}
        <div className={btnRow}>
          <button type="button" className={`btn-ghost ${wide}`} onClick={cancel}>{o.cancelLabel ?? "Cancel"}</button>
          <button type="submit" disabled={!ok} autoFocus={item.kind === "confirm" && !danger} className={`${danger ? "btn-danger" : "btn-primary"} ${wide}`}>{o.confirmLabel ?? (item.kind === "ask" ? "Send" : "Confirm")}</button>
        </div>
      </form>
    </Modal>
  );
}
