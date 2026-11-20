"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";
const KEY = "senda-theme";

function systemTheme(): "light" | "dark" {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function readChoice(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "system"; } catch { return "system"; }
}
function apply(choice: ThemeChoice) {
  document.documentElement.dataset.theme = choice === "system" ? systemTheme() : choice;
}

/** Runs before the page paints so the right theme shows straight away. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${KEY}');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}`;

/** Light / dark / match-device theme, remembered on this device. */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const sync = () => { const c = readChoice(); setChoice(c); apply(c); setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light"); };
    sync();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", sync);
    window.addEventListener("storage", sync);
    window.addEventListener("senda-theme", sync);
    return () => { mq.removeEventListener("change", sync); window.removeEventListener("storage", sync); window.removeEventListener("senda-theme", sync); };
  }, []);

  const set = useCallback((c: ThemeChoice) => {
    try { if (c === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, c); } catch { /* private mode: applies for this visit only */ }
    apply(c);
    window.dispatchEvent(new Event("senda-theme"));
  }, []);

  return { choice, theme, set, toggle: () => set(theme === "dark" ? "light" : "dark") };
}
