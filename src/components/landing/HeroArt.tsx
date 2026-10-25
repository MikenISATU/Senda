"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { HeroPoster } from "./HeroPoster";

const HeroScene = dynamic(() => import("./HeroScene"), { ssr: false });

/**
 * Loads the 3D scene only when: motion is allowed, the device isn't flagged
 * low-power / data-saver, WebGL exists, and the hero is on screen. Pauses
 * rendering offscreen and in background tabs. Otherwise shows the poster.
 */
export function HeroArt() {
  const box = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"poster" | "3d">("poster");
  const [visible, setVisible] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
    const lowPower = nav.connection?.saveData || (nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2;
    const webgl = (() => { try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; } })();
    const decide = () => setMode(!mq.matches && !lowPower && webgl ? "3d" : "poster");
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (idle) idle(decide); else setTimeout(decide, 200);
    mq.addEventListener("change", decide);
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "100px" });
    if (box.current) io.observe(box.current);
    const vis = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", vis);
    return () => { mq.removeEventListener("change", decide); io.disconnect(); document.removeEventListener("visibilitychange", vis); };
  }, []);

  useEffect(() => {
    if (mode === "3d") import("./HeroScene").then(() => setTimeout(() => setLoaded(true), 150));
  }, [mode]);

  return (
    <div ref={box} className="relative aspect-[15/14] w-full">
      <HeroPoster className={`absolute inset-0 h-full w-full transition-opacity duration-700 ${mode === "3d" && loaded ? "opacity-0" : "opacity-100"}`} />
      {mode === "3d" && (
        <div className={`absolute inset-0 transition-opacity duration-700 ${loaded ? "opacity-100" : "opacity-0"}`}>
          <HeroScene running={visible && tabVisible} />
        </div>
      )}
    </div>
  );
}
