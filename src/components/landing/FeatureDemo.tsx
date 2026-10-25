"use client";

import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { useEffect, useRef, useState } from "react";

type SceneKey = "send" | "tip" | "hire" | "earn";
const SCENES: { key: SceneKey; tab: string; title: string; foot: string }[] = [
  { key: "send", tab: "Send", title: "Sending to @maria", foot: "Arrives in about 5 seconds" },
  { key: "tip", tab: "Tip", title: "Tipping @lena's post", foot: "The creator is paid right away" },
  { key: "hire", tab: "Hire", title: "Job with @jo", foot: "Paid out only when you approve" },
  { key: "earn", tab: "Save", title: "Savings, coming later", foot: "Not live yet. Rates will change" },
];
const STEP_MS = 4200;

/**
 * Animated, tilting product demo used in the landing hero and on the sign-in
 * page. Pure DOM + CSS 3D (no WebGL), so it is light on phones. With reduced
 * motion it stops auto-advancing and tilting; the tabs still switch scenes.
 */
export function FeatureDemo({ tone = "light" }: { tone?: "light" | "dark" }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const rx = useSpring(useMotionValue(0), { stiffness: 90, damping: 18 });
  const ry = useSpring(useMotionValue(0), { stiffness: 90, damping: 18 });

  useEffect(() => {
    if (reduce || paused) return;
    const t = setTimeout(() => setI((n) => (n + 1) % SCENES.length), STEP_MS);
    return () => clearTimeout(t);
  }, [i, paused, reduce]);

  function onMove(e: React.PointerEvent) {
    if (reduce || e.pointerType !== "mouse" || !stage.current) return;
    const r = stage.current.getBoundingClientRect();
    ry.set(((e.clientX - r.left) / r.width - 0.5) * 14);
    rx.set(-((e.clientY - r.top) / r.height - 0.5) * 10);
  }
  function onLeave() { rx.set(0); ry.set(0); setPaused(false); }

  const scene = SCENES[i];
  const dark = tone === "dark";

  return (
    <div className="w-full" onMouseEnter={() => setPaused(true)} onMouseLeave={onLeave} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div ref={stage} onPointerMove={onMove} className="relative mx-auto w-full max-w-[480px] py-6" style={{ perspective: 1200 }} aria-hidden>
        <motion.div style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }} animate={reduce ? undefined : { y: [0, -6, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
          <div className={`relative rounded-[1.75rem] p-6 shadow-[0_30px_60px_-25px_rgba(16,27,45,0.35)] ring-1 md:p-7 ${dark ? "bg-cloud ring-white/10" : "bg-white ring-line"}`}>
            <div className="flex items-center justify-between">
              <AnimatePresence mode="wait">
                <motion.p key={scene.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="text-sm text-slate">{scene.title}</motion.p>
              </AnimatePresence>
              <span className="rounded-md border border-mint/40 bg-mint-soft px-2 py-0.5 text-[11px] font-bold tracking-wide text-mint-deep">PREVIEW</span>
            </div>
            <div className="relative mt-4 min-h-[250px]">
              <AnimatePresence mode="wait">
                <motion.div key={scene.key} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.35 }}>
                  {scene.key === "send" && <SendScene />}
                  {scene.key === "tip" && <TipScene />}
                  {scene.key === "hire" && <HireScene />}
                  {scene.key === "earn" && <EarnScene />}
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-[13px]">
              <span className="flex items-center gap-2 text-slate"><span className="size-2 rounded-full bg-mint" />{scene.foot}</span>
              <span className="text-slate/80">Sample figures</span>
            </div>
          </div>
          <FloatChip k={scene.key} />
        </motion.div>
      </div>

      <div role="tablist" aria-label="What you can do" className="mx-auto mt-2 grid w-full max-w-[480px] grid-cols-4 gap-3">
        {SCENES.map((s, n) => (
          <button key={s.key} role="tab" aria-selected={n === i} onClick={() => setI(n)} className="tap group flex flex-col items-start gap-2 text-left">
            <span className={`relative h-[3px] w-full overflow-hidden rounded-full ${dark ? "bg-white/15" : "bg-line"}`}>
              {n === i && (
                <motion.span key={`${i}-${paused}`} className="absolute inset-y-0 left-0 rounded-full bg-mint" initial={{ width: reduce || paused ? "100%" : "0%" }} animate={{ width: "100%" }} transition={{ duration: reduce || paused ? 0 : STEP_MS / 1000, ease: "linear" }} />
              )}
              {n < i && <span className="absolute inset-0 rounded-full bg-mint/60" />}
            </span>
            <span className={`text-sm font-semibold ${n === i ? (dark ? "text-white" : "text-ink") : dark ? "text-white/55" : "text-slate"}`}>{s.tab}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Avatar({ letter, cls }: { letter: string; cls: string }) {
  return <span className={`grid size-11 shrink-0 place-items-center rounded-full font-display text-lg font-bold text-white ${cls}`}>{letter}</span>;
}

function Coin({ className = "" }: { className?: string }) {
  return (
    <motion.span className={`grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#7BE3CD] to-mint font-display text-base font-bold text-ink shadow-md ring-2 ring-white ${className}`} animate={{ rotateY: [0, 360] }} transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }} style={{ transformStyle: "preserve-3d" }}>
      $
    </motion.span>
  );
}

function Stamp({ text, tone = "ink" }: { text: string; tone?: "ink" | "mint" }) {
  return (
    <motion.span initial={{ scale: 1.6, opacity: 0, rotate: -14 }} animate={{ scale: 1, opacity: 1, rotate: -6 }} transition={{ delay: 1.7, type: "spring", stiffness: 260, damping: 14 }} className={`inline-flex items-center gap-1.5 rounded-xl border-[3px] px-3 py-1 font-display text-xl font-bold tracking-wide ${tone === "mint" ? "border-mint-deep text-mint-deep" : "border-ink text-ink"}`}>
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      {text}
    </motion.span>
  );
}

function Amount({ value, unit = "" }: { value: string; unit?: string }) {
  const [whole, cents] = value.split(".");
  return (
    <p className="tabular font-display text-[2.6rem] font-bold leading-none tracking-tight text-ink">
      ${whole}<span className="text-slate">.{cents}</span>{unit && <span className="ml-1.5 text-base font-semibold text-slate">{unit}</span>}
    </p>
  );
}

function SendScene() {
  return (
    <div>
      <div className="flex items-center gap-3">
        <Avatar letter="Y" cls="bg-cobalt" />
        <div className="relative h-11 flex-1">
          <div className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-line" />
          <motion.div className="absolute top-1/2 -translate-y-1/2" initial={{ left: "0%" }} animate={{ left: "calc(100% - 36px)" }} transition={{ duration: 1.5, ease: [0.45, 0, 0.2, 1] }}>
            <Coin />
          </motion.div>
        </div>
        <Avatar letter="M" cls="bg-mint-deep" />
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate"><span>You</span><span>@maria</span></div>
      <div className="mt-6"><Amount value="12.50" /></div>
      <p className="mt-1 text-sm text-slate">For lunch on Friday</p>
      <div className="mt-6 flex items-center justify-between">
        <div className="h-2 w-1/2 overflow-hidden rounded-full bg-line"><motion.div className="h-full rounded-full bg-cobalt" initial={{ width: 0 }} animate={{ width: "100%" }} transition={{ duration: 1.5 }} /></div>
        <Stamp text="SENT" />
      </div>
    </div>
  );
}

function TipScene() {
  return (
    <div>
      <div className="flex items-center gap-3">
        <Avatar letter="L" cls="bg-[#C2410C]" />
        <div className="text-sm"><p className="font-semibold text-ink">@lena</p><p className="text-slate">Morning at the lake, on film</p></div>
      </div>
      <div className="relative mt-3 h-24 overflow-hidden rounded-2xl bg-[#F3A6B8]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/demo/lake-sunrise.svg" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <motion.span className="absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-white/90 text-[#E11D48]" animate={{ scale: [1, 1.25, 1] }} transition={{ delay: 0.3, duration: 0.6 }}>
          <svg viewBox="0 0 24 24" className="size-5" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.4 5c2 0 3.6 1.1 4.6 2.6C12 6.1 13.6 5 15.6 5 19 5 21.1 8.4 19.6 11.8 17.5 16.4 12 21 12 21z" /></svg>
        </motion.span>
      </div>
      <div className="mt-4 flex items-end justify-between">
        <Amount value="2.00" unit="tip" />
        <Stamp text="TIPPED" tone="mint" />
      </div>
      <div className="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-line">
        <motion.div className="rounded-l-full bg-ink" initial={{ width: "0%" }} animate={{ width: "96%" }} transition={{ duration: 1.1, delay: 0.3 }} />
        <motion.div className="rounded-r-full bg-mint" initial={{ width: "0%" }} animate={{ width: "4%" }} transition={{ duration: 0.3, delay: 1.4 }} />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-slate"><span>@lena gets <b className="text-ink">$1.95</b></span><span>Fee $0.05</span></div>
    </div>
  );
}

function HireScene() {
  const steps = ["Payment held safely", "Work delivered", "Paid to @jo"];
  return (
    <div>
      <p className="text-sm font-semibold text-ink">Logo redesign</p>
      <div className="mt-2"><Amount value="150.00" /></div>
      <ol className="mt-5 space-y-3">
        {steps.map((s, n) => (
          <motion.li key={s} className="flex items-center gap-3 text-sm" initial={{ opacity: 0.35 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + n * 0.55 }}>
            <motion.span className="grid size-6 place-items-center rounded-full text-white" initial={{ backgroundColor: "#DCE3F2" }} animate={{ backgroundColor: n === 2 ? "#0B7A63" : "#101B2D" }} transition={{ delay: 0.3 + n * 0.55 }}>
              <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </motion.span>
            <span className="text-ink">{s}</span>
          </motion.li>
        ))}
      </ol>
      <div className="mt-4 flex justify-end"><Stamp text="RELEASED" tone="mint" /></div>
    </div>
  );
}

function EarnScene() {
  return (
    <div>
      <Amount value="1,000.14" />
      <p className="mt-1 text-sm text-slate">Started with $1,000. Earned $0.14 today at a sample 5% a year, not guaranteed</p>
      <svg viewBox="0 0 300 90" className="mt-5 h-24 w-full" fill="none">
        <defs><linearGradient id="fd-earn" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#24CBA8" stopOpacity="0.28" /><stop offset="1" stopColor="#24CBA8" stopOpacity="0" /></linearGradient></defs>
        <motion.path d="M0 80 C 40 76, 70 70, 110 62 S 180 44, 220 34 S 280 14, 300 10 L300 90 L0 90Z" fill="url(#fd-earn)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.8 }} />
        <motion.path d="M0 80 C 40 76, 70 70, 110 62 S 180 44, 220 34 S 280 14, 300 10" stroke="#0B7A63" strokeWidth="3" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, ease: "easeOut" }} />
      </svg>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-slate">Turn it on or off anytime</span>
        <motion.span className="tabular rounded-full bg-mint-soft px-3 py-1 font-semibold text-mint-deep" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.4 }}>+$0.14 today</motion.span>
      </div>
    </div>
  );
}

/** A small card floating in front of the main card (translateZ) for depth. */
function FloatChip({ k }: { k: SceneKey }) {
  const text = { send: "@maria received $12.50", tip: "+$1.95 for @lena", hire: "Held safely until done", earn: "Your money, your choice" }[k];
  return (
    <AnimatePresence mode="wait">
      <motion.div key={k} className="absolute right-2 -top-1 rounded-2xl bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-xl md:-right-8" style={{ z: 70 }} initial={{ opacity: 0, y: 12, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1, transition: { delay: 0.9, duration: 0.35 } }} exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}>
        {text}
      </motion.div>
    </AnimatePresence>
  );
}
